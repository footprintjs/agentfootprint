/**
 * llm-ledger/rules/port — the checks port: how a rule is registered and run, and what its check says.
 *
 * Pattern: a port with two doors and one law. A TABLE rule states facts and a `decide()` table,
 *          run by the engine's `decideFromFacts` (which masks every value); its stored record is
 *          `decisionRecord(evidence)`. A CODE rule decides with its own code; its stored record is
 *          `fixedRecord(outcome, label, 'app')`. The evidence itself is never stored.
 * Role:    the one place a rule meets the ledger. The three built-ins (`cited.ts`,
 *          `traceableValues.ts`, `timeWindow.ts`) are table rules registered through it, so a host
 *          rule and a built-in are judged the same way.
 * Emits:   N/A.
 *
 * A rule runs on the TRUSTED side, on real values: the subject (a note, or the draft's text), its
 * receipts (the cited ones for a note, all of them for the draft) and the session's supplied
 * entries, frozen. What it returns is reduced to words, numbers, seqs and a decision record before
 * anything is stored: a rule's message, thrown value or facts never reach the log.
 *
 * A rule that throws, runs past `ruleTimeoutMs` or returns something malformed (an unknown branch, a
 * `restsOn` outside its receipts, facts the engine refuses) gives `unreachable` with `why`
 * `rule-threw`, `rule-timeout` or `bad-result`, verdict `open`, and no decision record.
 */
import { decideFromFacts, decisionRecord, fixedRecord } from 'footprintjs';
import type { DecideRule, DecisionRecord } from 'footprintjs';

import { LEDGER_LIMITS as L } from '../limits.js';
import type {
  LedgerCheckWhy,
  LedgerDisposition,
  LedgerNote,
  LedgerReceipt,
  LedgerSupplied,
  LedgerVerdict,
} from '../types.js';

/** What a rule can be about. */
export type LedgerSubjectKind = 'claim' | 'ruled-out' | 'draft';

/** The subject of one check: a note (a claim or a ruled-out), or the draft's text. */
export type LedgerRuleSubject =
  | { readonly kind: 'claim' | 'ruled-out'; readonly note: LedgerNote }
  | { readonly kind: 'draft'; readonly text: string };

/** What a rule reads: real values, frozen. */
export interface LedgerRuleInput {
  readonly subject: LedgerRuleSubject;
  /** The cited receipts for a note; every receipt of the session for the draft. */
  readonly receipts: readonly LedgerReceipt[];
  readonly supplied: readonly LedgerSupplied[];
}

/** What a check counts. Every rule reports these four; a rule that counts nothing reports zeros. */
export interface LedgerCheckCounts {
  readonly visible: number;
  readonly missing: number;
  readonly supplied: number;
  readonly incomplete: number;
}

/** What a table rule's `facts` gives: flat facts for its table, and the receipts its finding rests on. */
export interface LedgerRuleFacts {
  readonly facts: Readonly<Record<string, number | boolean | string>>;
  readonly restsOn: readonly number[];
  readonly counts?: LedgerCheckCounts;
  /** Tokens no receipt holds; the check stores the first `maxMissing`. */
  readonly missing?: readonly string[];
}

interface LedgerRuleBase {
  readonly id: string;
  readonly version: number;
  readonly appliesTo: readonly LedgerSubjectKind[];
}

/** A rule that states facts and lets a `decide()` table choose its disposition. */
export interface LedgerTableRule extends LedgerRuleBase {
  facts(input: LedgerRuleInput): LedgerRuleFacts | Promise<LedgerRuleFacts>;
  readonly table: readonly DecideRule<Record<string, unknown>>[];
  readonly default: { readonly branch: LedgerDisposition; readonly label?: string };
}

/** A rule that decides with its own code. Its record is `fixedRecord(outcome, label, 'app')`. */
export interface LedgerCodeRule extends LedgerRuleBase {
  decide(input: LedgerRuleInput): LedgerCodeOutcome | Promise<LedgerCodeOutcome>;
}

/** A code rule's answer. */
export interface LedgerCodeOutcome {
  readonly outcome: LedgerDisposition;
  readonly label?: string;
  readonly restsOn: readonly number[];
}

/** Either form. */
export type LedgerRule = LedgerTableRule | LedgerCodeRule;

/** What one rule found on one subject: what a `check` entry stores, before its stamp. */
export interface LedgerFinding {
  readonly rule: string;
  readonly disposition: LedgerDisposition;
  readonly verdict?: LedgerVerdict;
  readonly restsOn: readonly number[];
  readonly decision?: DecisionRecord;
  readonly counts: LedgerCheckCounts;
  readonly missing?: readonly string[];
  readonly why?: LedgerCheckWhy;
}

/** Why a registration was refused: a fixed word, never a value. */
export type LedgerRuleProblem =
  | 'bad-id'
  | 'bad-version'
  | 'duplicate'
  | 'bad-applies-to'
  | 'bad-branch'
  | 'function-rule'
  | 'too-many-rules'
  | 'too-many-facts'
  | 'bad-rule';

