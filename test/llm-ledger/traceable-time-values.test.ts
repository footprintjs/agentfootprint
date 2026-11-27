import { expect, it } from 'vitest';
import { canonicalizeJson } from 'foottrace/canonical-json';
import { createLedger } from '../../src/llm-ledger/ledger.js';
import { memoryLedgerStore } from '../../src/llm-ledger/memoryStore.js';
import type { LedgerEntry } from '../../src/llm-ledger/types.js';
import legacy from './fixtures/value-law-v1.json';

const at = '2026-11-27T15:00:00Z';

async function inspect(text: string, evidence: string | readonly string[], supplied?: string) {
  const ledger = createLedger({ store: memoryLedgerStore(), clock: () => at });
  const opened = await ledger.host.open({ askRunsRules: true });
  if (!opened.ok || !('session' in opened)) throw new Error('Fixture session did not open.');
  const { session } = opened;
  const receipts = typeof evidence === 'string' ? [evidence] : evidence;
  for (const receipt of receipts)
    await ledger.host.record(session, { source: 'fixture', text: receipt, how: 'observed' });
  if (supplied !== undefined) await ledger.host.supply(session, { from: 'person', text: supplied });
  const agent = ledger.agentFor(session);
  const noted = await agent.note({
    kind: 'claim',
    text,
    cites: receipts.map((_, index) => index + 2),
  });
  if (!noted.ok || !('note' in noted)) throw new Error('Fixture note was refused.');
  const asked = await agent.ask();
  const submitted = await agent.submit({ draft: text, claims: [noted.note] });
  if (
    !asked.ok ||
    !('report' in asked) ||
    !submitted.ok ||
    !('report' in submitted) ||
    asked.report === undefined ||
    submitted.report === undefined
  )
    throw new Error('Fixture rule did not run.');
  return [
    asked.report.claims[0]?.checks.find((check) => check.rule.startsWith('traceable-values@')),
    submitted.report.claims[0]?.checks.find((check) => check.rule.startsWith('traceable-values@')),
    submitted.report.draft?.checks.find((check) => check.rule.startsWith('traceable-values@')),
  ];
}

