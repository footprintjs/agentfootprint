/**
 * llm-ledger/stages — the stage functions every call's chart is made of.
 *
 * Pattern: stage factories over one `CallFrame`, the call's closure. The frame holds what must
 *          never be chart state: the call's input, the attempt's `LedgerReader`, the entries the
 *          call builds and its reply. Scope (`CallState`) gets only names, numbers, verdict words
 *          and decision records, by construction.
 * Role:    the shared frame (`read-call`, `load-log`, `admit`, `append`, `after-append`, `reply`)
 *          and the calls' own stages (`extract-tokens`, `check-claims`, `check-draft`, `fold`,
 *          `compare`, `await-person`, `append-released`). `calls.ts` wires them into one chart.
 * Emits:   N/A.
 *
 * `append` writes ONE batch. On `conflict` the chart loops to `load-log` (at most `maxAttempts`
 * attempts, then `busy`), so a submit reruns its checks on the new log. On `lock-lost` the batch
 * may or may not stand: `append` reloads once and compares the call's own entries at
 * `expectedSeq + 1 … end`; it never re-stamps and appends the same entries again — if they are not
 * there, the call is refused with `store-refused` and `store: 'lock-lost'`.
 */
import { decide } from 'footprintjs';
import type { DecideRule, DecisionRecord, TypedScope } from 'footprintjs';
import { canonicalizeJson } from 'foottrace/canonical-json';

import { citeProblem } from './entries.js';
import { LEDGER_LIMITS as L } from './limits.js';
import { readerOf } from './reader.js';
import type { LedgerReader } from './reader.js';
import { foldReport } from './report.js';
import type { LedgerCheckView, LedgerReport } from './report.js';
import { runRule } from './rules/port.js';
import type {
  LedgerFinding,
  LedgerRule,
  LedgerRuleInput,
  LedgerSubjectKind,
} from './rules/port.js';
import type { LedgerServed } from './serve.js';
import { LedgerStoreError } from './store.js';
import type { LedgerStore } from './store.js';
import type { LedgerEntry, LedgerNote, LedgerReceipt, LedgerRefusal } from './types.js';

/** The call kinds: the host's and the agent's. */
export type LedgerCallKind =
  | 'open'
  | 'record'
  | 'supply'
  | 'deliver'
  | 'report'
  | 'note'
  | 'withdraw'
  | 'ask'
  | 'submit';

/** Run state: names, numbers, verdict words and decision records only. */
export interface CallState {
  attempt: number;
  seq: number;
  opened: boolean;
  confirm: boolean;
  askRunsRules: boolean;
  inputRefusal: string;
  storeRefused: boolean;
  noSession: boolean;
  sessionExists: boolean;
  unknownRule: boolean;
  full: boolean;
  unknownReceipt: boolean;
  notAReceipt: boolean;
  unknownNote: boolean;
  notANote: boolean;
  notAClaim: boolean;
  withdrawnNote: boolean;
  alreadyWithdrawn: boolean;
  ruleNotLoaded: boolean;
  refused: string;
  outcome: string;
  appendedSeq: number;
  checks: {
    rule: string;
    subject: { note: number } | { draft: true };
    disposition: string;
    verdict?: string;
    decision?: DecisionRecord;
  }[];
  hasSubmit: boolean;
  matches: boolean;
  answer: string;
  answerWhy: string;
}

/** The call's closure: everything a stage needs that must not be run state. */
export interface CallFrame {
  readonly kind: LedgerCallKind;
  readonly session: string;
  readonly store: LedgerStore;
  readonly rules: ReadonlyMap<string, LedgerRule>;
  readonly clock: () => string;
  /** The call's input, as handed in. */
  readonly input: Record<string, unknown>;
  /** What `read-call` built: an entry with a provisional stamp, or a refusal word. */
  built?: LedgerEntry;
  /** This attempt's reader. */
  reader?: LedgerReader;
  /** The findings of this attempt's checks, by subject. */
  findings?: readonly (LedgerFinding & { readonly subject: LedgerCheckView['subject'] })[];
  /** Builds this attempt's batch, given the seq of its first entry. */
  batchAt?: (first: number) => LedgerEntry[];
  /** The log as this call left it (the attempt's entries and the call's appends). */
  after?: readonly LedgerEntry[];
  report?: LedgerReport;
  refusal?: { readonly word: LedgerRefusal; readonly store?: string };
  reply?: LedgerServed;
  /** Store loads made, for audits and the "each attempt loads once" property. */
  loads: number;
}

