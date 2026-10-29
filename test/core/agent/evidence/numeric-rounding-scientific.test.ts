/**
 * A number in scientific notation grounds the same decimal
 * (`namesAndNumbersFromEvidence({ decimalRounding: true })`).
 *
 * The field case: a script printed a p-value as `1.12e-02` (the default
 * formatting of common numeric libraries) and the answer wrote `0.0112`. The
 * value was right; only the spelling differed, and the gate flagged it. The
 * same value returned as a JSON NUMBER already passed — `JSON.parse` turns it
 * into `0.0112` — so the gap was the result's TEXT (stdout).
 *
 * The option off is pinned byte for byte by
 * `numeric-scientific-identity.test.ts`; the rounding rule over random
 * decimals by `numeric-rounding-scientific.property.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import type {
  EvidenceVerdict,
  NamesAndNumbersOptions,
} from '../../../../src/core/agent/evidence/types.js';
import type { AgentEvidenceCheckedPayload } from '../../../../src/events/payloads.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';
import { extractCandidates } from '../../../../src/core/agent/evidence/extract.js';
import { figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { scientificDecimalOf } from '../../../../src/core/agent/evidence/numberPrecision.js';
import { groundedArgumentValues } from '../../../../src/core/agent/findings/contingent.js';

const enabled: NamesAndNumbersOptions = { decimalRounding: true };

/**
 * One mock run: the tool returns `result` (a string is served as text, the way
 * a script's stdout is; anything else as JSON), then the model answers
 * `answer`. Returns every `evidence_checked` payload the run emitted.
 */
