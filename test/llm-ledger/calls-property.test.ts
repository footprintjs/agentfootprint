/**
 * CALLS, GENERATED — the properties of the ledger's second part (case table §13 row 2, §8, §9, §12).
 *
 * Seeded sessions (receipts observed or reported, complete or not, supplied values, claims with
 * values from a shared pool or with none, all-letter claims, a draft) are run through a ledger on a
 * memory store, then the log and every served reply are checked:
 * - no claim is `verified` with a token missing from every observed cited receipt, and `verified`
 *   means every receipt its checks rest on is observed;
 * - a claim with no visible token is `open`; a note's own `values` never count as support;
 * - each stored decision equals `decisionRecord(evidence)` recomputed from the log;
 * - no receipt token reaches any served reply; `ask` never appends; no agent call writes `supplied`;
 * - a call sequence split across ledger instances gives the same log;
 * - each attempt loads once;
 * - markers planted in every text input never reach a run record, and in the log appear only where
 *   the case table allows (a note's text and values, token sets, the agent's own `why`).
 */
import { decideFromFacts, decisionRecord, fixedRecord } from 'footprintjs';
import { canonicalizeJson } from 'foottrace/canonical-json';
import { describe, expect, it } from 'vitest';

import { createLedger } from '../../src/llm-ledger/ledger.js';
import { memoryLedgerStore } from '../../src/llm-ledger/memoryStore.js';
import { readerOf } from '../../src/llm-ledger/reader.js';
import { cited } from '../../src/llm-ledger/rules/cited.js';
import type { LedgerRule, LedgerTableRule } from '../../src/llm-ledger/rules/port.js';
import { timeWindow } from '../../src/llm-ledger/rules/timeWindow.js';
import { traceableValues } from '../../src/llm-ledger/rules/traceableValues.js';
import type { LedgerStore } from '../../src/llm-ledger/store.js';
import { tokensOf } from '../../src/llm-ledger/tokens.js';
import type { LedgerCheck, LedgerEntry, LedgerNote } from '../../src/llm-ledger/types.js';
import { seeded } from '../helpers/seededText.js';

const AT = '2026-11-26T10:00:00Z';
type Reply = Record<string, any>;
const POOL = ['esx01a', 'vm-0042', '41200', '9750.5', 'fc1/3', 'id-7777', 'h-2026', 'q-31415'];
const WORDS = ['host', 'alpha', 'peak', 'is', 'up', 'the', 'and'];
const RULES: Record<string, LedgerTableRule> = {
  'cited@1': cited,
  'traceable-values@2': traceableValues,
  'time-window@1': timeWindow,
};

function counting(inner: LedgerStore = memoryLedgerStore()) {
  const counts = { loads: 0, appends: 0 };
  const store: LedgerStore = {
    load: (s) => (counts.loads++, inner.load(s)),
    append: (s, q, e) => (counts.appends++, inner.append(s, q, e)),
  };
  return { store, counts, inner };
}

/** One generated session: its ledger, its log and every served reply. */
/** A host rule that passes everything, resting on every receipt it is given. */
const ALWAYS: LedgerRule = {
  id: 'acme/always',
  version: 1,
  appliesTo: ['claim', 'ruled-out', 'draft'],
  decide: (input) => ({
    outcome: 'checked-pass',
    label: 'always',
    restsOn: input.receipts.map((r) => r.seq),
  }),
};

/** Every rule set a host can open with: the built-ins, any one of them, a host rule alone, none. */
const RULE_SETS: readonly (readonly string[] | undefined)[] = [
  undefined,
  ['cited@1'],
  ['time-window@1'],
  ['acme/always@1'],
  ['cited@1', 'acme/always@1'],
  [],
];

