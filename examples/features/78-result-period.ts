/**
 * 78 — a result says what time its read covered: the period, and the results layer.
 *
 * A backup search reads the nightly export. The export was taken at 02:00, and the
 * person asks about "the last hour" at 10:00. The search finds nothing — and "no
 * failed backups" silently means "no failed backups in an export that ends seven
 * hours before the hour you asked about".
 *
 * The tool says what its READ covered, as data, on the result it already returns:
 *
 *   absent({ …, provenance: { measuredAt, source },
 *                period: { queried: { from, to }, held: { from, to } } })
 *
 * — the instants the read asked for, and what the store holds (or `'unknown'`,
 * said out loud). The library never parses "last hour": it compares the instants
 * the tool declared. The results layer, at the loop head, files ONE verdict per
 * call on the findings ledger:
 *
 *   - the 02:00 export asked about 09:00–10:00 → `not-held` — the answer's
 *     standing reads NOT SURE, naming `period-not-held`;
 *   - the same question inside what the export holds → `covered` — no period reason;
 *   - a tool that declares a period argument (a `ToolPeriod`) and says nothing
 *     about what its read covered → `undeclared` — silence, recorded as silence;
 *   - with `.limitsTravelWithTheAnswer()`, the answer carries one `Period:` line
 *     per declaring call, as the tool declared it.
 *
 * Run:  npm run example examples/features/78-result-period.ts
 */

import { Agent, absent, defineTool, type DeclaredPeriod, type PeriodRow } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/78-result-period',
  title: 'A result says what time its read covered — the period, and the results layer',
  group: 'features',
  description:
    'A backup search reads the 02:00 export and is asked about 09:00–10:00. Its result declares the ' +
    'period its read covered (absent({ …, provenance, period })); the results layer files one verdict ' +
    'per call (not-held · covered · undeclared), the answer’s standing reads "not sure — the store ' +
    'does not hold the period asked about", and .limitsTravelWithTheAnswer() prints the Period line.',
  defaultInput: 'Any failed backups on host-103 in the last hour?',
  // Scripted on purpose: the stale export is the case, and it is the tool's data, not the model's.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** The nightly export — its own times, the only place a declaration takes a time from. */
const nightlyExport = {
  exportedAt: '2026-09-26T02:00:00Z', // the newest data the store holds
  heldFrom: '2026-08-27T02:00:00Z', // 30 days of retention before it
  failures: [] as { host: string; job: string }[],
};

// #region result-period
function backupFailures(queried: { from: string; to: string }) {
  return defineTool({
    name: 'backup_failures',
    description: 'Failed backup jobs for one host, read from the nightly backup export.',
    inputSchema: {
      type: 'object',
      required: ['host'],
      properties: { host: { type: 'string', description: 'Host name.' } },
    },
    execute: async ({ host }: { host: string }) => {
      const snap = nightlyExport;
      // What the READ covered — computed by the tool from its own data, never parsed.
      const period: DeclaredPeriod = {
        queried, // the instants this read asked for
        held: { from: snap.heldFrom, to: snap.exportedAt }, // what the store holds
      };
      const rows = snap.failures.filter((f) => f.host === host);
      if (rows.length === 0) {
        return absent({
          what: `failed backup jobs for ${host}`,
          checked: ['every backup job in the nightly export'],
          provenance: { measuredAt: snap.exportedAt, source: 'nightly backup export' },
          period,
        });
      }
      return rows;
    },
  });
}

async function ask(queried: { from: string; to: string }, limitsTravel: boolean) {
  let builder = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-1', name: 'backup_failures', args: { host: 'host-103' } }] },
        { content: 'No failed backups on host-103.' },
      ],
    }),
    model: 'small-model',
  })
    .tool(backupFailures(queried))
    // The tool declares a period only on its results, so the layer is armed here.
    // A tool with a ToolPeriod (`period: { argument }`) arms it by itself.
    .resultsLayer();
  if (limitsTravel) builder = builder.limitsTravelWithTheAnswer();
  const agent = builder.build();
  const answer = await agent.run({ message: 'Any failed backups on host-103 in the last hour?' });
  return { agent, answer: String(answer) };
}
// #endregion result-period