type Scope = TypedScope<CallState>;

/** The refusal words `admit` can choose, in precedence order: the first that holds wins. */
const ADMIT: readonly (readonly [string, LedgerRefusal])[] = Object.freeze([
  ['storeRefused', 'store-refused'],
  ['noSession', 'no-session'],
  ['sessionExists', 'session-exists'],
  ['unknownRule', 'unknown-rule'],
  ['full', 'ledger-full'],
  ['unknownReceipt', 'unknown-receipt'],
  ['notAReceipt', 'not-a-receipt'],
  ['unknownNote', 'unknown-note'],
  ['notANote', 'not-a-note'],
  ['notAClaim', 'not-a-claim'],
  ['withdrawnNote', 'withdrawn-note'],
  ['alreadyWithdrawn', 'already-withdrawn'],
  ['ruleNotLoaded', 'rule-not-loaded'],
]);

/** Every word `admit` can branch to: the input's, then the table's. */
export const ADMIT_WORDS: readonly LedgerRefusal[] = Object.freeze([
  'bad-session',
  'bad-input',
  'too-large',
  'bad-window',
  'store-refused',
  'no-session',
  'session-exists',
  'unknown-rule',
  'ledger-full',
  'unknown-receipt',
  'not-a-receipt',
  'unknown-note',
  'not-a-note',
  'not-a-claim',
  'withdrawn-note',
  'already-withdrawn',
  'rule-not-loaded',
]);

/** `admit`'s table: the input's refusal first, then the log's facts. */
function admitTable(): DecideRule<CallState>[] {
  return [
    ...['bad-session', 'bad-input', 'too-large', 'bad-window'].map((word) => ({
      when: { inputRefusal: { eq: word } },
      then: word,
      label: `the input: ${word}`,
    })),
    ...ADMIT.map(([fact, word]) => ({
      when: { [fact]: { eq: true } } as DecideRule<CallState>['when'],
      then: word,
      label: word,
    })),
  ];
}

/** Calls that append: they are refused at the entry cap. */
const APPENDS: readonly LedgerCallKind[] = Object.freeze([
  'open',
  'record',
  'supply',
  'deliver',
  'note',
  'withdraw',
  'submit',
]);

/** `load-log`: this attempt's one load, into the frame. Scope gets the seq and the session's options. */
export function loadLog(frame: CallFrame) {
  return async (s: Scope): Promise<void> => {
    s.attempt = (s.attempt ?? 0) + 1;
    s.storeRefused = false;
    frame.loads++;
    try {
      frame.reader = readerOf(await frame.store.load(frame.session));
    } catch (error) {
      if (!(error instanceof LedgerStoreError)) throw error;
      frame.refusal = { word: 'store-refused', store: error.code };
      s.storeRefused = true;
      return;
    }
    const opened = frame.reader.opened;
    s.seq = frame.reader.seq;
    s.opened = opened !== undefined;
    s.confirm = opened?.confirm === true;
    s.askRunsRules = opened?.askRunsRules === true;
  };
}

/** The session's rules that this process lacks. */
const missingRules = (frame: CallFrame): boolean =>
  (frame.reader?.opened?.rules ?? []).some((key) => !frame.rules.has(key));