/** Thrown by `createLedger` when a rule cannot be registered. Its message is the problem word. */
export class LedgerRuleError extends Error {
  constructor(readonly problem: LedgerRuleProblem) {
    super(`llm-ledger rule: ${problem}`);
    this.name = 'LedgerRuleError';
  }
}

const DISPOSITIONS: readonly string[] = Object.freeze([
  'checked-pass',
  'checked-fail',
  'not-applicable',
  'unreachable',
]);
const SUBJECTS: readonly string[] = Object.freeze(['claim', 'ruled-out', 'draft']);
const BUILT_IN_ID = /^[a-z][a-z0-9-]{1,47}$/;
const HOST_ID = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,47}$/;
const ZERO: LedgerCheckCounts = Object.freeze({
  visible: 0,
  missing: 0,
  supplied: 0,
  incomplete: 0,
});

/** `id@version`: what a check record and `opened.rules` store. */
export const ruleKey = (rule: LedgerRule): string => `${rule.id}@${rule.version}`;

const isTableRule = (rule: LedgerRule): rule is LedgerTableRule =>
  typeof (rule as LedgerTableRule).facts === 'function';

/** The names a table's filters read. A function `when` is refused before this is asked. */
function factNames(table: readonly DecideRule<Record<string, unknown>>[]): Set<string> {
  const names = new Set<string>();
  for (const row of table) for (const name of Object.keys(row.when)) names.add(name);
  return names;
}

/** The problem with one rule, or `undefined`. `builtIn` admits an id without a namespace. */
function problemOf(rule: unknown, builtIn: boolean): LedgerRuleProblem | undefined {
  if (typeof rule !== 'object' || rule === null) return 'bad-rule';
  const r = rule as LedgerRule;
  if (typeof r.id !== 'string' || !(builtIn ? BUILT_IN_ID : HOST_ID).test(r.id)) return 'bad-id';
  if (!Number.isSafeInteger(r.version) || r.version < 1 || r.version > 999_999_999)
    return 'bad-version';
  if (
    !Array.isArray(r.appliesTo) ||
    r.appliesTo.length === 0 ||
    !r.appliesTo.every((s) => SUBJECTS.includes(s)) ||
    new Set(r.appliesTo).size !== r.appliesTo.length
  )
    return 'bad-applies-to';
  if (isTableRule(r)) {
    if (!Array.isArray(r.table) || typeof r.default !== 'object' || r.default === null)
      return 'bad-rule';
    if (!DISPOSITIONS.includes(r.default.branch)) return 'bad-branch';
    for (const row of r.table) {
      if (typeof row !== 'object' || row === null) return 'bad-rule';
      if (typeof row.when === 'function') return 'function-rule';
      if (typeof row.when !== 'object' || row.when === null) return 'bad-rule';
      if (!DISPOSITIONS.includes(row.then)) return 'bad-branch';
    }
    if (factNames(r.table).size > L.maxRuleFacts) return 'too-many-facts';
    return undefined;
  }
  return typeof (r as LedgerCodeRule).decide === 'function' ? undefined : 'bad-rule';
}

/**
 * The rules one ledger runs, by `id@version`: the built-ins, then the host's. Throws
 * `LedgerRuleError` on the first rule it cannot register.
 */
export function registerRules(
  builtIns: readonly LedgerRule[],
  host: readonly LedgerRule[] = [],
): ReadonlyMap<string, LedgerRule> {
  if (!Array.isArray(host)) throw new LedgerRuleError('bad-rule');
  // Historical versions of a built-in share its registration slot.
  const builtInNames = new Set(builtIns.map((rule) => rule?.id));
  if (builtInNames.size + host.length > L.maxRegisteredRules)
    throw new LedgerRuleError('too-many-rules');
  const rules = new Map<string, LedgerRule>();
  for (const [rule, builtIn] of [
    ...builtIns.map((r) => [r, true] as const),
    ...host.map((r) => [r, false] as const),
  ]) {
    const problem = problemOf(rule, builtIn);
    if (problem !== undefined) throw new LedgerRuleError(problem);
    const key = ruleKey(rule);
    if (rules.has(key)) throw new LedgerRuleError('duplicate');
    rules.set(key, Object.freeze({ ...rule }));
  }
  return rules;
}

/**
 * The verdict a disposition gives: a pass is `verified` only when it rests on receipts and every
 * one of them is observed; otherwise `consistent-with-reported` (chosen here: a pass that rests on
 * nothing is no observation).
 */
export function verdictOf(
  disposition: LedgerDisposition,
  restsOn: readonly number[],
  how: (seq: number) => 'observed' | 'reported' | undefined,
): LedgerVerdict | undefined {
  if (disposition === 'checked-fail') return 'unsupported';
  if (disposition === 'unreachable') return 'open';
  if (disposition === 'not-applicable') return undefined;
  return restsOn.length > 0 && restsOn.every((seq) => how(seq) === 'observed')
    ? 'verified'
    : 'consistent-with-reported';
}

