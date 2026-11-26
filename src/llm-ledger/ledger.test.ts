/**
 * ledger — the calls end to end (case table §6, §7 and every row of §14).
 *
 * Unit: each call on a memory store, each refusal word, the append frame (conflict, `busy`,
 * `lock-lost`, `ledger-full`, `store-refused`), the one pause (release, withhold, no channel, a
 * process that died while waiting), `ask` as a report and as a dry run, and the report's standing.
 * Generated properties live in `test/llm-ledger/calls-property.test.ts`.
 */
import { describe, expect, it } from 'vitest';

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

describe('the calls', () => {
  it('open, record, supply, note, withdraw, submit, ask, deliver, report: each reply', async () => {
    const { ledger, session, agent, inner } = await setup();
    expect(
      await ledger.host.record(session, { source: 'perf', text: 'esx01a 41200 iops' }),
    ).toEqual({
      ok: true,
      receipt: 2,
      tokens: 2,
    });
    expect(await ledger.host.supply(session, { from: 'person', text: 'ticket 5555' })).toEqual({
      ok: true,
      supplied: 3,
      tokens: 1,
    });
    expect(await agent.note({ kind: 'claim', text: 'esx01a peaked at 41200', cites: [2] })).toEqual(
      {
        ok: true,
        note: 4,
      },
    );
    expect(await agent.note({ kind: 'question', text: 'which week?', cites: [] })).toEqual({
      ok: true,
      note: 5,
    });
    const submitted = (await agent.submit({
      draft: 'esx01a peaked at 41200',
      claims: [4],
    })) as Reply;
    expect(submitted).toMatchObject({ ok: true, submit: 6, report: { standing: 'consistent' } });
    expect(submitted.report.claims[0]).toMatchObject({ note: 4, verdict: 'verified' });
    expect(submitted.report.openQuestions).toEqual([5]);
    const asked = (await agent.ask()) as Reply;
    expect(asked.report.submit).toBe(6);
    expect(asked.receipts).toEqual([
      {
        receipt: 2,
        source: 'perf',
        how: 'observed',
        at: AT,
        nothingFound: false,
        incomplete: false,
      },
    ]);
    expect(await ledger.host.deliver(session, { text: 'esx01a peaked at 41200' })).toEqual({
      ok: true,
      submit: 6,
      matches: true,
    });
    expect(((await ledger.host.report(session)) as Reply).report.delivery).toBe('matches');
    expect(await agent.withdraw({ note: 5, why: 'not needed' })).toMatchObject({ ok: true });
    expect(await kinds(inner, session)).toEqual([
      'opened',
      'receipt',
      'supplied',
      'note',
      'note',
      'submit',
      'check',
      'check',
      'check',
      'check',
      'delivered',
      'withdrawal',
    ]);
  });

  it('a submit appends its submit and all its checks as ONE batch', async () => {
    const { ledger, session, agent, counts } = await setup();
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    const before = counts.appends;
    await agent.submit({ draft: 'id-1234', claims: [3] });
    expect(counts.appends - before).toBe(1);
  });

  it('a submit whose checks are missing never reads as a pass (pinned beside the batch mark)', async () => {
    const { ledger, session, agent, inner } = await setup();
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    // A log written without its checks: only possible by hand, never by `submit`.
    const entries = await log(inner, session);
    const submit = {
      v: 1,
      seq: entries.length + 1,
      kind: 'submit',
      by: 'agent',
      how: 'observed',
      at: AT,
      claims: [3],
      draftDigest: `sha256:${'0'.repeat(64)}`,
      draftBytes: 7,
    } as LedgerEntry;
    expect(await inner.append(session, entries.length, [submit])).toBe(entries.length + 1);
    const report = ((await ledger.host.report(session)) as Reply).report;
    expect(report.standing).not.toBe('consistent');
    expect(report.counts.notAssessed).toBe(1);
  });
});

