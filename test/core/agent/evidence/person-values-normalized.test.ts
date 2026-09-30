/**
 * A person's typed answer and their dates and clock times are theirs.
 *
 * Pattern: Test-as-specification — unit over the pure corpus functions, one
 *          scenario on a real pausing agent (the field case).
 * Role:    Pin the law in `src/core/agent/evidence/README.md` § "The
 *          person's typed answer, and how they spell a date or a time":
 *
 *   • a typed ask's answer (`requestInput` → its `input_received` result) is
 *     in the exempt corpus — only the fields the PERSON gave, as the record
 *     holds them (a redacted field exempts nothing), and it rides a fold's
 *     lineage like their message does;
 *   • an ISO date the person gave exempts its year; `8 Am` exempts `8:00`;
 *     `20:00` exempts the `8:00` of `8:00 PM` — spellings, never readings;
 *   • an invented clock time or year is still flagged;
 *   • the tool-evidence index is not widened, and a corpus with no date or
 *     clock time is the one it always was.
 *
 * Test types (Convention 3): unit / integration (the pausing agent) /
 * regression (the field case) / negative (invented values) / documentation
 * (the README example, verbatim).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isInputPause, requestInput } from '../../../../src/index.js';
import type { LLMMessage } from '../../../../src/adapters/types.js';
import { mock } from '../../../../src/llm-providers.js';
import {
  evidenceFromHistory,
  exemptFromRun,
  exemptLineageOf,
} from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { dateAndClockForms, tokenize } from '../../../../src/core/agent/evidence/normalize.js';
import { buildSummaryMessage } from '../../../../src/core/agent/window/summarize.js';

const GATE = resolveEvidenceGate();

const QUESTION = 'what clients connected to SHISOLPLPAP006 during 10/09/26 8 Am to 8:40 AM PST';

/** The landed answer of a typed ask, as `Agent.resume` puts it in history. */
const landed = (
  values: Record<string, string | number | boolean>,
  origins: Record<string, 'response' | 'declaration'>,
): LLMMessage => ({
  role: 'tool',
  toolCallId: 'c1',
  toolName: 'ask_window',
  content: JSON.stringify({
    status: 'input_received',
    requestId: 'r1',
    values,
    origins,
    origin: { originalRequest: QUESTION, toolCallId: 'c1' },
  }),
});

const clients: LLMMessage = {
  role: 'tool',
  toolCallId: 'c2',
  toolName: 'list_clients',
  content: JSON.stringify([{ client: 'esx-host-17a', port: 'fc1/3' }]),
};

const FIELD_HISTORY: readonly LLMMessage[] = [
  { role: 'user', content: QUESTION },
  landed(
    { date: '2026-10-09', timezone: 'America/Los_Angeles' },
    { date: 'response', timezone: 'response' },
  ),
  clients,
];

const flagged = (answer: string, history: readonly LLMMessage[], userMessage?: string) =>
  checkAnswer(answer, {
    gate: GATE,
    evidence: evidenceFromHistory(history),
    exempt: exemptFromRun({ history, ...(userMessage !== undefined && { userMessage }) }),
  }).unsupported.map((u) => u.value);

const FIELD_ANSWER =
  'Between 8:00 and 8:40 AM PST on 2026-10-09 (October 9, 2026), esx-host-17a on fc1/3 ' +
  'connected to SHISOLPLPAP006.';

describe('the field case — values the person gave are not accused', () => {
  it('neither 8:00 (their "8 Am") nor 2026 (the year of their date) is flagged', () => {
    expect(flagged(FIELD_ANSWER, FIELD_HISTORY, QUESTION)).toEqual([]);
  });

  it('an invented clock time and an invented year are still flagged', () => {
    const answer = `${FIELD_ANSWER} A second session opened at 9:15 in 2031.`;
    expect(flagged(answer, FIELD_HISTORY, QUESTION)).toEqual(['9:15', '2031']);
  });

  it('before the fix, the same history accused both (the regression the test pins)', () => {
    // The typed answer is a tool result: `2026-10-09` is indexed whole and
    // never as `2026`, and nothing reads `8 Am` as `8:00`.
    const evidence = evidenceFromHistory(FIELD_HISTORY);
    expect(evidence.values.has('2026')).toBe(false);
    expect(evidence.values.has('8:00')).toBe(false);
  });
});

