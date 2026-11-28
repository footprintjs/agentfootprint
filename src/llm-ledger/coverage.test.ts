import { expect, it } from 'vitest';

import { createLedger } from './ledger.js';
import { memoryLedgerStore } from './memoryStore.js';

const clock = () => '2026-11-27T10:00:00Z';
const rules = ['cited@1', 'traceable-values@2', 'time-window@2'];

it('opens a sure claim on a cited cap, in both preview and submit', async () => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock });
  const opened = await ledger.host.open({ rules, askRunsRules: true });
  expect(opened.ok).toBe(true);
  const session = opened.session as string;
  const record = await ledger.host.record(session, {
    source: 'logs',
    text: 'id-1234',
    limit: { rows: 1, hit: true },
  });
  expect(record.ok).toBe(true);
  const agent = createLedger({ store, clock }).agentFor(session);
  expect(
    await agent.note({
      kind: 'claim',
      claimStanding: 'sure',
      text: 'id-1234',
      cites: [2],
    }),
  ).toMatchObject({ ok: true });
  const expected = {
    ok: true,
    report: {
      claims: [
        {
          checks: expect.arrayContaining([
            expect.objectContaining({
              rule: 'time-window@2',
              disposition: 'unreachable',
              verdict: 'open',
              restsOn: [2],
              counts: expect.objectContaining({ missing: 0 }),
            }),
          ]),
        },
      ],
    },
  };
  expect(await agent.ask()).toMatchObject(expected);
  expect(await agent.submit({ draft: 'id-1234', claims: [3] })).toMatchObject(expected);
});

it('refuses typed standing before append on a restored v1 ledger', async () => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock });
  const opened = await ledger.host.open();
  const session = opened.session as string;
  const agent = createLedger({ store, clock }).agentFor(session);
  expect(
    await agent.note({
      kind: 'claim',
      text: 'id-1234',
      claimStanding: 'qualified',
      cites: [],
    }),
  ).toMatchObject({ ok: false, refused: 'bad-input' });
  expect((await store.load(session)).seq).toBe(1);
  expect(await agent.note({ kind: 'claim', text: 'id-1234', cites: [] })).toMatchObject({
    ok: true,
  });
});

it('refuses a restored v1 log with an illegally stamped note before evaluating', async () => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock });
  const opened = await ledger.host.open({ askRunsRules: true });
  const session = opened.session as string;
  const agent = ledger.agentFor(session);
  expect(await agent.note({ kind: 'claim', text: 'id-1234', cites: [] })).toMatchObject({
    ok: true,
  });

  const restored = createLedger({
    clock,
    store: {
      append: store.append,
      async load(id) {
        const log = await store.load(id);
        return {
          ...log,
          entries: log.entries.map((entry) =>
            entry.kind === 'note' ? { ...entry, claimStanding: 'sure' } : entry,
          ),
        };
      },
    },
  }).agentFor(session);
  const refused = { ok: false, refused: 'store-refused', store: 'malformed' };
  expect(await restored.ask()).toMatchObject(refused);
  expect(await restored.submit({ draft: 'id-1234', claims: [2] })).toMatchObject(refused);
  expect((await store.load(session)).seq).toBe(2);
});

it('keeps qualified, uncited, withdrawn and out-of-window evidence out of the coverage decision', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock });
  const opened = await ledger.host.open({ rules, askRunsRules: true });
  const session = opened.session as string;
  const window = { from: '2026-11-27T10:00:00Z', to: '2026-11-27T11:00:00Z' };
  const later = { from: window.to, to: '2026-11-27T12:00:00Z' };
  for (const input of [
    { source: 'in', text: 'id-1234', window },
    { source: 'later', text: 'id-1234', window: later, limit: { rows: 1, hit: true } },
    { source: 'uncited', text: 'id-1234', limit: { rows: 1, hit: true } },
  ])
    expect(await ledger.host.record(session, input)).toMatchObject({ ok: true });
  const agent = ledger.agentFor(session);
  for (const input of [
    { claimStanding: 'sure', window, cites: [2, 3] },
    { claimStanding: 'qualified', cites: [3] },
    { claimStanding: 'sure', cites: [3] },
  ])
    expect(await agent.note({ kind: 'claim', text: 'id-1234', ...input })).toMatchObject({
      ok: true,
    });
  expect(await agent.withdraw({ note: 7, why: 'superseded' })).toMatchObject({ ok: true });
  expect(await agent.ask()).toMatchObject({
    ok: true,
    report: {
      claims: [5, 6].map((note) => ({
        note,
        checks: expect.arrayContaining([
          expect.objectContaining({
            rule: 'time-window@2',
            disposition: 'not-applicable',
          }),
        ]),
      })),
    },
  });
});

it.each([
  {
    input: { text: '', nothingFound: true },
    label: 'coverage: a cited search reported no result',
  },
  {
    input: { text: Array.from({ length: 2_060 }, (_, i) => `id-${i}`).join(' ') },
    label: 'coverage: a cited receipt was cut',
  },
  {
    input: { text: 'id-1234' },
    window: { from: '2026-11-27T10:00:00Z', to: '2026-11-27T11:00:00Z' },
    label: 'coverage: cited windows do not establish the claimed extent',
  },
])('records $label on a sure ruled-out note', async ({ input, window, label }) => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock });
  const opened = await ledger.host.open({ rules });
  const session = opened.session as string;
  expect(await ledger.host.record(session, { source: 'logs', ...input })).toMatchObject({
    ok: true,
  });
  const agent = ledger.agentFor(session);
  expect(
    await agent.note({
      kind: 'ruled-out',
      text: 'None found.',
      claimStanding: 'sure',
      cites: [2],
      ...(window === undefined ? {} : { window }),
    }),
  ).toMatchObject({ ok: true });
  expect(await agent.submit({ draft: 'None found.', claims: [3] })).toMatchObject({ ok: true });
  expect((await store.load(session)).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'check',
        rule: 'time-window@2',
        subject: { note: 3 },
        verdict: 'open',
        decision: expect.objectContaining({ label }),
      }),
    ]),
  );
});