async function checksOf(
  result: unknown,
  answer: string,
  options: NamesAndNumbersOptions = enabled,
): Promise<AgentEvidenceCheckedPayload[]> {
  const tool = defineTool({
    name: 'run_script',
    description: 'Run the analysis script and return what it printed.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => result,
  });
  const provider = mock({
    respond: (request) =>
      request.messages.some((message) => message.role === 'tool')
        ? { content: answer }
        : { content: '', toolCalls: [{ id: 'run-1', name: 'run_script', args: {} }] },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(tool)
    .namesAndNumbersFromEvidence(options)
    .build();
  const checks: AgentEvidenceCheckedPayload[] = [];
  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => checks.push(payload));
  await agent.run({ message: 'Is the effect significant?' });
  return checks;
}

/** A person's question, then one tool result per entry, served as given. */
function historyOf(results: readonly string[]): readonly LLMMessage[] {
  return [
    { role: 'user', content: 'Run the analysis.' },
    ...results.map((content, index) => ({
      role: 'tool' as const,
      toolCallId: `run-${index + 1}`,
      content,
    })),
  ];
}

/** Judge `answer` over `results` exactly as the Route stage does. */
function judge(
  answer: string,
  results: readonly string[],
  options: NamesAndNumbersOptions = enabled,
): EvidenceVerdict {
  const history = historyOf(results);
  const gate = resolveEvidenceGate(options);
  return checkAnswer(answer, {
    gate,
    evidence: evidenceFromHistory(history, gate),
    exempt: new Set(),
    // Route loads the numeric module only under one of the two dials.
    ...((gate.figures || gate.decimalRounding === true) && {
      figures: figureCheckOf(answer, history, gate),
    }),
  });
}

/** The fate of the ONE value an answer states: read, computed (by which derivation), flagged. */
function fateOf(
  answer: string,
  results: readonly string[],
  options: NamesAndNumbersOptions = enabled,
): string {
  const verdict = judge(answer, results, options);
  expect(verdict.lookedUp).toBe(1);
  if (verdict.unsupported.length === 1) return 'flagged';
  return verdict.computed?.[0]?.derivation ?? 'grounded';
}

describe('the field case, end to end', () => {
  it('stdout `1.12e-02` grounds the answer `0.0112`', async () => {
    const [check] = await checksOf(
      't = 2.54, p = 1.12e-02',
      'The effect is significant (p = 0.0112).',
    );
    expect(check?.unsupported).toEqual([]);
    expect(check?.action).toBe('grounded');
    expect(check?.carriedBy).toEqual([{ toolCallId: 'run-1', values: 1, only: 1 }]);
  });

  it('the same value returned as a JSON number already grounded it', async () => {
    const [check] = await checksOf(
      { t: 2.54, p: 1.12e-2 },
      'The effect is significant (p = 0.0112).',
    );
    expect(check?.unsupported).toEqual([]);
    expect(check?.action).toBe('grounded');
  });

  it('a `rails` agent delivers the answer instead of refusing it', async () => {
    const checks = await checksOf('p = 1.12e-02', 'p = 0.011, rounded.', {
      posture: 'rails',
      decimalRounding: true,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]?.computed).toEqual([
      { value: '0.011', shape: 'number', derivation: 'rounded', from: '1.12e-02 at ' },
    ]);
  });

  it('with the option off the stdout case is flagged, as it always was', async () => {
    const [check] = await checksOf('t = 2.54, p = 1.12e-02', 'p = 0.0112.', {});
    expect(check?.unsupported).toEqual([{ value: '0.0112', shape: 'number' }]);
  });
});

describe("a printed scientific value grounds an answer decimal at the answer's precision", () => {
  it.each([
    ['0.0112', 'grounded'],
    ['0.011', 'rounded'],
    ['0.01', 'rounded'],
    ['0.012', 'flagged'],
    ['0.0113', 'flagged'],
  ])('stdout `1.12e-02` → %s is %s', (answer, fate) => {
    expect(fateOf(`p = ${answer}`, ['p = 1.12e-02'])).toBe(fate);
  });

  it('names the rounding and the spelling the result printed', () => {
    expect(judge('p = 0.011', ['p = 1.12e-02']).computed).toEqual([
      { value: '0.011', shape: 'number', derivation: 'rounded', from: '1.12e-02 at ' },
    ]);
  });

  it('files the decimal beside the spelling, with the same turn and carrier', () => {
    const history = historyOf(['p = 1.12e-02']);
    const corpus = evidenceFromHistory(history, resolveEvidenceGate(enabled));
    expect([...corpus.values.keys()]).toEqual(['p', '1.12e-02', '0.0112']);
    expect(corpus.values.get('0.0112')).toBe(corpus.values.get('1.12e-02'));
    expect(corpus.carriers.get('0.0112')).toEqual({ toolCallIds: ['run-1'] });
    // No gate, or the dial off: the corpus it always was.
    expect([...evidenceFromHistory(history).values.keys()]).toEqual(['p', '1.12e-02']);
    expect([...evidenceFromHistory(history, resolveEvidenceGate()).values.keys()]).toEqual([
      'p',
      '1.12e-02',
    ]);
  });
});

describe('the reverse: an answer in scientific notation, a printed decimal', () => {
  it.each([
    ['1.12e-2', '0.0112', 'grounded'],
    ['1.12e-2', '0.01121', 'rounded'],
    ['1.12e-2', '0.01125', 'rounded'],
    ['1.12e-2', '0.01126', 'flagged'],
    ['1.13e-2', '0.01121', 'flagged'],
    ['1.120e-2', '0.011204', 'rounded'],
    ['1.120e-2', '0.01124', 'flagged'],
  ])('answer %s over stdout %s is %s', (answer, printed, fate) => {
    expect(fateOf(`p = ${answer}`, [`p = ${printed}`])).toBe(fate);
  });

  it('reports the value as the decimal it states', () => {
    expect(judge('p = 1.13e-2', ['p = 0.01121']).unsupported).toEqual([
      { value: '0.0113', shape: 'number' },
    ]);
    expect(judge('p = 1.12e-2', ['p = 0.0112']).grounded).toEqual([
      { value: '0.0112', forms: ['0.0112', '1.12e-2'] },
    ]);
  });

  it('a spelling still grounds itself, with the option on and off', () => {
    for (const options of [enabled, {}]) {
      expect(judge('p = 1.12e-02', ['p = 1.12e-02'], options).unsupported).toEqual([]);
    }
  });
});

describe('never across magnitude', () => {
  it.each(['1.12', '11.2', '0.112', '0.00112', '112.0'])(
    'stdout `1.12e-02` never grounds %s',
    (answer) => {
      expect(fateOf(`p = ${answer}`, ['p = 1.12e-02'])).toBe('flagged');
    },
  );

  it.each(['1.12e-02', '1.12e+02', '1.12e-1', '1.12e1'])(
    'stdout `1.12` never grounds %s',
    (answer) => {
      expect(fateOf(`p = ${answer}`, ['p = 1.12'])).toBe('flagged');
    },
  );

  it('the same magnitude in another spelling does', () => {
    expect(fateOf('p = 1.12e+00', ['p = 1.12'])).toBe('grounded');
    expect(fateOf('p = 112e-2', ['p = 1.12'])).toBe('grounded');
  });
});

describe('spellings: upper-case E, explicit + and - exponents', () => {
  it.each(['1.12E-02', '1.12e-2', '1.12E-2', '11.2e-3', '0.112e-1', '112e-4', '+1.12e-02'])(
    'stdout %s grounds `0.0112`',
    (printed) => {
      expect(fateOf('p = 0.0112', [`p = ${printed}`])).toBe('grounded');
    },
  );

  it.each(['3.358E+03', '3.358e+3', '3.358e3', '33.58E2', '3358e0'])(
    'stdout %s grounds `3,358` and `3358`',
    (printed) => {
      expect(fateOf('n = 3,358', [`n = ${printed}`])).toBe('grounded');
      expect(fateOf('n = 3358', [`n = ${printed}`])).toBe('grounded');
    },
  );

  it('an answer in upper case, or with an explicit +, reads the same', () => {
    expect(fateOf('n = 3.358E+03', ['n = 3358'])).toBe('grounded');
    expect(fateOf('p = 1.12E-2', ['p = 0.01121'])).toBe('rounded');
  });
});

describe('negatives', () => {
  it.each([
    ['-0.0112', 'grounded'],
    ['-0.011', 'rounded'],
    ['0.0112', 'flagged'],
    ['-0.012', 'flagged'],
  ])('stdout `-1.12e-02` → %s is %s', (answer, fate) => {
    expect(fateOf(`d = ${answer}`, ['d = -1.12e-02'])).toBe(fate);
  });

  it('and the reverse', () => {
    expect(fateOf('d = -1.12e-2', ['d = -0.01121'])).toBe('rounded');
    expect(fateOf('d = -1.12e-2', ['d = 0.01121'])).toBe('flagged');
  });
});

describe('half-unit rounding boundaries, exactly', () => {
  it('the interval is inclusive on both sides', () => {
    expect(fateOf('p = 0.0113', ['p = 1.125e-02'])).toBe('rounded');
    expect(fateOf('p = 0.0112', ['p = 1.125e-02'])).toBe('rounded');
    expect(fateOf('p = 0.0114', ['p = 1.125e-02'])).toBe('flagged');
    expect(fateOf('p = 0.0111', ['p = 1.125e-02'])).toBe('flagged');
  });

  it('a digit past double precision still counts', () => {
    const printed = '1.12500000000000001e-02';
    // A double cannot tell this spelling from the boundary itself; the gate can.
    expect(Number(printed)).toBe(0.01125);
    expect(fateOf('p = 0.0113', [`p = ${printed}`])).toBe('rounded');
    expect(fateOf('p = 0.0112', [`p = ${printed}`])).toBe('flagged');
  });

  it('and in the reverse direction', () => {
    expect(fateOf('p = 1.13e-2', ['p = 0.01125'])).toBe('rounded');
    expect(fateOf('p = 1.13e-2', ['p = 0.0112500000000000001'])).toBe('rounded');
    expect(fateOf('p = 1.12e-2', ['p = 0.0112500000000000001'])).toBe('flagged');
  });
});

describe('large integers, exactly', () => {
  it.each([
    ['3,358', 'n = 3.358e+03', 'grounded'],
    ['3358.0', 'n = 3.358e+03', 'grounded'],
    ['3,359', 'n = 3.358e+03', 'flagged'],
    ['3.358e+03', 'n = 3,358', 'grounded'],
    // A whole number is matched exactly, never rounded: 3.36e+03 is 3360,
    // and 3.358e+03 is not 3358.04 to the nearest unit — as plain 3358 is not.
    ['3.36e+03', 'n = 3,358', 'flagged'],
    ['3.358e+03', 'n = 3358.04', 'flagged'],
    ['3358', 'n = 3358.04', 'flagged'],
  ])('answer %s over stdout `%s` is %s', (answer, printed, fate) => {
    expect(fateOf(`n = ${answer}`, [printed])).toBe(fate);
  });

  it('`1.2e+21` and its 22-digit integer ground each other, digit for digit', () => {
    const integer = '1200000000000000000000';
    expect(integer).toHaveLength(22);
    expect(fateOf(`n = ${integer}`, ['n = 1.2e+21'])).toBe('grounded');
    expect(fateOf('n = 1,200,000,000,000,000,000,000', ['n = 1.2e+21'])).toBe('grounded');
    expect(fateOf('n = 1.2e+21', [`n = ${integer}`])).toBe('grounded');
    // A double cannot tell these two apart; the gate does.
    expect(Number('1200000000000000000001')).toBe(1.2e21);
    expect(fateOf('n = 1200000000000000000001', ['n = 1.2e+21'])).toBe('flagged');
    expect(fateOf('n = 1.2e+21', ['n = 1200000000000000000001'])).toBe('flagged');
  });
});

describe('bounds: outside them a token stays a spelling only', () => {
  it('reads exactly within the exponent and spelling bounds', () => {
    expect(scientificDecimalOf('1.12e-02')).toEqual({ exact: '0.0112', written: '0.0112' });
    expect(scientificDecimalOf('1.120E-2')).toEqual({ exact: '0.0112', written: '0.01120' });
    expect(scientificDecimalOf('-5e-7')).toEqual({ exact: '-0.0000005', written: '-0.0000005' });
    expect(scientificDecimalOf('3.358e+03')).toEqual({ exact: '3358' });
    expect(scientificDecimalOf('1.50e1')).toEqual({ exact: '15', written: '15.0' });
    expect(scientificDecimalOf('0e5')).toEqual({ exact: '0' });
    expect(scientificDecimalOf('-0.0e-3')).toEqual({ exact: '0', written: '0.0000' });
    expect(scientificDecimalOf('1e255')).toEqual({ exact: `1${'0'.repeat(255)}` });
    expect(scientificDecimalOf('1e-254')?.written).toHaveLength(256);
    const longest = `1.${'0'.repeat(251)}e-2`;
    expect(longest).toHaveLength(256);
    expect(scientificDecimalOf(longest)?.exact).toBe('0.01');
  });

  const tooLong = `1.${'0'.repeat(252)}e-2`;
  it.each([
    ['1e401', 'the exponent is past ±400'],
    ['1e-401', 'the exponent is past ±400'],
    ['1e400', 'the decimal it states is longer than 256 characters'],
    ['1e256', 'the decimal it states is longer than 256 characters'],
    ['1e-255', 'the decimal it states is longer than 256 characters'],
    [tooLong, 'the spelling is longer than 256 characters'],
  ])('%s is a spelling only: %s', (printed) => {
    expect(scientificDecimalOf(printed)).toBeUndefined();
    const corpus = evidenceFromHistory(historyOf([`x = ${printed}`]), resolveEvidenceGate(enabled));
    expect([...corpus.values.keys()]).toEqual(['x', printed]);
  });

  it('a plain number is never read as scientific: short whole numbers stay prose', () => {
    expect(scientificDecimalOf('3358')).toBeUndefined();
    expect(scientificDecimalOf('0.0112')).toBeUndefined();
    expect(
      extractCandidates('3 issues in 24 hours on 2 of 12 hosts', resolveEvidenceGate(enabled)),
    ).toEqual([]);
  });

  it('an answer token outside the bounds is the identifier it always was', () => {
    for (const answer of ['1e401', '1e400', tooLong]) {
      expect(extractCandidates(answer, resolveEvidenceGate(enabled))).toEqual([
        { value: answer, shape: 'identifier' },
      ]);
    }
  });
});

describe('an identifier is not a measurement', () => {
  const lookalikes =
    'commit 9f3e10ab, build 1.2e3-rc, host-1e5, abc1e5, 1e5x, 1.2e3.4, 0x1e5, v1.2e3, ' +
    '1.2e3_rc, 1e3:80, 2e5/s';

  it('a lookalike glued to letters or structure files no decimal', () => {
    const history = historyOf([lookalikes]);
    const on = evidenceFromHistory(history, resolveEvidenceGate(enabled));
    expect([...on.values]).toEqual([...evidenceFromHistory(history).values]);
  });

  it('and is read in the answer as the identifier it was', () => {
    const on = resolveEvidenceGate(enabled);
    const off = resolveEvidenceGate();
    for (const answer of ['9f3e10ab', '1.2e3-rc', 'host-1e5', 'abc1e5', '1.2e3.4', 'v1.2e3']) {
      expect(extractCandidates(answer, on)).toEqual(extractCandidates(answer, off));
    }
  });

  it('a standalone token of digits and one e qualifies; a declared shape keeps it an ID', () => {
    const hexId = { name: 'hex-id', match: /[0-9a-f]{8}/ };
    const shaped: NamesAndNumbersOptions = { ...enabled, shapes: [hexId] };
    const history = historyOf(['id 123456e7']);
    expect(
      evidenceFromHistory(history, resolveEvidenceGate(enabled)).values.has('1234560000000'),
    ).toBe(true);
    expect(
      evidenceFromHistory(history, resolveEvidenceGate(shaped)).values.has('1234560000000'),
    ).toBe(false);
    expect(extractCandidates('123456e7', resolveEvidenceGate(shaped))).toEqual([
      { value: '123456e7', shape: 'hex-id' },
    ]);
    // Neither the index nor the rounding rule reads a source that is an ID.
    expect(fateOf('n = 1234560000000.0', ['id 123456e7'])).toBe('grounded');
    expect(fateOf('n = 1234560000000.0', ['id 123456e7'], shaped)).toBe('flagged');
  });

  it('a declared exempt value stays exempt in another spelling', () => {
    for (const exempt of ['0.0112', '1.12e-2']) {
      expect(
        extractCandidates('p = 1.12e-2', resolveEvidenceGate({ ...enabled, exempt: [exempt] })),
      ).toEqual([]);
    }
  });
});

describe('a percentage stays a derivation', () => {
  const both: NamesAndNumbersOptions = { decimalRounding: true, figures: true };

  it('`1.12%` is not the fraction `1.12e-02`, either way round', () => {
    expect(judge('The rate is 1.12%.', ['p = 1.12e-02'], both).unsupported).toEqual([
      { value: '1.12', shape: 'figure' },
    ]);
    expect(fateOf('p = 0.0112', ['rate = 1.12%'])).toBe('flagged');
    expect(fateOf('p = 1.12e-2', ['rate = 1.12%'])).toBe('flagged');
  });

  it('a scientific spelling with a percent sign is not read as the fraction', () => {
    expect(extractCandidates('1.12e-2%', resolveEvidenceGate(enabled))).toEqual(
      extractCandidates('1.12e-2%', resolveEvidenceGate()),
    );
  });
});

describe('JSON results and stdout text', () => {
  it.each([
    ['a JSON number', JSON.stringify({ p: 1.12e-2 }), 'grounded', 'grounded'],
    ['a JSON string', JSON.stringify({ p: '1.12e-02' }), 'grounded', 'flagged'],
    [
      'a sentence in a JSON string',
      JSON.stringify({ log: 'p = 1.12e-02 after 3 runs' }),
      'grounded',
      'flagged',
    ],
    ['stdout text', 't = 2.54, p = 1.12e-02', 'grounded', 'flagged'],
    ['a note after the JSON', '{"ok":true}\nNote: p = 1.12e-02', 'grounded', 'flagged'],
  ])('%s: on → %s, off → %s', (_where, result, on, off) => {
    expect(fateOf('p = 0.0112', [result])).toBe(on);
    expect(fateOf('p = 0.0112', [result], {})).toBe(off);
  });

  it('rounds from text the way it rounds from a JSON number', () => {
    for (const result of [JSON.stringify({ p: 1.12e-2 }), 'p = 1.12e-02']) {
      expect(fateOf('p = 0.011', [result])).toBe('rounded');
      expect(fateOf('p = 0.012', [result])).toBe('flagged');
    }
  });

  it('a JSON key is a name: `1e-3` as a key files no decimal', () => {
    const corpus = evidenceFromHistory(
      historyOf([JSON.stringify({ '1e-3': 4 })]),
      resolveEvidenceGate(enabled),
    );
    expect(corpus.values.has('1e-3')).toBe(true);
    expect(corpus.values.has('0.001')).toBe(false);
  });

  it('a plain decimal below 1e-6, which the shared spelling rule writes as `1.121e-7`, rounds too', () => {
    expect(fateOf('p = 0.000000112', ['p = 0.0000001121'])).toBe('rounded');
    expect(fateOf('p = 0.000000113', ['p = 0.0000001121'])).toBe('flagged');
  });
});

describe("the figures dial's own arithmetic stays on doubles", () => {
  const both: NamesAndNumbersOptions = { decimalRounding: true, figures: true };

  it('a scientific value grounds a figure by its exact decimal', () => {
    expect(fateOf('1,200 MB', ['size = 1.2e+03 MB'], both)).toBe('grounded');
  });

  it('but no float derivation reads it: no unit conversion from `1.2e+12` bytes', () => {
    expect(fateOf('1 TB', ['size = 1200000000000 bytes'], both)).toBe('unit-scale');
    expect(fateOf('1 TB', ['size = 1.2e+12 bytes'], both)).toBe('flagged');
  });
});

describe('one fold at both moments', () => {
  /** Two calls: c2 rules c1 out and passes, as an argument, the value only c1 printed. */
  async function contingentRowsOf(options: NamesAndNumbersOptions): Promise<unknown[]> {
    const tool = defineTool({
      name: 'run_script',
      description: 'Run the analysis script and return what it printed.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async (args: { q?: string }) => (args.q === 'first' ? 'p = 1.12e-02' : 'ok'),
    });
    const script = [
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'run_script',
            args: { q: 'first', _findings: { basis: 'exploratory' } },
          },
        ],
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c2',
            name: 'run_script',
            args: {
              q: '0.0112',
              _findings: {
                basis: 'direct',
                previous: [{ toolCallId: 'c1', standing: 'ruled-out', line: 'not that run' }],
              },
            },
          },
        ],
      },
      { content: 'done' },
    ];
    let turn = 0;
    const provider = mock({ respond: () => script[Math.min(turn++, script.length - 1)]! });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 8 })
      .tool(tool)
      .findings()
      .namesAndNumbersFromEvidence(options)
      .build();
    await agent.run({ message: 'Is the effect significant?' });
    return (agent.findings() ?? []).filter((row) => row.kind === 'contingent');
  }

  it('dispatch reads the same corpus: an argument carried only by a ruled-out result files a row', async () => {
    expect(await contingentRowsOf(enabled)).toEqual([
      {
        kind: 'contingent',
        declaredOn: { toolCallId: 'c2' },
        value: '0.0112',
        carriers: [{ toolCallId: 'c1', standing: 'ruled-out' }],
        iteration: 2,
      },
    ]);
    // Off, the decimal is in no result, so nothing was carried and nothing is filed.
    expect(await contingentRowsOf({})).toEqual([]);
  });

  it('a call argument is grounded by the same corpus the answer is', () => {
    const gate = resolveEvidenceGate(enabled);
    const corpus = evidenceFromHistory(historyOf(['p = 1.12e-02']), gate);
    expect(groundedArgumentValues({ threshold: '0.0112' }, gate, corpus, new Set())).toEqual([
      { value: '0.0112', forms: ['0.0112'] },
    ]);
    expect(groundedArgumentValues({ threshold: '1.12e-2' }, gate, corpus, new Set())).toEqual([
      { value: '0.0112', forms: ['0.0112', '1.12e-2'] },
    ]);
  });
});