describe('the refusal words (§6.4)', () => {
  it('each word, and nothing appended', async () => {
    const { ledger, session, agent, counts } = await setup();
    await ledger.host.record(session, { source: 's', text: 'a-1234' });
    await agent.note({ kind: 'claim', text: 'a-1234', cites: [2] });
    await agent.note({ kind: 'question', text: 'q?', cites: [] });
    const appends = counts.appends;
    const cases: [() => Promise<unknown>, string][] = [
      [
        () => ledger.agentFor('ls_bad').note({ kind: 'claim', text: 'x', cites: [] }),
        'bad-session',
      ],
      [() => ledger.agentFor('ls_0000000000000000000000000Z').ask(), 'no-session'],
      [() => agent.note({ kind: 'claim', text: 'x', cites: [], extra: 1 }), 'bad-input'],
      [() => agent.note({ kind: 'claim', text: 'x'.repeat(2_001), cites: [] }), 'too-large'],
      [
        () => agent.note({ kind: 'claim', text: 'x', window: { from: AT, to: AT }, cites: [] }),
        'bad-window',
      ],
      [() => agent.note({ kind: 'claim', text: 'x', cites: [99] }), 'unknown-receipt'],
      [() => agent.note({ kind: 'claim', text: 'x', cites: [3] }), 'not-a-receipt'],
      [() => agent.submit({ draft: 'd', claims: [99] }), 'unknown-note'],
      [() => agent.submit({ draft: 'd', claims: [2] }), 'not-a-note'],
      [() => agent.submit({ draft: 'd', claims: [4] }), 'not-a-claim'],
      [() => agent.withdraw({ note: 99, why: 'w' }), 'unknown-note'],
      [() => agent.withdraw({ note: 2, why: 'w' }), 'not-a-note'],
      [() => ledger.host.open({ rules: ['acme/nope@1'] }), 'unknown-rule'],
    ];
    for (const [reply, word] of cases)
      expect(await reply(), word).toEqual({ ok: false, refused: word });
    expect(counts.appends).toBe(appends);
  });

  it('withdrawn: before a submit it cannot be named; after, it is listed; twice is refused', async () => {
    const { ledger, session, agent } = await setup();
    await ledger.host.record(session, { source: 's', text: 'a-1234' });
    await agent.note({ kind: 'claim', text: 'a-1234', cites: [2] });
    await agent.note({ kind: 'claim', text: 'a-1234 again', cites: [2] });
    await agent.withdraw({ note: 3, why: 'wrong' });
    expect(await agent.submit({ draft: 'd', claims: [3] })).toEqual({
      ok: false,
      refused: 'withdrawn-note',
    });
    await agent.submit({ draft: 'a-1234', claims: [4] });
    await agent.withdraw({ note: 4, why: 'changed my mind' });
    const report = ((await agent.ask()) as Reply).report;
    expect(report.withdrawnAfterCheck).toEqual([{ note: 4, verdict: 'verified' }]);
    expect(await agent.withdraw({ note: 4, why: 'again' })).toEqual({
      ok: false,
      refused: 'already-withdrawn',
    });
  });

  it('a store that refuses: store-refused with its code, never repaired', async () => {
    const store: LedgerStore = {
      load: async () => {
        throw new LedgerStoreError('mac-mismatch');
      },
      append: async () => 'conflict',
    };
    const ledger = createLedger({ store, clock: () => AT });
    expect(await ledger.agentFor('ls_0000000000000000000000000Z').ask()).toEqual({
      ok: false,
      refused: 'store-refused',
      store: 'mac-mismatch',
    });
  });

  it('at the entry cap every append is refused (ledger-full) and the report says full', async () => {
    const real = memoryLedgerStore();
    const s = createLedger({ store: real, clock: () => AT });
    const session = ((await s.host.open()) as Reply).session as string;
    const opened = (await real.load(session)).entries[0] as LedgerEntry;
    const full: LedgerStore = {
      load: async () =>
        ({
          seq: 10_000,
          entries: Array.from({ length: 10_000 }, (_, i) =>
            i === 0
              ? opened
              : {
                  v: 1,
                  seq: i + 1,
                  kind: 'note',
                  by: 'agent',
                  how: 'observed',
                  at: AT,
                  noteKind: 'question',
                  text: 'q',
                  cites: [],
                },
          ),
        } as LedgerLog),
      append: async () => 'conflict',
    };
    const ledger = createLedger({ store: full, clock: () => AT });
    expect(await ledger.agentFor(session).note({ kind: 'claim', text: 'x', cites: [] })).toEqual({
      ok: false,
      refused: 'ledger-full',
    });
    expect(((await ledger.host.report(session)) as Reply).report.full).toBe(true);
  });
});

