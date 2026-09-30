/**
 * 88 — the result checks: what a call READ, against what it ASKED.
 *
 *   .time({ zone }) + .limitsTravelWithTheAnswer()
 *
 *   - a tool that clamps the person's 30 days to the last 7 and declares so:
 *     the call's `period` row carries `differs.missing` (the first 23 days),
 *     the answer's standing folds `period-differs-from-asked` — "not sure" —
 *     and the limits block says it in the person's zone;
 *   - the same tool asked for the last 7 days: read exactly what was asked —
 *     nothing added to the row, no reason;
 *   - a window older than the tool declares its source keeps: refused before
 *     it ran, and the answer reads "not sure" (`period-beyond-retention`).
 *
 * One owner compares: `core/time/check.ts` · `periodTimeCheck`.
 *
 * Run:  npm run example examples/features/88-time-result-checks.ts
 */

import { Agent, defineTool, describedResult } from '../../src/index.js';
import { assessAnswer } from '../../src/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/88-time-result-checks',
  title: 'Result checks — what a call read, against what it asked',
  group: 'features',
  description:
    "Under .time(), each call's read (its result's declared period, a widened fill, a look-back " +
    'shifted by a pause) is compared with the window it asked for: a narrower, wider or shifted ' +
    'read, or a window older than the source keeps, is recorded on the call’s period row, makes ' +
    'the answer "not sure", and is said in the limits block in the person’s zone.',
  defaultInput: 'Client activity over the last 30 days?',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

// #region result-checks
const clientActivity = defineTool({
  name: 'client_activity',
  description: 'Client operations over a window. The store keeps 90 days; a read covers 7 at most.',
  inputSchema: {
    type: 'object',
    properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
  },
  askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'start_time', as: 'epoch-ms' },
        to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
      },
    ],
    retention: '90d',
  },
  execute: (args) => {
    // The store clamps a read to its last 7 days — and SAYS what it read (inclusive ends).
    const from = Math.max(Number(args.start_time), Number(args.end_time) - 7 * DAY);
    return describedResult({
      facts: [{ entity: 'client', operations: 42 }],
      provenance: { measuredAt: NOW, source: 'activity store' },
      period: {
        queried: { from: iso(from), to: iso(Number(args.end_time) - 1) },
        held: { from: iso(NOW_MS - 90 * DAY), to: NOW },
      },
    });
  },
});

/** The model calls the tool with the period left out (the library fills the person's window). */
function desk(args: Record<string, unknown> = {}) {
  let calls = 0;
  return Agent.create({
    provider: mock({
      respond: () => {
        calls += 1;
        return calls === 1
          ? { content: '', toolCalls: [{ id: 'c1', name: 'client_activity', args }] }
          : { content: '42 operations.' };
      },
    }),
    model: 'small-model',
  })
    .tool(clientActivity)
    .time({ zone: 'America/Los_Angeles' })
    .limitsTravelWithTheAnswer()
    .build();
}
// #endregion result-checks

type Row = { kind: string; differs?: { missing: unknown[]; extra: unknown[] } };

async function ask(window?: { from: string; to: string }, args: Record<string, unknown> = {}) {
  const agent = desk(args);
  const answer = String(
    await agent.run({ message: 'client activity', time: { now: NOW, ...(window && { window }) } }),
  );
  const rows = (agent.findings() ?? []) as readonly Row[];
  const assessment = assessAnswer({ snapshot: agent.getLastSnapshot() });
  return {
    answer,
    period: rows.find((r) => r.kind === 'period'),
    standing: assessment.standing,
    reasons: assessment.reasons.map((r) => r.reason),
  };
}

export async function run(_input: string): Promise<string> {
  // 1. Thirty days asked, seven read: `missing`, "not sure", said in the limits block.
  const clamped = await ask({ from: iso(NOW_MS - 30 * DAY), to: NOW });
  console.log('30 days asked →', clamped.reasons, clamped.standing);
  console.log(
    clamped.answer
      .split('\n')
      .filter((l) => l.includes('read less'))
      .join('\n'),
  );
  check(clamped.period?.differs?.missing.length === 1, 'the first 23 days are missing');
  check(clamped.reasons.includes('period-differs-from-asked'), 'the reason');
  check(clamped.standing === 'not-sure', '"not sure"');

  // 2. Seven days asked, seven read: nothing to say.
  const exact = await ask({ from: iso(NOW_MS - 7 * DAY), to: NOW });
  console.log('7 days asked  →', exact.reasons);
  check(exact.period?.differs === undefined, 'no difference');
  check(!exact.reasons.includes('period-differs-from-asked'), 'no reason');

  // 3. A window older than the source keeps: refused before it ran, "not sure".
  const old = await ask(undefined, {
    start_time: NOW_MS - 120 * DAY,
    end_time: NOW_MS - 100 * DAY,
  });
  console.log('120 days ago  →', old.reasons, old.standing);
  check(old.reasons.includes('period-beyond-retention'), 'beyond retention');
  return clamped.standing;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
