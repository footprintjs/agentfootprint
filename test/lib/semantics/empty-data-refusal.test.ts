/**
 * The empty-data refusal names `absent()` (honesty step 7a′).
 *
 * A data list on a described result is never empty — `series`, `facts` and
 * `edges` must hold at least one entry — so "nothing matched" has exactly ONE
 * door: `absent()`. The rule is unchanged. What changed is the advice the
 * refusal gives. It used to say "omit the field to say nothing", and an author
 * who followed it on the found branch's only data field walked straight into
 * the next refusal ("this result declares nothing"). Worse, the fault is
 * data-dependent: a tool with no empty branch passes every test that has rows
 * and refuses on its first empty read in production, where the MODEL reads the
 * refusal instead of "nothing matched". So the refusal now names the branch to
 * write:
 *
 *   refused: `facts` is empty — if nothing matched, return absent({ what, checked }) instead.
 *
 * One core (`lib/semantics/envelope.ts` · `semanticIssues`), so both
 * declaration and wire-reading paths — `describedResult()` and `readSemantics()` —
 * refuse in the same words, the `check:semantics` gate names the same fault on
 * a sample that exercises an empty branch, and a marker-bearing envelope minted
 * elsewhere with an empty list stays data (dev-warned with the same words).
 *
 * Sections follow Convention 3: Unit (the words, per field and per path; a
 * non-array keeps the message it always had) · Functional (the gate; the
 * recognizer) · Integration (the real loop: what the model reads, and that the
 * run continues; the branch the refusal asks for) · Property (every field ×
 * each path × arbitrary sibling fields: the same refusal, never the old
 * advice) · Security (the refusal quotes nothing the caller declared) ·
 * Byte identity (a well-formed envelope mints what it always minted — the
 * existing goldens, test/lib/semantics/described-result.test.ts and
 * test/core/agent/coverage-declaration-refusals.test.ts, stay unchanged; one
 * pin here). Performance does not apply: the change is one constant message on
 * a path that already refused.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  absent,
  defineTool,
  describedResult,
  explainSemantics,
  readSemantics,
  SEMANTICS_NOTE,
} from '../../../src/index.js';
import { checkSemantics } from '../../../src/lib/semantics/index.js';
import { REFUSED_PREFIX } from '../../../src/core/agent/coverage/refusal.js';
import type { LLMMessage, LLMRequest } from '../../../src/adapters/types.js';
import { mock } from '../../../src/llm-providers.js';

const DATA_FIELDS = ['series', 'facts', 'edges'] as const;
type DataField = (typeof DATA_FIELDS)[number];

/** The refusal's body for one field — the words the model reads after `refused: `. */
const EMPTY = (field: DataField): string =>
  `\`${field}\` is empty — if nothing matched, return absent({ what, checked }) instead.`;