describe('the append frame (§7.2)', () => {
  it('conflict loops to load-log; after 3 attempts the reply is busy; each attempt loads once', async () => {
    const { ledger, session, agent, counts, inner, beforeAppend } = await setup();
    await ledger.host.record(session, { source: 's', text: 'a-1234' });
    let others = 0;
    beforeAppend(async (sid) => {
      // Another writer appends first, every time.
      const at = await inner.load(sid);
      others++;
      await inner.append(sid, at.seq, [
        {
          v: 1,
          seq: at.seq + 1,
          kind: 'note',
          by: 'agent',
          how: 'observed',
          at: AT,
          noteKind: 'question',
          text: `other ${others}`,
          cites: [],
        } as LedgerEntry,
      ]);
    });
    const loads = counts.loads;
    expect(await agent.note({ kind: 'claim', text: 'mine', cites: [] })).toEqual({
      ok: false,
      refused: 'busy',
    });
    expect(counts.loads - loads).toBe(3);
  });

  it('a conflict once: the call reloads, validates again and appends at the new seq', async () => {
    const { ledger, session, agent, counts, inner, beforeAppend } = await setup();
    await ledger.host.record(session, { source: 's', text: 'a-1234' });
    await agent.note({ kind: 'claim', text: 'a-1234', cites: [2] });
    let once = true;
    beforeAppend(async (sid) => {
      if (!once) return;
      once = false;
      const at = await inner.load(sid);
      await inner.append(sid, at.seq, [
        {
          v: 1,
          seq: at.seq + 1,
          kind: 'receipt',
          by: 'host',
          how: 'observed',
          at: AT,
          source: 'late',
          bytes: 1,
          nothingFound: false,
          tokens: [],
        } as LedgerEntry,
      ]);
    });
    const loads = counts.loads;
    const reply = (await agent.submit({ draft: 'a-1234', claims: [3] })) as Reply;
    expect(reply).toMatchObject({ ok: true, submit: 5 });
    expect(counts.loads - loads).toBe(2);
  });

  it('lock-lost: the call reloads and compares its own entries, and never appends them again', async () => {
    const real = memoryLedgerStore();
    let appends = 0;
    let stands = true;
    const store: LedgerStore = {
      load: (s) => real.load(s),
      append: async (s, seq, entries) => {
        appends++;
        if (entries[0]?.kind === 'note') {
          if (stands) await real.append(s, seq, entries);
          throw new LedgerStoreError('lock-lost');
        }
        return real.append(s, seq, entries);
      },
    };
    const ledger = createLedger({ store, clock: () => AT });
    const session = ((await ledger.host.open()) as Reply).session as string;
    const agent = ledger.agentFor(session);
    expect(await agent.note({ kind: 'claim', text: 'x', cites: [] })).toEqual({
      ok: true,
      note: 2,
    });
    const before = appends;
    stands = false;
    expect(await agent.note({ kind: 'claim', text: 'y', cites: [] })).toEqual({
      ok: false,
      refused: 'store-refused',
      store: 'lock-lost',
    });
    expect(appends - before).toBe(1);
    expect((await real.load(session)).seq).toBe(2);
  });
});

