/**
 * ledger cases — the one pause and every row of §14, end to end (case table §7.5, §14).
 *
 * Unit: each call on a memory store, each refusal word, the append frame (conflict, `busy`,
 * `lock-lost`, `ledger-full`, `store-refused`), the one pause (release, withhold, no channel, a
 * process that died while waiting), `ask` as a report and as a dry run, and the report's standing.
 * Generated properties live in `test/llm-ledger/calls-property.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { openedEntry } from './build.js';
import { createLedger } from './ledger.js';
import type { LedgerOptions } from './ledger.js';
import { memoryLedgerStore } from './memoryStore.js';
import type { LedgerRule } from './rules/port.js';
import { LedgerStoreError } from './store.js';
import type { LedgerLog, LedgerStore } from './store.js';
import type { LedgerEntry } from './types.js';

const AT = '2026-11-26T10:00:00Z';
type Reply = Record<string, any>;

/** A store that counts loads and appends, and lets a test act before an append. */
function spy(inner: LedgerStore = memoryLedgerStore()) {
  const counts = { loads: 0, appends: 0 };
  let before: ((session: string, n: number) => Promise<void>) | undefined;
  const store: LedgerStore = {
    load: async (session) => {
      counts.loads++;
      return inner.load(session);
    },
    append: async (session, expectedSeq, entries) => {
      counts.appends++;
      await before?.(session, counts.appends);
      return inner.append(session, expectedSeq, entries);
    },
  };
  return {
    store,
    inner,
    counts,
    beforeAppend: (fn: typeof before) => {
      before = fn;
    },
  };
}

async function setup(options: Partial<LedgerOptions> = {}, open: Record<string, unknown> = {}) {
  const s = spy();
  const ledger = createLedger({ store: s.store, clock: () => AT, ...options });
  const opened = (await ledger.host.open(open)) as Reply;
  expect(opened.ok).toBe(true);
  const session = opened.session as string;
  return { ...s, ledger, session, agent: ledger.agentFor(session) };
}

const log = async (store: LedgerStore, session: string) => (await store.load(session)).entries;
const kinds = async (store: LedgerStore, session: string) =>
  (await log(store, session)).map((e) => e.kind);

describe('the pause (§7.5)', () => {
  const claimed = async (options: Partial<LedgerOptions>) => {
    const t = await setup(options, { confirm: true });
    await t.ledger.host.record(t.session, { source: 's', text: 'a-1234' });
    await t.agent.note({ kind: 'claim', text: 'a-1234', cites: [2] });
    return t;
  };

  it('release: the person is asked with no values, and released is appended', async () => {
    const asked: unknown[] = [];
    const t = await claimed({ confirm: async (ask) => (asked.push(ask), 'release') });
    const reply = (await t.agent.submit({ draft: 'a-1234', claims: [3] })) as Reply;
    expect(asked).toEqual([{ submit: 4, standing: 'ask', counts: expect.any(Object) }]);
    expect(reply).toMatchObject({
      ok: true,
      submit: 4,
      report: { release: 'released', standing: 'consistent' },
    });
    expect((await log(t.inner, t.session)).at(-1)).toMatchObject({
      kind: 'released',
      answer: 'release',
      by: 'person',
    });
  });

  it('withhold: the submit reply says withheld: true, and the report says report-withheld', async () => {
    const t = await claimed({ confirm: async () => 'withhold' });
    expect(await t.agent.submit({ draft: 'a-1234', claims: [3] })).toEqual({
      ok: true,
      submit: 4,
      withheld: true,
    });
    const report = ((await t.ledger.host.report(t.session)) as Reply).report;
    expect(report).toMatchObject({
      standing: 'not-sure',
      reasons: ['report-withheld'],
      release: 'withheld',
    });
  });

  it('no person channel: withheld, with why no-person-channel', async () => {
    const t = await claimed({});
    expect(await t.agent.submit({ draft: 'a-1234', claims: [3] })).toMatchObject({
      withheld: true,
    });
    expect((await log(t.inner, t.session)).at(-1)).toMatchObject({
      kind: 'released',
      answer: 'withhold',
      why: 'no-person-channel',
    });
  });

  it('a process that dies while waiting leaves no released entry, and the report reads ask', async () => {
    const t = await claimed({ confirm: () => new Promise(() => undefined) });
    void t.agent.submit({ draft: 'a-1234', claims: [3] });
    for (let i = 0; i < 50 && !(await kinds(t.inner, t.session)).includes('submit'); i++)
      await new Promise((r) => setTimeout(r, 10));
    const other = createLedger({ store: t.inner, clock: () => AT });
    const report = ((await other.host.report(t.session)) as Reply).report;
    expect(report).toMatchObject({ standing: 'ask', reasons: ['asked'], release: 'waiting' });
    expect(await kinds(t.inner, t.session)).not.toContain('released');
  });
});

