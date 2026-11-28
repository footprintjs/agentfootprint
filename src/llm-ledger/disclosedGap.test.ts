import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { entryFault } from './entries.js';
import { fileLedgerStore } from './fileStore.js';
import { createLedger } from './ledger.js';
import { LEDGER_LIMITS } from './limits.js';
import { memoryLedgerStore } from './memoryStore.js';
import type { LedgerServed } from './serve.js';
import type { LedgerEntry } from './types.js';

const at = '2026-11-25T10:00:00Z';
const window = { from: '2026-11-25T09:00:00Z', to: at };
const observed = { from: '2026-11-25T09:30:00Z', to: at };
const gap = { kind: 'disclosed-gap', text: 'Collector gap for port-1234', window };
const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function newFileStore() {
  const dir = mkdtempSync(join(tmpdir(), 'af-disclosed-gap-'));
  temporary.push(dir);
  const options = {
    dir: join(dir, 'ledger'),
    key: new Uint8Array(32).fill(23),
    uid: process.getuid!(),
  };
  return () => fileLedgerStore(options);
}

function accepted(reply: LedgerServed): Record<string, LedgerServed> {
  if (
    reply === null ||
    typeof reply !== 'object' ||
    Array.isArray(reply) ||
    !('ok' in reply) ||
    reply.ok !== true
  )
    throw new Error('Fixture call was refused: ' + JSON.stringify(reply));
  return reply;
}

describe.each(['memory', 'file'])('%s ledger', (kind) => {
  function fixture() {
    const openStore =
      kind === 'file'
        ? newFileStore()
        : (() => {
            const saved = memoryLedgerStore();
            return () => saved;
          })();
    return { openStore, store: openStore() };
  }

  it('preserves the host opt-in across reload and checks the gap, ordinary claim and draft separately', async () => {
    const { openStore, store } = fixture();
    const host = createLedger({ store, clock: () => at }).host;
    const session = accepted(await host.open({ disclosedGaps: true, askRunsRules: true }))
      .session as string;
    expect((await store.load(session)).entries[0]).toMatchObject({ disclosedGaps: true });
    await host.record(session, { source: 'collector', text: 'port-1234', window: observed });
    const resumed = createLedger({ store: openStore(), clock: () => at });
    const agent = resumed.agentFor(session);
    const gapId = accepted(await agent.note({ ...gap, cites: [2] })).note;
    const claimId = accepted(
      await agent.note({ kind: 'claim', text: 'port-1234', window, cites: [2] }),
    ).note;
    const before = (await store.load(session)).seq;
    expect(await agent.ask()).toMatchObject({
      report: {
        preview: true,
        claims: [
          {
            note: gapId,
            kind: 'disclosed-gap',
            verdict: 'open',
            restsOn: 'observed',
            checks: [
              { rule: 'cited@1', disposition: 'checked-pass', restsOn: [2] },
              { rule: 'traceable-values@2', disposition: 'checked-pass', restsOn: [2] },
            ],
          },
          { note: claimId, kind: 'claim', verdict: 'unsupported' },
        ],
      },
    });
    expect((await store.load(session)).seq).toBe(before);
    expect(await agent.submit({ draft: 'port-1234', claims: [gapId, claimId] })).toMatchObject({
      report: {
        claims: [
          { note: gapId, verdict: 'open' },
          { note: claimId, verdict: 'unsupported' },
        ],
        draft: { verdict: 'verified' },
      },
    });
    expect(await resumed.host.report(session)).toMatchObject({
      report: {
        claims: [
          { kind: 'disclosed-gap', verdict: 'open' },
          { kind: 'claim', verdict: 'unsupported' },
        ],
      },
    });
  });

  it('leaves a legacy session byte-identical on a refused append after restore', async () => {
    const { openStore, store } = fixture();
    const ledger = createLedger({ store, clock: () => at });
    const session = accepted(await ledger.host.open()).session as string;
    const before = await store.load(session);
    expect(before.entries[0]).not.toHaveProperty('disclosedGaps');
    const agent = createLedger({ store: openStore(), clock: () => at }).agentFor(session);
    expect(await agent.note({ ...gap, cites: [] })).toMatchObject({
      ok: false,
      refused: 'bad-input',
    });
    expect(await store.load(session)).toEqual(before);
    const claim = accepted(
      await agent.note({ kind: 'claim', text: 'ordinary note', cites: [] }),
    ).note;
    expect(await agent.submit({ draft: 'ordinary note', claims: [claim] })).toMatchObject({
      ok: true,
    });
  });

  it('refuses a restored syntactically valid gap in a legacy log before ask, submit or report', async () => {
    const { openStore, store } = fixture();
    const ledger = createLedger({ store, clock: () => at });
    const session = accepted(await ledger.host.open()).session as string;
    const note: LedgerEntry = {
      v: 1,
      seq: 2,
      at,
      kind: 'note',
      by: 'agent',
      how: 'observed',
      noteKind: 'disclosed-gap',
      cites: [],
      text: gap.text,
    };
    expect(await store.append(session, 1, [note])).toBe(2);
    const resumed = createLedger({ store: openStore(), clock: () => at });
    const refused = { ok: false, refused: 'store-refused', store: 'malformed' };
    expect(await resumed.agentFor(session).ask()).toMatchObject(refused);
    expect(await resumed.agentFor(session).submit({ draft: gap.text, claims: [2] })).toMatchObject(
      refused,
    );
    expect(await resumed.host.report(session)).toMatchObject(refused);
    expect((await store.load(session)).seq).toBe(2);
  });
});