/** `admit`: flat facts into scope, then one `decide()`: the first refusal wins, else `go`. */
export function admit(frame: CallFrame) {
  return (s: Scope) => {
    const reader = frame.reader;
    if (reader !== undefined && !s.storeRefused) {
      if (frame.kind === 'open') {
        s.sessionExists = reader.seq > 0;
        const pinned = frame.built?.kind === 'opened' ? frame.built.rules : [];
        s.unknownRule = pinned.some((key) => !frame.rules.has(key));
      } else s.noSession = reader.opened === undefined;
      if (APPENDS.includes(frame.kind)) s.full = reader.full;
      const entry = frame.built;
      if (entry?.kind === 'note') {
        const problem = citeProblem(allOf(reader), entry.cites);
        s.unknownReceipt = problem === 'unknown-receipt';
        s.notAReceipt = problem === 'not-a-receipt';
      }
      if (entry?.kind === 'withdrawal') {
        const target = reader.entry(entry.note);
        s.unknownNote = target === undefined;
        s.notANote = target !== undefined && target.kind !== 'note';
        s.alreadyWithdrawn =
          target?.kind === 'note' && reader.withdrawalOf(entry.note) !== undefined;
      }
      if (entry?.kind === 'submit') {
        const named = entry.claims.map((c) => reader.entry(c));
        s.unknownNote = named.some((e) => e === undefined);
        s.notANote = named.some((e) => e !== undefined && e.kind !== 'note');
        s.notAClaim = named.some((e) => e?.kind === 'note' && e.noteKind === 'question');
        s.withdrawnNote = entry.claims.some((c) => reader.withdrawalOf(c) !== undefined);
      }
      if (frame.kind === 'submit' || (frame.kind === 'ask' && s.askRunsRules))
        s.ruleNotLoaded = missingRules(frame);
    }
    return decide(s, admitTable(), { branch: 'go', label: 'admitted' });
  };
}

/** Every entry of `reader`, in seq order. */
function allOf(reader: LedgerReader): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (let seq = 1; seq <= reader.seq; seq++) out.push(reader.entry(seq) as LedgerEntry);
  return out;
}

/** A refusal branch: the word into scope, the reply into the frame, and the run ends. */
export function refuse(frame: CallFrame, word: LedgerRefusal) {
  return (s: Scope) => {
    const store = word === 'store-refused' ? frame.refusal?.store : undefined;
    frame.refusal = { word, ...(store === undefined ? {} : { store }) };
    s.refused = word;
    frame.reply = { ok: false, refused: word, ...(store === undefined ? {} : { store }) };
    s.$break();
  };
}

/** `entry` at `seq`, stamped now. */
const restamp = (entry: LedgerEntry, seq: number, at: string): LedgerEntry =>
  ({ ...entry, seq, at } as LedgerEntry);

/** `extract-tokens` (record, supply), and the plain stamping stage of note, withdraw, open, deliver. */
export function stampBuilt(frame: CallFrame) {
  return () => {
    const entry = frame.built as LedgerEntry;
    const at = frame.clock();
    frame.batchAt = (first) => [restamp(entry, first, at)];
  };
}

/** The rule input of one subject. */
function inputOf(reader: LedgerReader, subject: LedgerRuleInput['subject']): LedgerRuleInput {
  const receipts =
    subject.kind === 'draft'
      ? reader.receipts
      : subject.note.cites
          .map((c) => reader.receipt(c))
          .filter((r): r is LedgerReceipt => r !== undefined);
  return Object.freeze({
    subject: Object.freeze(subject),
    receipts: Object.freeze(receipts),
    supplied: reader.supplied,
  });
}

/** The session's rules that apply to `kind`, in `opened.rules` order. */
function rulesFor(frame: CallFrame, kind: LedgerSubjectKind): LedgerRule[] {
  return (frame.reader?.opened?.rules ?? [])
    .map((key) => frame.rules.get(key))
    .filter((r): r is LedgerRule => r !== undefined && r.appliesTo.includes(kind));
}

/** The notes a check runs on: a submit's named claims, or (a dry `ask`) every live checkable note. */
function claimsOf(frame: CallFrame): LedgerNote[] {
  const reader = frame.reader as LedgerReader;
  const seqs =
    frame.built?.kind === 'submit'
      ? frame.built.claims
      : reader.notes
          .filter((n) => n.noteKind !== 'question' && reader.withdrawalOf(n.seq) === undefined)
          .map((n) => n.seq);
  return seqs.map((s) => reader.note(s)).filter((n): n is LedgerNote => n !== undefined);
}

/** Puts a finding's run-state projection into scope `checks`: words and the decision record only. */
function project(s: Scope, frame: CallFrame): void {
  s.checks = (frame.findings ?? []).map((f) => ({
    rule: f.rule,
    subject: f.subject,
    disposition: f.disposition,
    ...(f.verdict === undefined ? {} : { verdict: f.verdict }),
    ...(f.decision === undefined ? {} : { decision: f.decision }),
  }));
}

