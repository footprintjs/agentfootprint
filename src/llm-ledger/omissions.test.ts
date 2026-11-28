import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { fileLedgerStore } from './fileStore.js';
import { createLedger } from './ledger.js';
import { memoryLedgerStore } from './memoryStore.js';

const clock = () => '2026-11-28T00:00:00Z';
const window = (from: string, to: string) => ({
  from: `2026-11-28T00:${from}:00Z`,
  to: `2026-11-28T00:${to}:00Z`,
});

describe('coverage of the delivered answer', () => {
  it.each([
    { disclose: window('00', '02'), render: true, outcome: 'omitted' },
    { disclose: window('00', '10'), render: false, outcome: 'omitted' },
    { disclose: window('00', '10'), render: true, outcome: 'no-omission-found' },
  ])('reports $outcome for the matching delivery and renderer binding', async (fixture) => {
    const store = memoryLedgerStore();
    const ledger = createLedger({ store, clock });
    const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
    expect(opened.ok).toBe(true);
    const session = opened.session as string;
    const agent = ledger.agentFor(session);
    expect(
      await ledger.host.record(session, {
        source: 'logs',
        text: 'ready',
        window: window('00', '10'),
        limit: { rows: 1, hit: true },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await agent.note({
        kind: 'claim',
        text: 'ready',
        window: window('00', '10'),
        cites: [2],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await agent.note({
        kind: 'disclosed-gap',
        text: 'Read limited.',
        window: fixture.disclose,
        cites: [2],
      }),
    ).toMatchObject({ ok: true });
    const draft = fixture.render
      ? 'Ready. Read limited to the disclosed extent.'
      : 'Ready. Read limited only from 00:00 to 00:02.';
    const submitted = await agent.submit({ draft, claims: [3, 4] });
    expect(submitted.ok).toBe(true);
    expect(
      await ledger.host.deliver(session, {
        text: draft,
        coverage: {
          submit: submitted.submit,
          standing: 'qualified',
          disclosures: fixture.render ? [{ note: 4, kind: 'row-limit', receipts: [2] }] : [],
        },
      }),
    ).toMatchObject({
      ok: true,
      matches: true,
      coverageOmissions: { outcome: fixture.outcome, assessment: 'full' },
    });
    expect(await createLedger({ store, clock }).host.report(session)).toMatchObject({
      ok: true,
      report: { coverageOmissions: { outcome: fixture.outcome, assessment: 'full' } },
    });
  });
});

it('keeps a known omission alongside an unassessed extent and rejects a stale same-text submit', async () => {
  const store = memoryLedgerStore();
  const ledger = createLedger({ store, clock });
  const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
  const session = opened.session as string;
  const agent = ledger.agentFor(session);
  await ledger.host.record(session, {
    source: 'logs',
    text: 'ready',
    limit: { rows: 1, hit: true },
  });
  await agent.note({ kind: 'claim', text: 'ready', cites: [2], window: window('00', '10') });
  const draft = 'Ready.';
  const first = await agent.submit({ draft, claims: [3] });
  const second = await agent.submit({ draft, claims: [3] });
  expect(first.submit).not.toBe(second.submit);
  const coverage = { submit: first.submit, standing: 'sure', disclosures: [] };
  const beforeDelivery = (await store.load(session)).seq;
  expect(await ledger.host.deliver(session, { text: draft, coverage })).toMatchObject({
    ok: false,
    refused: 'bad-input',
  });
  expect((await store.load(session)).seq).toBe(beforeDelivery);
  expect(
    await ledger.host.deliver(session, {
      text: 'Changed.',
      coverage: { ...coverage, submit: second.submit },
    }),
  ).toMatchObject({ ok: true, matches: false });
  expect(await ledger.host.report(session)).not.toHaveProperty('report.coverageOmissions');
  expect(
    await ledger.host.deliver(session, {
      text: draft,
      coverage: { ...coverage, submit: second.submit },
    }),
  ).toMatchObject({
    coverageOmissions: {
      outcome: 'omitted',
      assessment: 'partial',
      assessed: 1,
      omissions: 1,
      unassessed: 1,
    },
  });
  expect(await ledger.host.deliver(session, { text: draft })).toMatchObject({
    coverageOmissions: { outcome: 'not-assessed', assessment: 'none' },
  });
});

it('does not let a rendered row-limit disclosure satisfy the cut on the same receipt', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock });
  const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
  const session = opened.session as string;
  const agent = ledger.agentFor(session);
  await ledger.host.record(session, {
    source: 'logs',
    text: Array.from({ length: 2_060 }, (_, i) => `id-${i}`).join(' '),
    limit: { rows: 2_060, hit: true },
  });
  await agent.note({ kind: 'claim', text: 'id-1', cites: [2] });
  await agent.note({ kind: 'disclosed-gap', text: 'Read limited.', cites: [2] });
  const text = 'Read limited.';
  const submitted = await agent.submit({ draft: text, claims: [3, 4] });
  const row = { note: 4, kind: 'row-limit', receipts: [2] };
  const coverage = { submit: submitted.submit, standing: 'qualified', disclosures: [row] };
  expect(await ledger.host.deliver(session, { text, coverage })).toMatchObject({
    coverageOmissions: { outcome: 'omitted', assessed: 2, omissions: 1 },
  });
});

it('keeps an existing delivery snapshot after withdrawal and refuses reuse on the next submit', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock });
  const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
  const session = opened.session as string;
  const agent = ledger.agentFor(session);
  await ledger.host.record(session, {
    source: 'logs',
    text: 'ready',
    limit: { rows: 1, hit: true },
  });
  await agent.note({ kind: 'claim', text: 'ready', cites: [2] });
  await agent.note({ kind: 'disclosed-gap', text: 'Read limited.', cites: [2] });
  const draft = 'Read limited.';
  const submitted = await agent.submit({ draft, claims: [3, 4] });
  await agent.withdraw({ note: 4, why: 'superseded' });
  expect(
    await ledger.host.deliver(session, {
      text: draft,
      coverage: {
        submit: submitted.submit,
        standing: 'qualified',
        disclosures: [{ note: 4, kind: 'row-limit', receipts: [2] }],
      },
    }),
  ).toMatchObject({ coverageOmissions: { outcome: 'no-omission-found' } });
  expect(await agent.submit({ draft, claims: [3, 4] })).toMatchObject({
    ok: false,
    refused: 'withdrawn-note',
  });
});