it('rejects an own claimStanding field, including present-but-undefined', async () => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock: () => at });
  const session = accepted(await ledger.host.open({ disclosedGaps: true })).session as string;
  for (const claimStanding of [undefined, 'qualified', 'sure']) {
    expect(await ledger.agentFor(session).note({ ...gap, cites: [], claimStanding })).toMatchObject(
      {
        ok: false,
        refused: 'bad-input',
      },
    );
  }
  expect((await store.load(session)).seq).toBe(1);
});

it.each([false, undefined, 'true'])(
  'requires a literal true opt-in when the field is present: %s',
  async (disclosedGaps) => {
    const ledger = createLedger({ store: memoryLedgerStore(), clock: () => at });
    expect(await ledger.host.open({ disclosedGaps })).toMatchObject({
      ok: false,
      refused: 'bad-input',
    });
  },
);

it('keeps unsupported citation or value findings above the gap ceiling', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock: () => at });
  const session = accepted(await ledger.host.open({ disclosedGaps: true, askRunsRules: true }))
    .session as string;
  await ledger.host.record(session, { source: 'collector', text: 'port-1234', window: observed });
  const agent = ledger.agentFor(session);
  const uncited = accepted(await agent.note({ ...gap, cites: [] })).note;
  const unobserved = accepted(
    await agent.note({ ...gap, text: 'Collector gap for port-5678', cites: [2] }),
  ).note;
  expect(await agent.ask()).toMatchObject({
    report: {
      claims: [
        {
          note: uncited,
          verdict: 'unsupported',
          checks: [{ rule: 'cited@1', disposition: 'checked-fail' }, {}],
        },
        {
          note: unobserved,
          verdict: 'unsupported',
          checks: [{}, { rule: 'traceable-values@2', disposition: 'checked-fail' }],
        },
      ],
    },
  });
});

it('rejects stored gap standing before checking a report', async () => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock: () => at });
  const session = accepted(await ledger.host.open({ disclosedGaps: true })).session as string;
  const note = {
    v: 1,
    seq: 2,
    at,
    kind: 'note',
    by: 'agent',
    how: 'observed',
    noteKind: 'disclosed-gap',
    cites: [],
    text: gap.text,
  } as const satisfies LedgerEntry;
  for (const claimStanding of ['sure', 'qualified', undefined]) {
    expect(entryFault({ ...note, claimStanding })).toBeDefined();
    const [opened] = (await store.load(session)).entries;
    const restored = createLedger({
      store: {
        load: async () => ({ seq: 2, entries: [opened!, { ...note, claimStanding }] }),
        append: async () => {
          throw new Error('Malformed log must not append.');
        },
      },
      clock: () => at,
    });
    expect(await restored.host.report(session)).toMatchObject({
      ok: false,
      refused: 'store-refused',
      store: 'malformed',
    });
  }
});

it('rechecks the persisted opt-in when a note append retries after conflict', async () => {
  const store = memoryLedgerStore();
  const host = createLedger({ store, clock: () => at }).host;
  const session = accepted(await host.open({ disclosedGaps: true })).session as string;
  const first = (await store.load(session)).entries[0];
  if (first?.kind !== 'opened') throw new Error('Fixture was not opened.');
  const { disclosedGaps, ...legacy } = first;
  expect(disclosedGaps).toBe(true);
  let attempts = 0;
  const agent = createLedger({
    store: {
      load: async () => ({ seq: 1, entries: [attempts === 0 ? first : legacy] }),
      append: async () => {
        attempts++;
        return 'conflict';
      },
    },
    clock: () => at,
  }).agentFor(session);
  expect(await agent.note({ ...gap, cites: [] })).toMatchObject({
    ok: false,
    refused: 'bad-input',
  });
  expect(attempts).toBe(1);
});

it('serves equal redacted gap reports for equal visible shapes', async () => {
  async function reportFor(token: string) {
    const ledger = createLedger({
      store: memoryLedgerStore(),
      clock: () => at,
      redaction: { keys: ['secret'] },
    });
    const session = accepted(await ledger.host.open({ disclosedGaps: true })).session as string;
    await ledger.host.record(session, { source: 'fixture', text: token, window: observed });
    const agent = ledger.agentFor(session);
    const text = 'Collector gap for ' + token;
    const note = accepted(await agent.note({ ...gap, text, cites: [2] })).note;
    const report = accepted(await agent.submit({ draft: 'Collector gap', claims: [note] })).report;
    expect(JSON.stringify(report)).not.toContain(token);
    return report;
  }

  const first = await reportFor('secret-1234');
  const second = await reportFor('secret-5678');
  expect(first).toEqual(second);
});

it('checks a gap at the existing citation and value caps without joining windows', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock: () => at });
  const session = accepted(await ledger.host.open({ disclosedGaps: true, askRunsRules: true }))
    .session as string;
  const cites: LedgerServed[] = [];
  for (let i = 0; i < LEDGER_LIMITS.maxCites; i++) {
    const receipt = accepted(
      await ledger.host.record(session, {
        source: 'fixture',
        text: 'port-1234',
        window: observed,
      }),
    );
    cites.push(receipt.receipt);
  }
  const values = Array.from({ length: LEDGER_LIMITS.maxValues }, () => 'port-1234');
  const agent = ledger.agentFor(session);
  const note = accepted(await agent.note({ ...gap, cites, values })).note;
  expect(await agent.ask()).toMatchObject({
    report: {
      claims: [
        {
          note,
          verdict: 'open',
          checks: [{ rule: 'cited@1', restsOn: cites }, { rule: 'traceable-values@2' }],
        },
      ],
    },
  });
});