/** Error lines over a look-back the `window` argument sets — declared, and a result that says nothing. */
const searchLogs = defineTool({
  name: 'search_logs',
  description: 'Error lines for one service over a look-back period.',
  inputSchema: {
    type: 'object',
    required: ['service', 'window'],
    properties: {
      service: { type: 'string', description: 'Service name.' },
      window: { type: 'string', enum: ['1h', '2h', '24h'], description: 'Look-back.' },
    },
  },
  askOrAssume: { window: { assume: '2h' } }, // a default nobody chose — recorded as one
  period: { argument: 'window', spelling: 'lookback' }, // THIS argument sets the period
  execute: async () => [], // …and the result does not say what its read covered
});

const LAST_HOUR = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const INSIDE_THE_EXPORT = { from: '2026-09-25T00:00:00Z', to: '2026-09-26T00:00:00Z' };

const periodRows = (agent: Agent): PeriodRow[] =>
  (agent.findings() ?? []).filter((r): r is PeriodRow => r.kind === 'period');

export async function run(_input: string): Promise<string> {
  // 1. The last hour, from the 02:00 export.
  const stale = await ask(LAST_HOUR, false);
  const staleStanding = (await stale.agent.assessment())!;
  console.log('the period row:   ', JSON.stringify(periodRows(stale.agent)[0]));
  console.log(
    'the standing:     ',
    staleStanding.standing,
    staleStanding.reasons.map((r) => r.reason),
  );
  check(periodRows(stale.agent)[0]?.verdict === 'not-held', 'the verdict not-held');
  check(staleStanding.standing === 'not-sure', 'the answer to read "not sure"');
  check(
    staleStanding.reasons.some((r) => r.reason === 'period-not-held'),
    'the standing to name the period the store does not hold',
  );

  // 2. The same question inside what the export holds.
  const fresh = await ask(INSIDE_THE_EXPORT, false);
  const freshStanding = (await fresh.agent.assessment())!;
  console.log('\ninside the export:', periodRows(fresh.agent)[0]?.verdict, freshStanding.reasons.map((r) => r.reason));
  check(periodRows(fresh.agent)[0]?.verdict === 'covered', 'the verdict covered');
  check(
    !freshStanding.reasons.some((r) => r.reason.startsWith('period-')),
    'no period reason when the store holds the period',
  );

  // 3. The limits travel with the answer — the Period line, as the tool declared it.
  const travelled = await ask(LAST_HOUR, true);
  console.log('\nwith .limitsTravelWithTheAnswer():\n' + travelled.answer);
  check(
    travelled.answer.includes(
      'Period:\n- backup_failures queried 2026-09-26T09:00:00Z to 2026-09-26T10:00:00Z; the store ' +
        'holds 2026-08-27T02:00:00Z to 2026-09-26T02:00:00Z',
    ),
    'the answer to carry the Period line',
  );

  // 4. A tool that declares WHICH argument sets its period (a ToolPeriod) — and a
  //    result that says nothing about what its read covered: `undeclared`.
  const silent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-1', name: 'search_logs', args: { service: 'checkout' } }] },
        { content: 'No errors on checkout.' },
      ],
    }),
    model: 'small-model',
  })
    .tool(searchLogs) // a registered ToolPeriod arms the layer by itself — no .resultsLayer()
    .build();
  await silent.run({ message: 'Any errors on checkout?' });
  const silentStanding = (await silent.assessment())!;
  console.log(
    '\na ToolPeriod, a silent result:',
    JSON.stringify(periodRows(silent)[0]),
    silentStanding.reasons.map((r) => r.reason),
  );
  check(periodRows(silent)[0]?.verdict === 'undeclared', 'the verdict undeclared');
  check(
    silentStanding.reasons.some((r) => r.reason === 'period-undeclared'),
    'the standing to name the silence about the period',
  );
  return `${staleStanding.standing} · ${staleStanding.reasons.map((r) => r.reason).join(', ')}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