it.each([
  { leftEnd: '02', rightStart: '04', outcome: 'no-omission-found' },
  { leftEnd: '06', rightStart: '08', outcome: 'omitted' },
])(
  'distinguishes equal-duration gaps and preserves $outcome after a file-store reload',
  async (fixture) => {
    const directory = mkdtempSync(join(tmpdir(), 'af-lp6-'));
    try {
      const options = {
        dir: join(directory, 'ledger'),
        key: new Uint8Array(32).fill(23),
        uid: process.getuid!(),
      };
      const store = fileLedgerStore(options);
      const ledger = createLedger({ store, clock });
      const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
      const session = opened.session as string;
      expect(
        await ledger.host.record(session, {
          source: 'left',
          text: 'ready',
          window: window('00', fixture.leftEnd),
        }),
      ).toMatchObject({ ok: true });
      expect(
        await ledger.host.record(session, {
          source: 'right',
          text: 'ready',
          window: window(fixture.rightStart, '10'),
        }),
      ).toMatchObject({ ok: true });
      const agent = ledger.agentFor(session);
      expect(
        await agent.note({
          kind: 'claim',
          text: 'ready',
          cites: [2, 3],
          window: window('00', '10'),
        }),
      ).toMatchObject({ ok: true });
      expect(
        await agent.note({
          kind: 'disclosed-gap',
          text: 'Gap disclosed.',
          cites: [2, 3],
          window: window('02', '04'),
        }),
      ).toMatchObject({ ok: true });
      const text = 'Gap disclosed.';
      const submitted = await agent.submit({ draft: text, claims: [4, 5] });
      expect(
        await ledger.host.deliver(session, {
          text,
          coverage: {
            submit: submitted.submit,
            standing: 'qualified',
            disclosures: [{ note: 5, kind: 'window-gap', receipts: [2, 3] }],
          },
        }),
      ).toMatchObject({
        coverageOmissions: { outcome: fixture.outcome, assessment: 'full', assessed: 1 },
      });
      const restored = createLedger({ store: fileLedgerStore(options), clock });
      expect(await restored.host.report(session)).toMatchObject({
        report: { coverageOmissions: { outcome: fixture.outcome } },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('counts cited nothing-found but keeps uncited receipt data outside the assessment', async () => {
  async function run(uncitedText: string) {
    const ledger = createLedger({ store: memoryLedgerStore(), clock });
    const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
    const session = opened.session as string;
    const agent = ledger.agentFor(session);
    await ledger.host.record(session, { source: 'read', text: '', nothingFound: true });
    await ledger.host.record(session, {
      source: 'uncited',
      text: uncitedText,
      limit: { rows: 1, hit: true },
    });
    await agent.note({ kind: 'ruled-out', text: 'None found.', cites: [2] });
    const text = 'None found.';
    const submitted = await agent.submit({ draft: text, claims: [4] });
    return ledger.host.deliver(session, {
      text,
      coverage: { submit: submitted.submit, standing: 'sure', disclosures: [] },
    });
  }
  const first = await run('id-1234');
  expect(first).toMatchObject({
    coverageOmissions: { outcome: 'omitted', assessed: 1, omissions: 1 },
  });
  expect(await run('id-5678')).toEqual(first);
});

it('does not turn an unrendered gap note into a second coverage question', async () => {
  const ledger = createLedger({ store: memoryLedgerStore(), clock });
  const opened = await ledger.host.open({ disclosedGaps: true, coverageOmissions: true });
  const session = opened.session as string;
  const agent = ledger.agentFor(session);
  await ledger.host.record(session, {
    source: 'logs',
    text: 'ready',
    window: window('00', '10'),
    limit: { rows: 1, hit: true },
  });
  await agent.note({ kind: 'claim', text: 'ready', window: window('00', '05'), cites: [2] });
  await agent.note({
    kind: 'disclosed-gap',
    text: 'Read limited.',
    window: window('00', '10'),
    cites: [2],
  });
  await agent.note({
    kind: 'disclosed-gap',
    text: 'Read limited.',
    window: window('00', '05'),
    cites: [2],
  });
  const text = 'Read limited.';
  const expected = {
    coverageOmissions: { outcome: 'no-omission-found', assessed: 1, omissions: 0 },
  };
  for (const claims of [
    [3, 5],
    [3, 4, 5],
  ]) {
    const submitted = await agent.submit({ draft: text, claims });
    expect(submitted.ok).toBe(true);
    expect(
      await ledger.host.deliver(session, {
        text,
        coverage: {
          submit: submitted.submit,
          standing: 'qualified',
          disclosures: [{ note: 5, kind: 'row-limit', receipts: [2] }],
        },
      }),
    ).toMatchObject(expected);
  }
});

it.each([false, true])(
  'preserves a failed submitted check as uncertainty, with known omission %s',
  async (limited) => {
    const ledger = createLedger({
      store: memoryLedgerStore(),
      clock,
      rules: [
        {
          id: 'test/coverage',
          version: 1,
          appliesTo: ['claim'],
          decide() {
            throw new Error('fixture check failure');
          },
        },
      ],
    });
    const opened = await ledger.host.open({
      disclosedGaps: true,
      coverageOmissions: true,
      rules: ['cited@1', 'test/coverage@1'],
    });
    const session = opened.session as string;
    const agent = ledger.agentFor(session);
    await ledger.host.record(session, {
      source: 'logs',
      text: 'id-1234',
      ...(limited ? { limit: { rows: 1, hit: true } } : {}),
    });
    const text = 'id-1234';
    await agent.note({ kind: 'claim', text, cites: [2] });
    const submitted = await agent.submit({ draft: text, claims: [3] });
    expect(submitted).toMatchObject({ report: { claims: [{ reason: 'check-unreachable' }] } });
    expect(
      await ledger.host.deliver(session, {
        text,
        coverage: { submit: submitted.submit, standing: 'sure', disclosures: [] },
      }),
    ).toMatchObject({
      coverageOmissions: limited
        ? { outcome: 'omitted', assessment: 'partial', omissions: 1, unassessed: 1 }
        : { outcome: 'not-assessed', assessment: 'none', omissions: 0, unassessed: 1 },
    });
  },
);