describe('edge cases (§14)', () => {
  it('a claim with no token a rule can see is open (claim-unsettled), never verified', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'host alpha is up' });
    await agent.note({ kind: 'claim', text: 'host alpha is up', cites: [2] });
    const report = ((await agent.submit({ draft: 'host alpha is up', claims: [3] })) as Reply)
      .report;
    expect(report.claims[0]).toMatchObject({ verdict: 'open', reason: 'claim-unsettled' });
    expect(report.standing).toBe('not-sure');
  });

  it('without traceable-values, a claim with no visible token is still never a pass', async () => {
    const { ledger, session, agent } = await setup({}, { rules: ['cited@1'] });
    await ledger.host.record(session, { source: 's', text: 'host alpha is up' });
    await agent.note({ kind: 'claim', text: 'host alpha is up', cites: [2] });
    const report = ((await agent.submit({ draft: 'host alpha is up', claims: [3] })) as Reply)
      .report;
    expect(report.claims[0]).toMatchObject({ verdict: 'open', reason: 'claim-unsettled' });
  });

  it('a submit that names no claim is not assessed, even when its draft passes', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    const report = ((await agent.submit({ draft: 'id-1234', claims: [] })) as Reply).report;
    expect(report.draft.verdict).toBe('verified');
    expect(report.standing).toBe('not-assessed');
  });

  it('a value the person supplied is exempt; as the only value the claim is open', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'nothing here' });
    await ledger.host.supply(session, { from: 'person', text: 'order 5555' });
    await agent.note({ kind: 'claim', text: 'order 5555', cites: [2] });
    const report = ((await agent.submit({ draft: 'order 5555', claims: [4] })) as Reply).report;
    expect(report.claims[0]).toMatchObject({ verdict: 'open', reason: 'claim-unsettled' });
  });

  it('a receipt over the cap, masked or holding grouped numbers: a missing value is open, never unsupported', async () => {
    for (const record of [
      {
        source: 's',
        text: `id-1234 ${Array.from(
          { length: 2_048 },
          (_, i) => `t${String(i).padStart(7, '0')}`,
        ).join(' ')}`,
      },
      { source: 's', text: 'id-1234', hidden: 2 },
      { source: 's', text: 'id-1234', limit: { rows: 5, hit: true } },
      { source: 's', text: 'id-1234 total 41,200' },
      { source: 's', text: 'id-1234 D:\\logs\\node5678.log' },
    ]) {
      const { ledger, session, agent } = await setup();
      await ledger.host.record(session, record);
      await agent.note({ kind: 'claim', text: 'id-1234 and 99999', cites: [2] });
      const report = ((await agent.submit({ draft: 'id-1234', claims: [3] })) as Reply).report;
      expect(report.claims[0], JSON.stringify(record)).toMatchObject({
        verdict: 'open',
        reason: 'check-unreachable',
      });
      expect(report.receipts.incomplete).toEqual([2]);
    }
  });

  it('a draft changed after submit: matches false, delivery-differs; a second submit replaces the first', async () => {
    const { ledger, session, agent, inner } = await setup();
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    await agent.submit({ draft: 'first id-1234', claims: [3] });
    await agent.submit({ draft: 'second id-1234', claims: [3] });
    expect(await ledger.host.deliver(session, { text: 'first id-1234' })).toEqual({
      ok: true,
      submit: 9,
      matches: false,
    });
    const report = ((await ledger.host.report(session)) as Reply).report;
    expect(report).toMatchObject({
      submit: 9,
      delivery: 'differs',
      standing: 'not-sure',
      reasons: ['delivery-differs'],
    });
    expect((await log(inner, session)).filter((e) => e.kind === 'submit')).toHaveLength(2);
  });

  it('deliver with no submit: no-submit, matches false, a delivered entry with submit null', async () => {
    const { ledger, session, inner } = await setup();
    expect(await ledger.host.deliver(session, { text: 'hi' })).toEqual({
      ok: true,
      submit: null,
      matches: false,
    });
    expect((await log(inner, session)).at(-1)).toMatchObject({
      kind: 'delivered',
      submit: null,
      matches: false,
    });
  });

  it('a session that pins a rule this process lacks: rule-not-loaded, nothing appended', async () => {
    const host: LedgerRule = {
      id: 'acme/always',
      version: 1,
      appliesTo: ['claim'],
      decide: () => ({ outcome: 'checked-pass', label: 'always', restsOn: [] }),
    };
    const { session, inner } = await setup(
      { rules: [host] },
      { rules: ['cited@1', 'acme/always@1'] },
    );
    const lacking = createLedger({ store: inner, clock: () => AT });
    await lacking.agentFor(session).note({ kind: 'claim', text: 'x', cites: [] });
    const before = (await inner.load(session)).seq;
    expect(await lacking.agentFor(session).submit({ draft: 'x', claims: [2] })).toEqual({
      ok: false,
      refused: 'rule-not-loaded',
    });
    expect((await inner.load(session)).seq).toBe(before);
  });

  it('a registered rule that throws: unreachable, rule-threw, no message; the other rules still run', async () => {
    const thrower: LedgerRule = {
      id: 'acme/thrower',
      version: 1,
      appliesTo: ['claim'],
      decide: () => {
        throw new Error('secret 4242 in the message');
      },
    };
    const { ledger, session, agent, inner } = await setup(
      { rules: [thrower] },
      { rules: ['cited@1', 'acme/thrower@1'] },
    );
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    const report = ((await agent.submit({ draft: 'id-1234', claims: [3] })) as Reply).report;
    expect(report.claims[0]).toMatchObject({ verdict: 'open', reason: 'check-unreachable' });
    const checks = (await log(inner, session)).filter((e) => e.kind === 'check');
    // The value law runs whatever the session pinned: on the claim, and on the draft.
    expect(checks.map((c) => (c as { rule: string }).rule)).toEqual([
      'cited@1',
      'acme/thrower@1',
      'traceable-values@1',
      'traceable-values@1',
    ]);
    expect(checks[1]).toMatchObject({
      disposition: 'unreachable',
      verdict: 'open',
      why: 'rule-threw',
    });
    expect(checks[1]).not.toHaveProperty('decision');
    expect(JSON.stringify(await log(inner, session))).not.toContain('secret');
  });

  it('a redacted report: the checks use the real values, served strings are masked with their span', async () => {
    const { ledger, session, agent } = await setup({ redaction: { keys: ['secret'] } });
    await ledger.host.record(session, { source: 'perf', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'host id-1234 and 77777', cites: [2] });
    const report = ((await agent.submit({ draft: 'id-1234 and 77777', claims: [3] })) as Reply)
      .report;
    expect(report.claims[0].verdict).toBe('unsupported');
    expect(report.claims[0].text).toEqual({ masked: '[REDACTED]', span: [0, 22] });
    expect(report.claims[0].missing).toEqual([{ masked: '[REDACTED]', span: [17, 22] }]);
    expect(report.draft.missing).toEqual([{ masked: '[REDACTED]', span: [12, 17] }]);
  });
});