describe('a typed ask’s answer is the person’s words', () => {
  it('the fields the person gave are exempt; the ones the tool supplied are not', () => {
    const exempt = exemptFromRun({
      history: [
        landed(
          { host: 'ARR-7731', window: 'ARR-2291' },
          { host: 'declaration', window: 'response' },
        ),
      ],
    });
    expect(exempt.has('arr-2291')).toBe(true);
    expect(exempt.has('arr-7731')).toBe(false);
  });

  it('a number or a boolean answer is exempt as written', () => {
    const exempt = exemptFromRun({ history: [landed({ year: 2031 }, { year: 'response' })] });
    expect(exempt.has('2031')).toBe(true);
  });

  it('a field the redaction rules hid exempts nothing', () => {
    const exempt = exemptFromRun({
      history: [landed({ serial: 'REDACTED' }, { serial: 'response' })],
    });
    expect(
      flagged('Serial SN-99812 is healthy.', [
        landed({ serial: 'REDACTED' }, { serial: 'response' }),
      ]),
    ).toEqual(['sn-99812']);
    expect(exempt.has('sn-99812')).toBe(false);
  });

  it('a result without origins, or not an answer at all, exempts nothing', () => {
    const noOrigins: LLMMessage = {
      role: 'tool',
      toolCallId: 'c9',
      content: JSON.stringify({ status: 'input_received', values: { v: 'ARR-2291' } }),
    };
    const lookalike: LLMMessage = {
      role: 'tool',
      toolCallId: 'c8',
      content: JSON.stringify({
        status: 'ok',
        values: { v: 'ARR-2291' },
        origins: { v: 'response' },
      }),
    };
    expect(exemptFromRun({ history: [noOrigins, lookalike] }).has('arr-2291')).toBe(false);
  });

  it('a fold carries the answer’s forms in its lineage, like the person’s message', () => {
    const span = FIELD_HISTORY.slice(0, 2);
    const lineage = exemptLineageOf(span);
    expect(lineage).toEqual(expect.arrayContaining(['2026', '8:00', '08:00', '8:40']));
    const summary = buildSummaryMessage('Earlier the person picked a window.', {
      foldedMessageCount: 2,
      iteration: 2,
      model: 'mock',
      retain: 'conversation',
      foldedExempt: lineage,
    });
    expect(flagged(FIELD_ANSWER, [summary, clients])).toEqual([]);
  });
});

describe('dates and clock times — spellings, never readings', () => {
  it('the README example, verbatim', () => {
    expect(dateAndClockForms('what connected 8 Am to 8:40 AM PST')).toEqual([
      '8:00',
      '08:00',
      '8:00am',
      '8:40',
      '08:40',
      '8:40am',
    ]);
    expect(dateAndClockForms('2026-10-09')).toEqual(['2026', '10', '9']);
    expect(dateAndClockForms('took 2h')).toEqual([]);
  });

  it('a 24-hour time exempts its 12-hour spelling, and the reverse', () => {
    expect(
      flagged('It ran at 8:00 PM.', [{ role: 'user', content: 'what ran at 20:00?' }]),
    ).toEqual([]);
    expect(flagged('It ran at 20:00.', [{ role: 'user', content: 'what ran at 8 pm?' }])).toEqual(
      [],
    );
    expect(flagged('It ran at 08:40.', [{ role: 'user', content: 'what ran at 8:40?' }])).toEqual(
      [],
    );
  });

  it('a pm reading is never read again as am', () => {
    expect(dateAndClockForms('8:40 p.m.')).toEqual(['20:40', '8:40', '8:40pm']);
    expect(
      flagged('It ran at 08:40.', [{ role: 'user', content: 'what ran at 8:40 pm?' }]),
    ).toEqual(['08:40']);
  });

  it('durations, words, impossible dates and slash dates produce nothing', () => {
    expect(dateAndClockForms('took 2h, then 90 min; I am 8 amps')).toEqual([]);
    expect(dateAndClockForms('2026-13-01 and 2026-02-00 and 25:00 and 13 pm')).toEqual([]);
    expect(dateAndClockForms('10/09/2026')).toEqual([]);
  });

  it('the tool-evidence index is never widened', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'when did it fail?' },
      {
        role: 'tool',
        toolCallId: 't1',
        content: JSON.stringify({ at: '2026-10-09', time: '8 am' }),
      },
    ];
    expect(flagged('It failed in 2026 at 8:00.', history)).toEqual(['2026', '8:00']);
  });

  it('a corpus with no date or clock time is the one it always was', () => {
    const history: LLMMessage[] = [
      { role: 'system', content: 'You check arrays.' },
      { role: 'user', content: 'Check ARR-2291 and port fc1/3 at 41,200 IOPS.' },
    ];
    const forms = [...exemptFromRun({ history })];
    // Exactly the text's own tokens, in order — nothing added.
    expect(forms).toEqual([...new Set(history.flatMap((m) => tokenize(m.content)))]);
    expect(forms.some((f) => /:\d\d/.test(f))).toBe(false);
  });
});

describe('end to end — a real agent paused on a typed ask (the field run)', () => {
  const askWindow = defineTool({
    name: 'ask_window',
    description: 'ask the person for the date and timezone',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      requestInput({
        id: 'window',
        question: 'Which date and timezone?',
        fields: [
          { id: 'date', type: 'string', required: true },
          { id: 'timezone', type: 'string', required: true },
        ],
      }),
  });
  const listClients = defineTool({
    name: 'list_clients',
    description: 'clients seen on a port',
    inputSchema: { type: 'object', properties: {} },
    execute: () => [{ client: 'esx-host-17a', port: 'fc1/3' }],
  });

  const run = async (answer: string) => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'ask_window', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'list_clients', args: {} }] },
          { content: answer },
        ] as never,
      }),
      model: 'mock',
    })
      .tools([askWindow, listClients])
      .namesAndNumbersFromEvidence()
      .build();
    const paused = await agent.run({ message: QUESTION });
    if (!isInputPause(paused as never)) throw new Error('expected an input pause');
    const p = paused as { checkpoint: unknown; awaitingInput: { requestId: string } };
    await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: { date: '2026-10-09', timezone: 'America/Los_Angeles' },
    });
    return agent.unsupportedValues()?.values.map((v) => v.value);
  };

  it('the field answer is clean', async () => {
    expect(await run(FIELD_ANSWER)).toBeUndefined();
  });

  it('an invented time and year in the same run are flagged', async () => {
    expect(await run(`${FIELD_ANSWER} Another at 9:15 in 2031.`)).toEqual(['9:15', '2031']);
  });
});