/** `check-claims`: the session's rules on each named claim, against its cited receipts. */
export function checkClaims(frame: CallFrame) {
  return async (s: Scope): Promise<void> => {
    const reader = frame.reader as LedgerReader;
    const findings: (LedgerFinding & { subject: LedgerCheckView['subject'] })[] = [];
    for (const note of claimsOf(frame)) {
      const kind = note.noteKind as 'claim' | 'ruled-out';
      for (const rule of rulesFor(frame, kind))
        findings.push({
          ...(await runRule(rule, inputOf(reader, { kind, note }))),
          subject: { note: note.seq },
        });
    }
    frame.findings = findings;
    project(s, frame);
  };
}

/** `check-draft`: the session's draft rules on the whole draft, against every receipt. */
export function checkDraft(frame: CallFrame) {
  return async (s: Scope): Promise<void> => {
    const reader = frame.reader as LedgerReader;
    const text = frame.input.draft as string;
    const findings = [...(frame.findings ?? [])];
    for (const rule of rulesFor(frame, 'draft'))
      findings.push({
        ...(await runRule(rule, inputOf(reader, { kind: 'draft', text }))),
        subject: { draft: true },
      });
    frame.findings = findings;
    project(s, frame);
    const submit = frame.built as LedgerEntry & { kind: 'submit' };
    const at = frame.clock();
    frame.batchAt = (first) => [
      restamp(submit, first, at),
      ...findings.map(
        (f, i) =>
          ({
            v: 1,
            seq: first + 1 + i,
            kind: 'check',
            by: 'ledger',
            how: 'observed',
            at,
            submit: first,
            subject: f.subject,
            rule: f.rule,
            disposition: f.disposition,
            ...(f.verdict === undefined ? {} : { verdict: f.verdict }),
            restsOn: [...f.restsOn],
            ...(f.decision === undefined ? {} : { decision: f.decision }),
            counts: { ...f.counts },
            ...(f.missing === undefined ? {} : { missing: [...f.missing] }),
            ...(f.why === undefined ? {} : { why: f.why }),
          } as unknown as LedgerEntry),
      ),
    ];
  };
}

/** The log this attempt would leave: its entries and this call's batch at the next seqs. */
function withBatch(frame: CallFrame): LedgerEntry[] {
  const reader = frame.reader as LedgerReader;
  return [...allOf(reader), ...(frame.batchAt?.(reader.seq + 1) ?? [])];
}

/** `fold`: the report, over the log as this call leaves it (a dry `ask` folds its findings instead). */
export function fold(frame: CallFrame) {
  return () => {
    const after = withBatch(frame);
    const reader = readerOf({ seq: after.length, entries: after });
    frame.report =
      frame.kind === 'ask' && frame.findings !== undefined
        ? foldReport(reader, {
            claims: claimsOf(frame).map((n) => n.seq),
            checks: frame.findings,
          })
        : foldReport(reader);
  };
}

/** `compare` (deliver): does the delivered text match the last submit's draft? */
export function compare(frame: CallFrame) {
  return (s: Scope) => {
    const last = frame.reader?.lastSubmit;
    const delivered = frame.built as LedgerEntry & { kind: 'delivered' };
    s.hasSubmit = last !== undefined;
    s.matches = last !== undefined && last.draftDigest === delivered.digest;
    return decide(
      s,
      [
        { when: { hasSubmit: { eq: false } }, then: 'no-submit', label: 'nothing was submitted' },
        { when: { matches: { eq: true } }, then: 'matches', label: 'the checked draft' },
      ],
      { branch: 'differs', label: 'not the checked draft' },
    );
  };
}

/** The `deliver` entry, stamped with the comparison `compare` made. */
export function stampDelivered(frame: CallFrame) {
  return (s: Scope) => {
    const delivered = frame.built as LedgerEntry & { kind: 'delivered' };
    const last = frame.reader?.lastSubmit;
    const at = frame.clock();
    frame.batchAt = (first) => [
      {
        ...delivered,
        seq: first,
        at,
        submit: last === undefined ? null : last.seq,
        matches: s.matches === true,
      } as LedgerEntry,
    ];
  };
}

const same = (a: LedgerEntry, b: LedgerEntry): boolean =>
  canonicalizeJson(a) === canonicalizeJson(b);