describe('o2: after lock-lost a batch stands only when every entry does', () => {
  it("a log as long as the batch whose first entry alone is the call's: refused, never reported appended", async () => {
    const real = memoryLedgerStore();
    const store: LedgerStore = {
      load: (s) => real.load(s),
      append: async (s, seq, entries) => {
        if (entries[0]?.kind !== 'submit') return real.append(s, seq, entries);
        // As long as the call's batch, but only its first entry is the call's: the rest are another writer's.
        await real.append(s, seq, [
          entries[0] as LedgerEntry,
          ...entries.slice(1).map(
            (_, i) =>
              ({
                v: 1,
                seq: seq + 2 + i,
                kind: 'note',
                by: 'agent',
                how: 'observed',
                at: AT,
                noteKind: 'question',
                text: 'another writer',
                cites: [],
              } as LedgerEntry),
          ),
        ]);
        throw new LedgerStoreError('lock-lost');
      },
    };
    const ledger = createLedger({ store, clock: () => AT });
    const session = ((await ledger.host.open()) as Reply).session as string;
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await ledger.agentFor(session).note({ kind: 'claim', text: 'id-1234', cites: [2] });
    expect(await ledger.agentFor(session).submit({ draft: 'id-1234', claims: [3] })).toEqual({
      ok: false,
      refused: 'store-refused',
      store: 'lock-lost',
    });
  });
});

describe('o7: ask never serves a receipt query', () => {
  it('the query is stored, never served', async () => {
    const { ledger, session, agent, inner } = await setup();
    await ledger.host.record(session, {
      source: 's',
      text: 'id-1234',
      query: 'select secret_col_q7',
    });
    expect(JSON.stringify(await log(inner, session))).toContain('secret_col_q7');
    expect(JSON.stringify(await agent.ask())).not.toContain('secret_col_q7');
    expect(JSON.stringify(await ledger.host.report(session))).not.toContain('secret_col_q7');
  });
});

describe('ask (§6.3)', () => {
  it('runs no rule and appends nothing by default; under askRunsRules it is a dry run', async () => {
    for (const askRunsRules of [false, true]) {
      const { ledger, session, agent, counts } = await setup({}, { askRunsRules });
      await ledger.host.record(session, { source: 's', text: 'a-1234' });
      await agent.note({ kind: 'claim', text: 'a-1234 and 9999', cites: [2] });
      const appends = counts.appends;
      const report = ((await agent.ask()) as Reply).report;
      expect(counts.appends).toBe(appends);
      if (askRunsRules) {
        expect(report.preview).toBe(true);
        expect(report.claims[0]).toMatchObject({ note: 3, verdict: 'unsupported' });
      } else expect(report.claims).toEqual([]);
    }
  });
});

describe('the run record (§7.1, §7.4)', () => {
  it('the input is { call } only; scope checks hold rule, subject, disposition, verdict and decision', async () => {
    const runs: { call: string; snapshot: any }[] = [];
    const { ledger, session, agent } = await setup({ runs: (r) => runs.push(r as never) });
    await ledger.host.record(session, { source: 's', text: 'id-1234' });
    await agent.note({ kind: 'claim', text: 'id-1234', cites: [2] });
    await agent.submit({ draft: 'id-1234', claims: [3] });
    const submit = runs.find((r) => r.call === 'submit')!;
    const checks = submit.snapshot.sharedState.checks as Record<string, unknown>[];
    expect(checks.length).toBe(4);
    for (const c of checks)
      for (const key of Object.keys(c))
        expect(['rule', 'subject', 'disposition', 'verdict', 'decision']).toContain(key);
    expect(JSON.stringify(submit.snapshot)).not.toContain('id-1234');
  });
});

describe('the queue (§7.1)', () => {
  it('calls of one session run in order, one after another; past 8 waiting the reply is busy', async () => {
    const { agent, counts } = await setup();
    const conflictsBefore = counts.loads;
    const replies = (await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        agent.note({ kind: 'question', text: `q${i}`, cites: [] }),
      ),
    )) as Reply[];
    expect(replies.slice(0, 8)).toEqual(
      Array.from({ length: 8 }, (_, i) => ({ ok: true, note: i + 2 })),
    );
    expect(replies[8]).toEqual({ ok: false, refused: 'busy' });
    expect(counts.loads - conflictsBefore).toBe(8); // one load each: no call raced another
  });
});