async function session(seed: number) {
  const next = seeded(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] as T;
  const some = (n: number) => Array.from({ length: n }, () => pick(POOL));
  const { store, counts, inner } = counting();
  const served: unknown[] = [];
  const ledger = createLedger({ store, clock: () => AT, rules: [ALWAYS] });
  const ruleSet = RULE_SETS[seed % RULE_SETS.length];
  const opened = (await ledger.host.open(
    ruleSet === undefined ? {} : { rules: [...ruleSet] },
  )) as Reply;
  const s = opened.session as string;
  const agent = ledger.agentFor(s);
  const receiptOnly = `rcpt-${seed}x9`; // a token only receipts hold
  const queryOnly = `qry-${seed}z8`; // a word only a receipt's query holds
  const receipts = 1 + Math.floor(next() * 3);
  for (let i = 0; i < receipts; i++) {
    const rec: Record<string, unknown> = {
      source: `src${i}`,
      text: [...some(1 + Math.floor(next() * 3)), receiptOnly, pick(WORDS)].join(' '),
      how: next() < 0.3 ? 'reported' : 'observed',
      query: `select ${queryOnly}`,
    };
    if (next() < 0.2) rec.hidden = 1;
    if (next() < 0.15) rec.limit = { rows: 10, hit: true };
    served.push(await ledger.host.record(s, rec));
  }
  if (next() < 0.4) served.push(await ledger.host.supply(s, { from: 'app', text: pick(POOL) }));
  const notes: number[] = [];
  const claims = 1 + Math.floor(next() * 3);
  for (let i = 0; i < claims; i++) {
    const allLetters = next() < 0.2;
    const text = allLetters
      ? `${pick(WORDS)} ${pick(WORDS)}`
      : `${pick(WORDS)} ${some(1 + Math.floor(next() * 2)).join(' ')}`;
    const cites = Array.from({ length: receipts }, (_, k) => k + 2).filter(() => next() < 0.6);
    const reply = (await agent.note({
      kind: next() < 0.8 ? 'claim' : 'ruled-out',
      text,
      ...(next() < 0.3 ? { values: [pick(POOL)] } : {}),
      cites,
    })) as Reply;
    if (reply.ok) notes.push(reply.note);
  }
  const before = counts.appends;
  served.push(await agent.ask());
  const askAppended = counts.appends - before;
  const draft = `${some(2).join(' ')} ${pick(WORDS)}`;
  served.push(await agent.submit({ draft, claims: notes }));
  served.push(await agent.ask());
  served.push(await ledger.host.report(s));
  const log = (await inner.load(s)).entries;
  return { log, served, receiptOnly, queryOnly, askAppended, counts, draft, ruleSet };
}

const tokensOfNote = (n: LedgerNote) => new Set([n.text, ...(n.values ?? [])].flatMap(tokensOf));