/** The message a door threw, or a failure when it minted. */
const refusalOf = (mint: () => unknown): string => {
  try {
    mint();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and the door minted');
};

/** A declaration whose ONLY problem is one empty data list, in each door's spelling. */
function emptyDeclaration(field: DataField, door: 'described' | 'wire'): never {
  const provenance =
    door === 'described'
      ? { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' }
      : { measured_at: '2026-09-26T02:00:00Z', source: 'nightly export' };
  const grain =
    door === 'described'
      ? { interval: '1h', aggregation: 'avg', isCounter: false }
      : { interval: '1h', aggregation: 'avg', is_counter: false };
  const decl: Record<string, unknown> = { [field]: [] };
  if (field !== 'edges') decl.provenance = provenance;
  if (field === 'series') decl.grain = grain;
  return decl as never;
}

// ─────────────────────────────────────────────────────────────────────────
// Unit — the words
// ─────────────────────────────────────────────────────────────────────────

describe('unit: an empty data list is refused naming absent()', () => {
  for (const field of DATA_FIELDS) {
    it(`describedResult({ ${field}: [] }) — the refusal names the door for "nothing matched"`, () => {
      const message = refusalOf(() => describedResult(emptyDeclaration(field, 'described')));
      expect(message).toBe(`${REFUSED_PREFIX}${EMPTY(field)} (field: ${field})`);
    });

    it(`a saved ${field}: [] is refused by the reader with the same shared rule`, () => {
      const record = {
        af_semantics: true,
        ...(emptyDeclaration(field, 'wire') as Record<string, unknown>),
        note: SEMANTICS_NOTE,
      };
      expect(readSemantics(record)).toBeUndefined();
      const fault = explainSemantics(record)?.[0];
      const viaSemantic = `${REFUSED_PREFIX}${fault?.message} (field: ${fault?.field})`;
      const viaDescribed = refusalOf(() => describedResult(emptyDeclaration(field, 'described')));
      expect(viaSemantic).toBe(viaDescribed);
    });
  }

  it('never gives the advice that led to the next refusal', () => {
    for (const field of DATA_FIELDS) {
      const message = refusalOf(() => describedResult(emptyDeclaration(field, 'described')));
      expect(message).not.toContain('omit the field');
      expect(message).not.toContain('declares nothing');
    }
  });

  it('a value that is not a list is refused AS one — a refusal, never a crash', () => {
    const provenance = { measuredAt: 'now', source: 'export' };
    // A string used to be spread into its characters and refused as a malformed ROW.
    expect(refusalOf(() => describedResult({ facts: 'vm-01' as never, provenance }))).toBe(
      `${REFUSED_PREFIX}\`facts\` must be a non-empty array of rows — omit the field to say ` +
        'nothing. (field: facts)',
    );
    // A plain object or a number used to throw a TypeError ("… is not iterable"),
    // which does not read as a refusal in the one place the model reads it.
    for (const value of [{}, 5, true]) {
      const viaSemantic = refusalOf(() => describedResult({ edges: value as never }));
      expect(viaSemantic.startsWith(REFUSED_PREFIX)).toBe(true);
      expect(viaSemantic).toContain('`edges` must be a non-empty array of { from, to, kind }');
      const viaDescribed = refusalOf(() => describedResult({ series: value as never } as never));
      expect(viaDescribed).toContain('`series` must be a non-empty array of');
    }
  });

  it('an iterable that is not an array still mints, as it always did (copied into a fresh array)', () => {
    const rows = new Set([{ entity: 'vm-01', ok: true }]);
    const minted = describedResult({
      facts: rows as never,
      provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' },
    });
    expect(minted.facts).toEqual([{ entity: 'vm-01', ok: true }]);
    expect(Array.isArray(minted.facts)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the gate and the recognizer say the same
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the gate and the recognizer name the same door', () => {
  const emptyEnvelope = {
    af_semantics: true,
    facts: [],
    provenance: { measured_at: '2026-09-26T02:00:00Z', source: 'nightly export' },
    note: 'minted elsewhere',
  };

  it('check:semantics — a sample that exercises the empty branch names absent() in its finding', () => {
    const report = checkSemantics([{ name: 'backup_runs', results: [emptyEnvelope] }]);
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.field === 'facts');
    expect(finding?.code).toBe('malformed-semantics');
    expect(finding?.message).toBe(`tool 'backup_runs', sample result 1: ${EMPTY('facts')}`);
  });

  it('a marker-bearing envelope with an empty list stays DATA — never half-applied', () => {
    expect(readSemantics(emptyEnvelope)).toBeUndefined();
    const issues = explainSemantics(emptyEnvelope);
    expect(issues?.[0]).toEqual({
      code: 'malformed-semantics',
      field: 'facts',
      message: EMPTY('facts'),
    });
  });

  it('the absence the refusal names is a real door: absent() mints where describedResult() refused', () => {
    const minted = absent({ what: 'backup runs for vm-99', checked: ['the nightly export'] });
    expect(minted.af_absent).toBe(true);
    expect(minted.outcome).toBe('nothing_found');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — through the real loop
// ─────────────────────────────────────────────────────────────────────────

describe('integration: through the real loop', () => {
  /** One call to `backup_runs`, then an answer. Returns the tool message the MODEL was sent. */
  const runOnce = async (execute: () => unknown) => {
    const requests: LLMRequest[] = [];
    const statuses: unknown[] = [];
    let calls = 0;
    const agent = Agent.create({
      provider: mock({
        respond: (req) => {
          requests.push(req);
          calls += 1;
          return calls === 1
            ? {
                content: '',
                toolCalls: [{ id: 't1', name: 'backup_runs', args: { host: 'vm-99' } }],
                stopReason: 'tool_use' as const,
              }
            : { content: 'No backup runs for vm-99 in the export.' };
        },
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .tool(
        defineTool({
          name: 'backup_runs',
          description: 'Backup runs for one host, read from the nightly export',
          inputSchema: {
            type: 'object',
            properties: { host: { type: 'string' } },
            required: ['host'],
          },
          execute,
        }),
      )
      .build();
    agent.on('agentfootprint.stream.tool_end', (e) => statuses.push(e.payload.status));
    const answer = await agent.run({ message: 'Any backup runs for vm-99?' });
    const tool = requests[1]?.messages.find((m: LLMMessage) => m.role === 'tool');
    const text = typeof tool?.content === 'string' ? tool.content : JSON.stringify(tool?.content);
    return { text, statuses, answer: String(answer) };
  };

  it('the model reads the refusal that names absent(), and the run continues', async () => {
    const { text, answer } = await runOnce(() =>
      describedResult({
        facts: [],
        provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' },
      }),
    );
    expect(text).toBe(`${REFUSED_PREFIX}${EMPTY('facts')} (field: facts)`);
    expect(answer).toBe('No backup runs for vm-99 in the export.');
  });

  it('the branch the refusal asks for — rows.length ? describedResult : absent — delivers an absence', async () => {
    const rows: { entity: string; ok: boolean }[] = [];
    const { text, statuses } = await runOnce(() =>
      rows.length > 0
        ? describedResult({
            facts: rows,
            provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' },
          })
        : absent({ what: 'backup runs for vm-99', checked: ['every job in the 02:00 export'] }),
    );
    expect(text.startsWith('{"af_absent":true')).toBe(true);
    expect(statuses).toEqual(['absent']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property — every field × each path × arbitrary siblings
// ─────────────────────────────────────────────────────────────────────────

describe('property: an empty data list refuses the same way whatever else the declaration holds', () => {
  let seed = 7_202_609;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  it('500 declarations: the first fault is the empty list, in the same words through authoring and recorded-wire reading', () => {
    for (let i = 0; i < 500; i += 1) {
      const field = pick(DATA_FIELDS);
      // The empty list is the FIRST data field the rule set judges when it is
      // `series`; for the others, keep the earlier data fields absent so the
      // empty one is the first fault, and vary everything that follows it.
      const described = { ...(emptyDeclaration(field, 'described') as Record<string, unknown>) };
      const snake = { ...(emptyDeclaration(field, 'wire') as Record<string, unknown>) };
      if (rnd() < 0.5) {
        described.clarify = null;
        snake.clarify = null;
      }
      if (rnd() < 0.5) {
        const coverage = { checked: [`the export of day ${i}`] };
        described.coverage = coverage;
        snake.coverage = coverage;
      }
      const a = refusalOf(() => describedResult(described as never));
      const record = { af_semantics: true, ...snake, note: SEMANTICS_NOTE };
      expect(readSemantics(record)).toBeUndefined();
      const fault = explainSemantics(record)?.[0];
      const b = `${REFUSED_PREFIX}${fault?.message} (field: ${fault?.field})`;
      expect(a).toBe(`${REFUSED_PREFIX}${EMPTY(field)} (field: ${field})`);
      expect(b).toBe(a);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — the refusal is library text; it quotes nothing declared
// ─────────────────────────────────────────────────────────────────────────

describe('security: the refusal carries none of the caller’s values', () => {
  it('a provenance, a coverage line and a render hint never reach the refusal the model reads', () => {
    const message = refusalOf(() =>
      describedResult({
        facts: [],
        provenance: { measuredAt: 'SECRET-TIME', source: 'SECRET-SOURCE' },
        coverage: { checked: ['SECRET-SCOPE'] },
        render: { default: 'table', filterNote: 'SECRET-NOTE' },
      }),
    );
    expect(message).not.toMatch(/SECRET/);
    expect(message).toBe(`${REFUSED_PREFIX}${EMPTY('facts')} (field: facts)`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Byte identity — a well-formed envelope is untouched
// ─────────────────────────────────────────────────────────────────────────

describe('byte identity: a well-formed envelope mints what it always minted', () => {
  it('one row of facts — the wire, key for key (pinned before this change)', () => {
    expect(
      JSON.stringify(
        describedResult({
          facts: [{ entity: 'vm-01', ok: true }],
          provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' },
        }),
      ),
    ).toBe(
      '{"af_semantics":true,"facts":[{"entity":"vm-01","ok":true}],"provenance":' +
        '{"measured_at":"2026-09-26T02:00:00Z","source":"nightly export"},"note":' +
        JSON.stringify(
          'Typed data, not prose. `grain` and `provenance` are caveats that travel with the ' +
            'numbers: check `is_counter` before summing values from a series, read `measured_at` ' +
            '(and `age_seconds`) as how old the data is, and treat everything under `not_covered` ' +
            'as ground this result does NOT cover — a clean look here says nothing about it.',
        ) +
        '}',
    );
  });
});