it.each([
  ['2026-11-21T02:14:18Z', '2026-11-20T20:14:18-06:00', 'checked-pass'],
  ['2026-11-21T02:14:18.100Z', '2026-11-21T03:14:18.1+01:00', 'checked-pass'],
  ['2026-11-21T02:14:18.101Z', '2026-11-21T03:14:18.100+01:00', 'checked-fail'],
  ['2026-11-21T02:14:18.101Z', '2026-11-21T03:14:18.1+01:00', 'unreachable'],
  ['2026-11-21T02:14Z', '2026-11-20T20:14:18-06:00', 'checked-pass'],
  ['2026-11-21T02:14:18Z', '2026-11-20T20:14-06:00', 'unreachable'],
  ['2026-11-21T02:14Z', '2026-11-21T02:14-00:00', 'unreachable'],
  ['2026-11-21T02:14-00:00', '2026-11-21T02:14Z', 'unreachable'],
  ['2026-11-21T02:14:18Z', '2026-11-21T02:14:18-00:00', 'unreachable'],
  ['2026-11-21T02:14:18Z', '2020-01-01T02:14:18-00:00', 'checked-fail'],
  ['2026-11-21T02:14:18Z', '2026-11-20T02:15:18', 'unreachable'],
  ['2026-11-21T02:14:18Z', '2026-11-20T02:14:18', 'checked-fail'],
  ['2026-11-21T02:14:18Z', '2026-11-21T03:15:19-00:00', 'checked-fail'],
  ['2026-11-21T02:14Z', '2026-11-21T03:15:19-00:00', 'unreachable'],
  ['2026-11-21T02:14:18Z', '2026-11-21T03:15-00:00', 'unreachable'],
  ['2026-11-21T02:14:18Z', '2026-11-31T02:14:18-00:00', 'checked-fail'],
  ['2026-11-21T02:14:18Z', '20:14:18-06:00', 'unreachable'],
  ['2026-11-21T02:14:18Z', '20:15:18-06:00', 'checked-fail'],
  ['2026-11-21T02:14:18Z', '20:15:18', 'unreachable'],
  ['2026-11-21T02:14:18Z', '20:15:19', 'checked-fail'],
  ['2026-11-21T02:14:18-00:00', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['02:14Z', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['02:14 UTC', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['2:14am', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['at 2:14', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['2026-11-21 02:14', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['02:14Z', '2026-11-21T03:14:18+01:00', 'checked-pass'],
  ['03:14', '2026-11-21T03:14:18+01:00', 'checked-pass'],
  ['05:55', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['05:55Z', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['02:14+05:30', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['2026-11-31T02:14:18Z', '2026-11-31T02:14:18Z', 'checked-fail'],
  ['2026-11-21T24:00Z', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['23:59:60Z', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['2026-11-21T02:14:18Z', '2026-11-21T02:14:18.123456Z', 'checked-pass'],
  ['2026-11-21T02:14:18.123Z', '2026-11-21T02:14:18.123456Z', 'checked-pass'],
  ['2026-11-21T02:14:18.123457Z', '2026-11-21T02:14:18.123456Z', 'checked-fail'],
  ['02:14', '2026-11-21T02:14:18Z and 02:14', 'checked-pass'],
  ['02:14 and id-4040', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['02:14 CST', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 CST: alarm', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 PST', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 EST', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 ist', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 local time', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 America/Chicago', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14cst', '2026-11-21T02:14:18Z', 'unreachable'],
  ['At 2026-11-21 02:14 CST', '2026-11-21T02:14:18Z', 'unreachable'],
  ['2026-11-21T02:14 XYZ', '2026-11-21T02:14:18Z', 'unreachable'],
  ['02:14 CST', 'unrelated id-4040', 'unreachable'],
  ['02:14 CST and id-4040', '2026-11-21T02:14:18Z', 'checked-fail'],
  ['2:14 am', '2026-11-21T02:14:18Z', 'checked-pass'],
  ['2:14 pm', '2026-11-21T14:14:18Z', 'checked-pass'],
  ['2:14 pm PST', '2026-11-21T14:14:18Z', 'unreachable'],
  ['2:14pm PST', '2026-11-21T14:14:18Z', 'unreachable'],
  ['2:14 pm UTC', '2026-11-21T15:14:18+01:00', 'checked-pass'],
  ['12:14am', '2026-11-21T00:14:18Z', 'checked-pass'],
  ['02:14 UTC', '2026-11-21T03:14:18+01:00', 'checked-pass'],
  ['02:14 Z', '2026-11-21T03:14:18+01:00', 'checked-pass'],
  ['02:14-02:20', '2026-11-21T04:34:18Z', 'checked-fail'],
  ['02:14+14:15', '2026-11-20T11:59:18Z', 'checked-fail'],
  ['02:14+05:45', '2026-11-20T20:29:18Z', 'checked-pass'],
  ['The check ran at 02:14 on Friday', '2026-11-21T02:14:18Z', 'checked-pass'],
] as const)('compares %s with %s on each door', async (text, evidence, disposition) => {
  const checks = await inspect(text, evidence);
  expect(checks).toHaveLength(3);
  for (const check of checks)
    expect(check).toMatchObject({
      rule: 'traceable-values@2',
      disposition,
      restsOn: disposition === 'checked-pass' || text.startsWith('02:14 and id-4040') ? [2] : [],
    });
});

it.each([
  [['2026-11-21T02:14:18Z', '2026-11-22T02:14:18Z'], 'unreachable'],
  [['2026-11-21T02:14:18Z', '2026-11-21T02:14:18-00:00'], 'unreachable'],
  [['2026-11-21T02:14:18Z', '02:14'], 'unreachable'],
  [['2026-11-21T02:14:18Z', '2026-11-20T20:14:18-06:00'], 'checked-pass'],
  [['2026-11-21T02:14:18Z', '2026-11-21T02:14:38Z'], 'checked-pass'],
] as const)(
  'requires one instant at the written precision across the receipts for a dateless UTC clock: %j',
  async (receipts, disposition) => {
    const checks = await inspect('02:14Z', receipts);
    for (const check of checks) expect(check?.disposition).toBe(disposition);
  },
);

it.each([65, 110])(
  'keeps a zone with %i letters out of stored tokens on all doors',
  async (size) => {
    const checks = await inspect('02:14 Area/' + 'a'.repeat(size), '2026-11-21T02:14:18Z');
    expect(checks).toHaveLength(3);
    for (const check of checks)
      expect(check).toMatchObject({
        disposition: 'unreachable',
        verdict: 'open',
        restsOn: [],
        missing: ['02:14'],
      });
  },
);

it('an equivalent value supplied by the person remains exempt', async () => {
  const checks = await inspect(
    '2026-11-21T02:14:18Z',
    'unrelated id-2026',
    '2026-11-20T20:14:18-06:00',
  );
  for (const check of checks)
    expect(check).toMatchObject({
      disposition: 'unreachable',
      restsOn: [],
      counts: { supplied: 1, missing: 0 },
    });
});

it('restores version-1 bytes and writes only version-2 checks on the next submit', async () => {
  const store = memoryLedgerStore();
  const session = 'ls_0000000000000000000000000A';
  const oldEntries = legacy.entries as LedgerEntry[];
  expect(await store.append(session, 0, oldEntries)).toBe(oldEntries.length);
  const ledger = createLedger({ store, clock: () => at });
  const reread = await ledger.host.report(session);
  expect(reread).toMatchObject({ ok: true });
  if (!reread.ok || !('report' in reread)) throw new Error('Legacy report was refused.');
  expect(canonicalizeJson(reread.report)).toBe(canonicalizeJson(legacy.report));
  const agent = ledger.agentFor(session);
  const note = await agent.note({ kind: 'ruled-out', text: '2026-11-21T02:14:18Z', cites: [2] });
  if (!note.ok || !('note' in note)) throw new Error('Version-2 note was refused.');
  const ask = await agent.ask();
  expect(ask).toMatchObject({
    report: {
      claims: expect.arrayContaining([
        expect.objectContaining({
          note: note.note,
          checks: [expect.objectContaining({ rule: 'traceable-values@2' })],
        }),
      ]),
    },
  });
  await agent.submit({ draft: '2026-11-21T02:14:18Z', claims: [note.note] });
  const { entries } = await store.load(session);
  expect(canonicalizeJson(entries.slice(0, oldEntries.length))).toBe(
    canonicalizeJson(legacy.entries),
  );
  expect(entries.flatMap((entry) => (entry.kind === 'check' ? [entry.rule] : []))).toEqual([
    'traceable-values@1',
    'traceable-values@1',
    'traceable-values@2',
    'traceable-values@2',
  ]);
});

it('keeps claim evidence within its citations and prefers observed evidence across spellings', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock: () => at });
  const opened = await ledger.host.open({ askRunsRules: true });
  if (!opened.ok || !('session' in opened)) throw new Error('Fixture session did not open.');
  const { session } = opened;
  const stamp = '2026-11-21T02:14:18Z';
  for (const [text, how] of [
    [stamp, 'reported'],
    ['2026-11-20T20:14:18-06:00', 'observed'],
    ['2026-11-20T20:15:18-06:00', 'observed'],
  ] as const)
    await ledger.host.record(session, { source: 'fixture', text, how });
  const agent = ledger.agentFor(session);
  for (const cites of [[2], [2, 3], [4]]) await agent.note({ kind: 'claim', text: stamp, cites });
  const request = await agent.ask();
  if (!request.ok || !('report' in request) || request.report === undefined)
    throw new Error('Fixture did not produce a report.');
  expect(
    request.report.claims.map((claim) =>
      claim.checks.find((check) => check.rule === 'traceable-values@2'),
    ),
  ).toMatchObject([
    { verdict: 'consistent-with-reported', restsOn: [2] },
    { verdict: 'verified', restsOn: [3] },
    { verdict: 'unsupported', restsOn: [] },
  ]);
});