describe('generated sessions', () => {
  const SESSIONS = 300;

  it('for every rule set a host can open with, the value law holds on claims and on the draft', async () => {
    let wouldPass = 0;
    for (let seed = 1; seed <= SESSIONS; seed++) {
      const { log, served, draft, ruleSet } = await session(seed);
      const reader = readerOf({ seq: log.length, entries: log });
      expect((log[0] as { rules: string[] }).rules, `seed ${seed}`).toContain('traceable-values@2');
      const report = (served.at(-1) as Reply).report;
      const exempt = new Set(reader.supplied.flatMap((x) => x.tokens));
      for (const claim of report.claims) {
        if (claim.verdict !== 'verified' && claim.verdict !== 'consistent-with-reported') continue;
        const note = reader.note(claim.note) as LedgerNote;
        const held = note.cites.flatMap((c) => reader.receipt(c)?.tokens ?? []);
        for (const token of tokensOfNote(note))
          if (!exempt.has(token))
            expect(held, `seed ${seed} (${ruleSet}): ${token}`).toContain(token);
        if (ruleSet !== undefined && !ruleSet.includes('traceable-values@2')) wouldPass++;
      }
      if (report.standing === 'consistent') {
        const held = reader.receipts.flatMap((r) => r.tokens);
        for (const token of tokensOf(draft))
          if (!exempt.has(token))
            expect(held, `seed ${seed} (${ruleSet}) draft: ${token}`).toContain(token);
      }
    }
    expect(wouldPass).toBeGreaterThan(20); // sessions pinning a set without the value law were exercised
  });

  it('verdicts: never verified with a token no observed cited receipt holds; verified only on observed receipts', async () => {
    let verified = 0;
    for (let seed = 1; seed <= SESSIONS; seed++) {
      const { log, served } = await session(seed);
      const reader = readerOf({ seq: log.length, entries: log });
      const report = (served.at(-1) as Reply).report;
      for (const claim of report.claims) {
        const note = reader.note(claim.note) as LedgerNote;
        const visible = tokensOfNote(note);
        // §8.2: no visible token is never a pass (`open`, or `unsupported` when another rule failed).
        if (visible.size === 0)
          expect(['open', 'unsupported'], `seed ${seed}`).toContain(claim.verdict);
        if (claim.verdict !== 'verified') continue;
        verified++;
        const exempt = new Set(reader.supplied.flatMap((x) => x.tokens));
        const observed = note.cites
          .map((c) => reader.receipt(c))
          .filter((r) => r?.how === 'observed')
          .flatMap((r) => r!.tokens);
        for (const token of visible)
          if (!exempt.has(token)) expect(observed, `seed ${seed}: ${token}`).toContain(token);
        for (const check of claim.checks)
          for (const seq of check.restsOn)
            expect(reader.receipt(seq)?.how, `seed ${seed}`).toBe('observed');
        // A note's own values never count as support: each is in a receipt, or exempt.
        for (const v of (note.values ?? []).flatMap(tokensOf))
          expect(exempt.has(v) || observed.includes(v), `seed ${seed}: value ${v}`).toBe(true);
      }
    }
    expect(verified).toBeGreaterThan(30);
  });

  it('each stored decision equals decisionRecord(evidence) recomputed from the log', async () => {
    let compared = 0;
    for (let seed = 1; seed <= SESSIONS; seed++) {
      const { log } = await session(seed);
      const reader = readerOf({ seq: log.length, entries: log });
      for (const check of log.filter((e): e is LedgerCheck => e.kind === 'check')) {
        if (check.rule === 'acme/always@1') {
          expect(check.decision, `seed ${seed}`).toEqual(
            fixedRecord(check.disposition, 'always', 'app'),
          );
          continue;
        }
        const rule = RULES[check.rule] as LedgerTableRule;
        const note = 'note' in check.subject ? reader.note(check.subject.note) : undefined;
        const subject =
          note === undefined ? undefined : { kind: note.noteKind as 'claim' | 'ruled-out', note };
        if (subject === undefined) continue; // the draft's text is never stored: its facts cannot be rebuilt
        const input = {
          subject,
          receipts: note!.cites.map((c) => reader.receipt(c)!),
          supplied: reader.supplied,
        };
        const facts = (rule.facts(input) as { facts: Record<string, unknown> }).facts;
        const { evidence } = decideFromFacts(rule.table, facts, rule.default);
        expect(check.decision, `seed ${seed} ${check.rule}`).toEqual(decisionRecord(evidence));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it('no receipt token is served; ask never appends; only the host writes supplied', async () => {
    for (let seed = 1; seed <= SESSIONS; seed++) {
      const { log, served, receiptOnly, queryOnly, askAppended } = await session(seed);
      expect(JSON.stringify(served), `seed ${seed}`).not.toContain(receiptOnly);
      expect(JSON.stringify(served), `seed ${seed}`).not.toContain(queryOnly);
      expect(askAppended).toBe(0);
      for (const e of log.filter((x) => x.kind === 'supplied')) expect(e.by).toBe('host');
    }
  });
});

describe('across ledger instances, and per attempt', () => {
  /** One fixed call sequence; `fresh` gives each call a new ledger over the same store. */
  async function run(fresh: boolean) {
    const inner = memoryLedgerStore();
    const make = () => createLedger({ store: inner, clock: () => AT });
    let ledger = make();
    const s = ((await ledger.host.open({})) as Reply).session as string;
    const calls: ((l: ReturnType<typeof make>) => Promise<unknown>)[] = [
      (l) => l.host.record(s, { source: 'a', text: 'esx01a 41200' }),
      (l) => l.host.record(s, { source: 'b', text: 'vm-0042', how: 'reported' }),
      (l) => l.agentFor(s).note({ kind: 'claim', text: 'esx01a did 41200', cites: [2] }),
      (l) => l.agentFor(s).note({ kind: 'claim', text: 'vm-0042 too', cites: [3] }),
      (l) => l.agentFor(s).submit({ draft: 'esx01a 41200 vm-0042', claims: [4, 5] }),
      (l) => l.host.deliver(s, { text: 'esx01a 41200 vm-0042' }),
      (l) => l.agentFor(s).withdraw({ note: 5, why: 'w' }),
    ];
    for (const call of calls) {
      if (fresh) ledger = make();
      await call(ledger);
    }
    return (await inner.load(s)).entries.map((e) => canonicalizeJson(e));
  }

  it('a call sequence split across ledger instances gives the same log', async () => {
    expect(await run(true)).toEqual(await run(false));
  });

  it('each attempt loads once: k foreign appends give k + 1 loads, and busy at the third', async () => {
    for (const k of [0, 1, 2, 3]) {
      const inner = memoryLedgerStore();
      let left = k;
      const counts = { loads: 0 };
      const store: LedgerStore = {
        load: (s) => (counts.loads++, inner.load(s)),
        append: async (s, q, e) => {
          if (e[0]?.kind === 'note' && left > 0) {
            left--;
            const at = await inner.load(s);
            await inner.append(s, at.seq, [
              {
                v: 1,
                seq: at.seq + 1,
                kind: 'note',
                by: 'agent',
                how: 'observed',
                at: AT,
                noteKind: 'question',
                text: 'other',
                cites: [],
              } as LedgerEntry,
            ]);
          }
          return inner.append(s, q, e);
        },
      };
      const ledger = createLedger({ store, clock: () => AT });
      const s = ((await ledger.host.open({})) as Reply).session as string;
      const loads = counts.loads;
      const reply = (await ledger
        .agentFor(s)
        .note({ kind: 'claim', text: 'x', cites: [] })) as Reply;
      expect(counts.loads - loads, `k=${k}`).toBe(Math.min(k, 2) + 1);
      expect(reply.ok, `k=${k}`).toBe(k < 3);
    }
  });
});

describe('the marker property (§5.5, §7.1, §12.3)', () => {
  it('no planted marker reaches a run record; in the log, only where the case table allows', async () => {
    const M = {
      result: 'mkresult0001',
      query: 'mkquery0002',
      supplied: 'mksupplied0003',
      note: 'mknote0004',
      value: 'mkvalue0005',
      why: 'mkwhy0006',
      draft: 'mkdraft0007',
      delivered: 'mkdelivered0008',
    };
    const snapshots: unknown[] = [];
    const inner = memoryLedgerStore();
    const ledger = createLedger({ store: inner, clock: () => AT, runs: (r) => snapshots.push(r) });
    const s = ((await ledger.host.open({ confirm: false })) as Reply).session as string;
    const agent = ledger.agentFor(s);
    await ledger.host.record(s, { source: 'perf', text: `${M.result} esx01a`, query: M.query });
    await ledger.host.supply(s, { from: 'person', text: M.supplied });
    await agent.note({ kind: 'claim', text: `esx01a ${M.note}`, values: [M.value], cites: [2] });
    await agent.note({ kind: 'question', text: 'which?', cites: [] });
    await agent.submit({ draft: `esx01a ${M.draft}`, claims: [4] });
    await agent.ask();
    await agent.withdraw({ note: 5, why: M.why });
    await ledger.host.deliver(s, { text: M.delivered });
    await ledger.host.report(s);
    expect(snapshots.length).toBe(10);
    const records = JSON.stringify(snapshots);
    for (const marker of Object.values(M)) expect(records, marker).not.toContain(marker);
    // Where each marker may stand in the log.
    const allowed: Record<string, RegExp> = {
      [M.result]: /^receipt\.tokens/,
      [M.query]: /^receipt\.query$/,
      [M.supplied]: /^supplied\.tokens/,
      [M.note]: /^(note\.text|check\.missing)/,
      [M.value]: /^(note\.values|check\.missing)/,
      [M.why]: /^withdrawal\.why$/,
      [M.draft]: /^check\.missing/,
      [M.delivered]: /^$/,
    };
    const found: string[] = [];
    const walk = (v: unknown, path: string, kind: string) => {
      if (typeof v === 'string') {
        for (const m of Object.values(M))
          if (v.includes(m)) {
            found.push(m);
            expect(`${kind}.${path}`, m).toMatch(allowed[m] as RegExp);
          }
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, path, kind));
      else if (typeof v === 'object' && v !== null)
        for (const [k, x] of Object.entries(v)) walk(x, path === '' ? k : `${path}.${k}`, kind);
    };
    for (const e of (await inner.load(s)).entries) walk(e, '', e.kind);
    expect(found).not.toContain(M.delivered);
    expect(new Set(found)).toEqual(new Set(Object.values(M).filter((m) => m !== M.delivered)));
  });
});