/** The weakest verdict wins: `unsupported`, then `open`, then `consistent-with-reported`, then `verified`. */
export const VERDICT_ORDER: readonly LedgerVerdict[] = Object.freeze([
  'unsupported',
  'open',
  'consistent-with-reported',
  'verified',
]);

/** The weakest of `verdicts`, or `undefined` when there are none. */
export function weakest(
  verdicts: readonly (LedgerVerdict | undefined)[],
): LedgerVerdict | undefined {
  let rank = VERDICT_ORDER.length;
  for (const v of verdicts) if (v !== undefined) rank = Math.min(rank, VERDICT_ORDER.indexOf(v));
  return VERDICT_ORDER[rank];
}

/** A failed check: `unreachable`, `open`, no decision, no message. */
const failed = (rule: LedgerRule, why: LedgerCheckWhy): LedgerFinding => ({
  rule: ruleKey(rule),
  disposition: 'unreachable',
  verdict: 'open',
  restsOn: [],
  counts: ZERO,
  why,
});

/** Runs `work` and gives its value, `'timeout'` past `ms`, or `'threw'`. A sync rule is timed after it returns. */
async function within<T>(work: () => T | Promise<T>, ms: number): Promise<T | 'timeout' | 'threw'> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(work),
      new Promise<'timeout'>((settle) => {
        timer = setTimeout(() => settle('timeout'), ms);
      }),
    ]);
    if (value === 'timeout' || Date.now() - started > ms) return 'timeout';
    return value;
  } catch {
    return 'threw';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const isSeqList = (v: unknown, allowed: ReadonlySet<number>): v is readonly number[] =>
  Array.isArray(v) && v.length <= L.maxEntries && v.every((s) => allowed.has(s as number));

const isCounts = (v: unknown): v is LedgerCheckCounts =>
  typeof v === 'object' &&
  v !== null &&
  ['visible', 'missing', 'supplied', 'incomplete'].every((k) =>
    Number.isSafeInteger((v as Record<string, unknown>)[k]),
  ) &&
  Object.values(v).every((n) => (n as number) >= 0);

/** Runs one rule on one subject, never throwing. */
export async function runRule(rule: LedgerRule, input: LedgerRuleInput): Promise<LedgerFinding> {
  const allowed = new Set(input.receipts.map((r) => r.seq));
  const how = (seq: number) => input.receipts.find((r) => r.seq === seq)?.how;
  const sorted = (seqs: readonly number[]) => [...new Set(seqs)].sort((a, b) => a - b);
  if (isTableRule(rule)) {
    const out = await within(() => rule.facts(input), L.ruleTimeoutMs);
    if (out === 'timeout') return failed(rule, 'rule-timeout');
    if (out === 'threw') return failed(rule, 'rule-threw');
    if (
      typeof out !== 'object' ||
      out === null ||
      !isSeqList(out.restsOn, allowed) ||
      (out.counts !== undefined && !isCounts(out.counts)) ||
      (out.missing !== undefined &&
        !(Array.isArray(out.missing) && out.missing.every((t) => typeof t === 'string')))
    )
      return failed(rule, 'bad-result');
    let chosen: ReturnType<typeof decideFromFacts>;
    try {
      chosen = decideFromFacts(rule.table, out.facts, rule.default);
    } catch {
      return failed(rule, 'bad-result'); // facts the engine refuses: an accessor, a Map, a scope
    }
    const disposition = chosen.branch as LedgerDisposition;
    if (!DISPOSITIONS.includes(disposition)) return failed(rule, 'bad-result');
    const restsOn = sorted(out.restsOn);
    const missing = out.missing ?? [];
    const counts = out.counts ?? ZERO;
    return {
      rule: ruleKey(rule),
      disposition,
      ...(disposition === 'not-applicable'
        ? {}
        : { verdict: verdictOf(disposition, restsOn, how) as LedgerVerdict }),
      restsOn,
      decision: decisionRecord(chosen.evidence),
      counts: { ...counts, missing: Math.max(counts.missing, missing.length) },
      ...(missing.length > 0 ? { missing: missing.slice(0, L.maxMissing) } : {}),
    };
  }
  const out = await within(() => rule.decide(input), L.ruleTimeoutMs);
  if (out === 'timeout') return failed(rule, 'rule-timeout');
  if (out === 'threw') return failed(rule, 'rule-threw');
  if (
    typeof out !== 'object' ||
    out === null ||
    !DISPOSITIONS.includes(out.outcome) ||
    (out.label !== undefined && typeof out.label !== 'string') ||
    !isSeqList(out.restsOn, allowed)
  )
    return failed(rule, 'bad-result');
  const restsOn = sorted(out.restsOn);
  return {
    rule: ruleKey(rule),
    disposition: out.outcome,
    ...(out.outcome === 'not-applicable'
      ? {}
      : { verdict: verdictOf(out.outcome, restsOn, how) as LedgerVerdict }),
    restsOn,
    decision: fixedRecord(out.outcome, out.label, 'app'),
    counts: ZERO,
  };
}