const always: LedgerRule = {
  id: 'acme/always',
  version: 1,
  appliesTo: ['claim', 'ruled-out', 'draft'],
  decide: (input) => ({
    outcome: 'checked-pass',
    label: 'always',
    restsOn: input.receipts.map((r) => r.seq),
  }),
};

describe('the value law runs in every session (ruling 1)', () => {
  it.each([
    ['only cited@1', {}, ['cited@1']],
    ['only a host rule that always passes', { rules: [always] }, ['acme/always@1']],
    ['no rule at all', {}, []],
  ] as const)(
    '%s: the value law is added, and a value no receipt holds is unsupported',
    async (_n, options, rules) => {
      const t = await setup(options as Partial<LedgerOptions>, { rules: [...rules] });
      const opened = (await log(t.inner, t.session))[0] as { rules: string[] };
      expect(opened.rules).toEqual([...rules, 'traceable-values@1']);
      await t.ledger.host.record(t.session, { source: 's', text: 'v4006k' });
      await t.agent.note({ kind: 'claim', text: 'v4002k', cites: [2] });
      const report = ((await t.agent.submit({ draft: 'v4002k', claims: [3] })) as Reply).report;
      expect(report.claims[0].verdict).toBe('unsupported');
      expect(report.draft.verdict).toBe('unsupported');
      expect(report.standing).toBe('not-sure');
    },
  );

  it('a session whose opened entry lacks the value law (written elsewhere) still runs it', async () => {
    const real = memoryLedgerStore();
    const session = 'ls_0000000000000000000000000A';
    const opened = openedEntry({ seq: 1, at: AT }, { rules: ['cited@1'] });
    if (!opened.ok) throw new Error('fixture');
    await real.append(session, 0, [opened.entry]);
    const ledger = createLedger({ store: real, clock: () => AT });
    await ledger.host.record(session, { source: 's', text: 'v4006k' });
    await ledger.agentFor(session).note({ kind: 'claim', text: 'v4002k', cites: [2] });
    const report = (
      (await ledger.agentFor(session).submit({ draft: 'v4002k', claims: [3] })) as Reply
    ).report;
    expect(report.claims[0].verdict).toBe('unsupported');
    expect(report.claims[0].checks.map((c: { rule: string }) => c.rule)).toEqual([
      'cited@1',
      'traceable-values@1',
    ]);
  });

  it('the open reply lists the rules the session runs', async () => {
    const ledger = createLedger({ store: memoryLedgerStore(), clock: () => AT });
    expect(await ledger.host.open({ rules: ['cited@1'] })).toMatchObject({
      ok: true,
      seq: 1,
      rules: ['cited@1', 'traceable-values@1'],
    });
    expect(await ledger.host.open({})).toMatchObject({
      rules: ['cited@1', 'traceable-values@1', 'time-window@1'],
    });
  });
});