/** `append`: the attempt's one batch, at the seq this attempt loaded. */
export function append(frame: CallFrame) {
  return async (s: Scope): Promise<void> => {
    const reader = frame.reader as LedgerReader;
    const batch = frame.batchAt?.(reader.seq + 1) ?? [];
    if (batch.length === 0) {
      s.outcome = 'appended';
      return;
    }
    try {
      const got = await frame.store.append(frame.session, reader.seq, batch);
      if (got === 'conflict') {
        s.outcome = 'conflict';
        return;
      }
      s.outcome = 'appended';
      s.appendedSeq = got;
      frame.after = [...allOf(reader), ...batch];
    } catch (error) {
      if (!(error instanceof LedgerStoreError)) throw error;
      if (error.code === 'lock-lost') {
        // The batch may or may not stand: reload once and look. Never append it again.
        frame.loads++;
        const now = await frame.store.load(frame.session).catch(() => undefined);
        const stood =
          now !== undefined &&
          now.entries.length >= reader.seq + batch.length &&
          batch.every((e, i) => same(e, now.entries[reader.seq + i] as LedgerEntry));
        if (stood) {
          s.outcome = 'appended';
          s.appendedSeq = reader.seq + batch.length;
          frame.after = [...allOf(reader), ...batch];
          return;
        }
      }
      frame.refusal =
        error.code === 'too-large'
          ? { word: 'ledger-full' }
          : { word: 'store-refused', store: error.code };
      s.outcome = 'refused';
    }
  };
}

/** `after-append`: appended, refused, `busy` after the last attempt, or `conflict` (loop to `load-log`). */
export function afterAppend() {
  return (s: Scope) =>
    decide(
      s,
      [
        {
          when: { outcome: { eq: 'refused' } },
          then: 'append-refused',
          label: 'the store refused',
        },
        { when: { outcome: { eq: 'appended' } }, then: 'appended', label: 'the batch stands' },
        {
          when: { attempt: { gte: L.maxAttempts } },
          then: 'busy',
          label: 'another writer kept appending first',
        },
      ],
      { branch: 'conflict', label: 'another writer appended first' },
    );
}

/** The `append-refused` branch: the store's word, from the frame. */
export function refuseAppend(frame: CallFrame) {
  return (s: Scope) => refuse(frame, frame.refusal?.word ?? 'store-refused')(s);
}

/** `release` (submit): a session opened with `confirm` waits for a person. */
export function release() {
  return (s: Scope) =>
    decide(s, [{ when: { confirm: { eq: true } }, then: 'await-person', label: 'confirm is on' }], {
      branch: 'no-wait',
      label: 'confirm is off',
    });
}

/** `await-person`: pauses with `{ submit, standing, counts }` — no values — and takes the answer. */
export function awaitPerson(frame: CallFrame) {
  return {
    execute: (s: Scope) => ({
      submit: s.appendedSeq - (frame.findings?.length ?? 0),
      standing: frame.report?.standing ?? 'not-assessed',
      counts: { ...(frame.report?.counts ?? {}) },
    }),
    resume: (s: Scope, input: unknown) => {
      const given = (input ?? {}) as { answer?: unknown; why?: unknown };
      s.answer = given.answer === 'release' ? 'release' : 'withhold';
      s.answerWhy = given.why === 'no-person-channel' ? 'no-person-channel' : '';
    },
  };
}

/** `append-released`: the person's answer, after the submit's batch. A conflict reloads and retries. */
export function appendReleased(frame: CallFrame) {
  return async (s: Scope): Promise<void> => {
    if (s.answer !== 'release' && s.answer !== 'withhold') return;
    const submit = s.appendedSeq - (frame.findings?.length ?? 0);
    const at = frame.clock();
    let log = frame.after as readonly LedgerEntry[];
    for (let attempt = 1; attempt <= L.maxAttempts; attempt++) {
      const entry = {
        v: 1,
        seq: log.length + 1,
        kind: 'released',
        by: 'person',
        how: 'reported',
        at,
        submit,
        answer: s.answer,
        ...(s.answerWhy === 'no-person-channel' ? { why: 'no-person-channel' } : {}),
      } as LedgerEntry;
      const got = await frame.store.append(frame.session, log.length, [entry]);
      if (got !== 'conflict') {
        frame.after = [...log, entry];
        const reader = readerOf({ seq: frame.after.length, entries: frame.after });
        frame.report = foldReport(reader);
        return;
      }
      frame.loads++;
      log = (await frame.store.load(frame.session)).entries;
    }
  };
}