describe('a value the token rule cannot read caps the subject (ruling 2)', () => {
  it.each([
    ['a number with thousands separators', 'host-7 had 41,200 errors'],
    ['a piece after an escape', String.raw`host-7 wrote D:\logs\node1234.log`],
  ])('%s: at most open, never verified, on a claim and on the draft', async (_n, text) => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'host-7' });
    await agent.note({ kind: 'claim', text, cites: [2] });
    const report = ((await agent.submit({ draft: text, claims: [3] })) as Reply).report;
    expect(report.claims[0]).toMatchObject({ verdict: 'open', reason: 'claim-unsettled' });
    expect(report.draft.verdict).toBe('open');
  });

  it('its visible tokens are still checked: a missing one is unsupported', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'host-7' });
    await agent.note({ kind: 'claim', text: 'host-7 and id-9999 had 41,200 errors', cites: [2] });
    const report = ((await agent.submit({ draft: 'x', claims: [3] })) as Reply).report;
    expect(report.claims[0].verdict).toBe('unsupported');
  });
});

describe('the person answer is never lost (ruling 3)', () => {
  async function confirmed(store: LedgerStore) {
    const ledger = createLedger({ store, clock: () => AT, confirm: async () => 'withhold' });
    const session = ((await ledger.host.open({ confirm: true })) as Reply).session as string;
    await ledger.host.record(session, { source: 's', text: 'a-1234' });
    await ledger.agentFor(session).note({ kind: 'claim', text: 'a-1234', cites: [2] });
    return { ledger, session };
  }
  /** A store whose appends of `released` misbehave as `how` says. */
  function onReleased(how: 'throw' | 'conflict' | 'lost-absent' | 'lost-stood') {
    const real = memoryLedgerStore();
    const store: LedgerStore = {
      load: (s) => real.load(s),
      append: async (s, seq, entries) => {
        if (entries[0]?.kind !== 'released') return real.append(s, seq, entries);
        if (how === 'throw') throw new LedgerStoreError('unsafe-file');
        if (how === 'conflict') return 'conflict';
        if (how === 'lost-stood') await real.append(s, seq, entries);
        throw new LedgerStoreError('lock-lost');
      },
    };
    return { store, real };
  }

  it.each([
    ['a store error', 'throw', { ok: false, refused: 'store-refused', store: 'unsafe-file' }],
    ['three conflicts', 'conflict', { ok: false, refused: 'busy' }],
    [
      'lock-lost with the entry absent',
      'lost-absent',
      { ok: false, refused: 'store-refused', store: 'lock-lost' },
    ],
  ] as const)(
    '%s: a refusal, never ok; the report still reads waiting for a person',
    async (_n, how, reply) => {
      const { store, real } = onReleased(how);
      const { ledger, session } = await confirmed(store);
      expect(await ledger.agentFor(session).submit({ draft: 'a-1234', claims: [3] })).toEqual(
        reply,
      );
      expect((await real.load(session)).entries.map((e) => e.kind)).not.toContain('released');
      expect(((await ledger.host.report(session)) as Reply).report).toMatchObject({
        standing: 'ask',
        release: 'waiting',
      });
    },
  );

  it('lock-lost with the entry written: ok, and the entry is in the log once', async () => {
    const { store, real } = onReleased('lost-stood');
    const { ledger, session } = await confirmed(store);
    expect(await ledger.agentFor(session).submit({ draft: 'a-1234', claims: [3] })).toMatchObject({
      ok: true,
      withheld: true,
    });
    expect((await real.load(session)).entries.filter((e) => e.kind === 'released')).toHaveLength(1);
  });
});

describe('laws the suite holds (P2-3)', () => {
  it('o1: an unsupported draft adds value-unsupported, though every claim passes', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    const report = ((await agent.submit({ draft: 'id-1234 and 99999', claims: [3] })) as Reply)
      .report;
    expect(report.claims[0].verdict).toBe('verified');
    expect(report.draft.verdict).toBe('unsupported');
    expect(report).toMatchObject({ standing: 'not-sure', reasons: ['value-unsupported'] });
  });

  it('o9: a delivery is compared with the newest submit, never an older one', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    await agent.submit({ draft: 'first id-1234', claims: [3] });
    expect(await ledger.host.deliver(session, { text: 'first id-1234' })).toMatchObject({
      matches: true,
    });
    const second = (await agent.submit({ draft: 'second id-1234', claims: [3] })) as Reply;
    expect(second.report.delivery).toBe('not-compared'); // the earlier delivery was of the older submit
    expect(await ledger.host.deliver(session, { text: 'first id-1234' })).toEqual({
      ok: true,
      submit: second.submit,
      matches: false,
    });
    expect(((await ledger.host.report(session)) as Reply).report.delivery).toBe('differs');
  });
});
