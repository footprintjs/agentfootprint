/**
 * overclaim — the rule pack that checks a declaration like a claim: a refusal
 * or an absence never asserts more than was read.
 *
 * Pattern: a pure rule pack (the `tool-lint/rules.ts` shape), asked by the
 *          `check:semantics` gate (`check.ts`). No IO, no model.
 * Role:    lib/ layer (L1), pure. Reads the recognizers this folder owns.
 * Emits:   N/A.
 *
 * ## The finding it answers
 *
 * A registered study (two models) found that a tool's refusal text that said
 * more than its check — "No array matches 'X'. Known arrays: … a wrong
 * identifier, not missing data" — made replies WORSE: models told users "X is
 * not in your estate" when the tool had only failed to find X in one
 * inventory export. A refused call read nothing; an absence read what its
 * `checked` names. Neither may say what does not exist, or that the input is
 * wrong.
 *
 * ## The rules
 *
 *   • `refusal-asserts-absence` — a not-read result (a refusal a tool throws
 *     or returns; an effects envelope whose status is `invalid`, `denied` or
 *     `failure`) carries an absence (`af_absent`), `known_names`, or a
 *     sentence from {@link NON_EXISTENCE} or {@link WRONGNESS}.
 *   • `absence-asserts-wrongness` — an absence's `looked_for`, an item's
 *     `what`/`why`, `try_instead`, the typed tool's `why`, or an extra key's
 *     text calls the input wrong ({@link WRONGNESS}).
 *   • `authoritative-names` — every `among.authoritative` use, listed for
 *     review: it removes the gap "names outside <source>".
 *
 * ## The phrase packs — closed, versioned, small
 *
 * Two fixed lists of English phrases, matched after NFC, case folding and
 * curly-apostrophe folding. They are a gate's net, not a grammar: a phrasing
 * they miss is a missed finding, never a pass. The fuller detection grammar
 * (clauses, negation scope, languages) belongs to the delivery check, a later
 * piece; it may reuse these lists. {@link OVERCLAIM_PHRASES_VERSION} changes
 * whenever a list does.
 */

import { readAbsence, readCoverageLedger } from './coverage/recognize.js';
import { namesFacetOf } from './coverage/among.js';
import { readToolResultEnvelope } from './toolEffects.js';
import type { ToolAbsence } from './coverage/types.js';

/** Bumped whenever {@link NON_EXISTENCE} or {@link WRONGNESS} changes. */
export const OVERCLAIM_PHRASES_VERSION = 1;

/** The opt-in rule sets `check:semantics` takes (`rules: ['overclaim']`). */
export type SemanticsRuleSet = 'overclaim';

/** The closed list of rule sets, as data. */
export const SEMANTICS_RULE_SETS: readonly SemanticsRuleSet[] = ['overclaim'];

/** The codes this pack files. */
export type OverclaimCode =
  | 'refusal-asserts-absence'
  | 'absence-asserts-wrongness'
  | 'authoritative-names';

/** One finding of this pack, before the gate stamps tool, severity and index. */
export interface OverclaimIssue {
  readonly code: OverclaimCode;
  /** The field, dot-pathed from the value judged (`try_instead`, `checked[0].authoritative`). */
  readonly field: string;
  /** What is wrong and the fix — without the tool name; the gate adds it. */
  readonly message: string;
}

/** A sentence that says a thing is not there. */
const NON_EXISTENCE: readonly RegExp[] = [
  /\b(?:does|do|did) not exist\b/,
  /\b(?:doesn't|don't|didn't) exist\b/,
  /\bno longer exists?\b/,
  /\bnon-?existent\b/,
  /\bno such\b/,
  /\bnot found\b/,
  /\bthere (?:is|are|was|were) no\b/,
  /\bno \w+ (?:matches|matched|exists|was found|were found)\b/,
  /\bnone of\b/,
  /\bnothing (?:is|was|matches|matched)\b/,
  /\b(?:is|are|was|were) not (?:in|among|listed)\b/,
  /\b(?:isn't|aren't|wasn't|weren't) (?:in|among|listed)\b/,
  /\b(?:has|have|had) no\b/,
  /\b0 [a-z]+s\b/,
];

/** A sentence that calls the input wrong. */
const WRONGNESS: readonly RegExp[] = [
  /\bwrong (?:identifier|id|name|value|key|input)\b/,
  /\bnot an? valid\b/,
  /\binvalid (?:identifier|id|name|value|key|input)\b/,
  /\bno such\b/,
  /\bnot missing data\b/,
  /\btypos?\b/,
  /\bmisspel(?:led|t|ling)\b/,
  /\bmistyped\b/,
];

/** One spelling for matching: composed, case-folded, straight apostrophes. */
const folded = (text: string): string =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'");

function firstHit(text: string, pack: readonly RegExp[]): string | undefined {
  const plain = folded(text);
  for (const pattern of pack) {
    const hit = pattern.exec(plain);
    if (hit !== null) return hit[0];
  }
  return undefined;
}

/** The first non-existence phrase in `text`, or `undefined`. */
export function nonExistencePhrase(text: string): string | undefined {
  return firstHit(text, NON_EXISTENCE);
}

/** The first phrase in `text` that calls the input wrong, or `undefined`. */
export function wrongnessPhrase(text: string): string | undefined {
  return firstHit(text, WRONGNESS);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every string leaf of `value` with its dot path, `seen`-guarded. */
function stringLeaves(value: unknown, path: string, out: [string, string][], seen: Set<unknown>) {
  if (typeof value === 'string') {
    out.push([path, value]);
    return;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((v, i) => [`${path}[${i}]`, v] as const)
    : Object.entries(value).map(([k, v]) => [path === '' ? k : `${path}.${k}`, v] as const);
  for (const [at, v] of entries) stringLeaves(v, at, out, seen);
}

/** The statuses that say a call read nothing. */
const NOT_READ_STATUSES: ReadonlySet<string> = new Set(['invalid', 'denied', 'failure']);

/**
 * True when `value` is a result that READ NOTHING by its own declaration — an
 * effects envelope whose `status` is `invalid`, `denied` or `failure`.
 */
export function isNotReadResult(value: unknown): boolean {
  const envelope = readToolResultEnvelope(value);
  return envelope?.status !== undefined && NOT_READ_STATUSES.has(envelope.status);
}

/**
 * `refusal-asserts-absence` over one refusal — the text a tool throws, or the
 * value it returns when it refuses. A refused call read nothing, so it may
 * carry no absence, no `known_names`, and no sentence that says what does not
 * exist or that the input is wrong.
 */
export function refusalIssues(value: unknown, field: string): OverclaimIssue[] {
  const code = 'refusal-asserts-absence';
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  if (readAbsence(value) !== undefined || /"?af_absent"?\s*:/.test(text)) {
    return [
      {
        code,
        field,
        message:
          'a refusal carries an absence (`af_absent`) — a refused call read nothing, and an ' +
          'absence says a search ran. Return one or the other.',
      },
    ];
  }
  if (/"?known_names"?\s*:/.test(text)) {
    return [
      {
        code,
        field,
        message:
          'a refusal carries `known_names` — names belong to an absence over the list the ' +
          'tool read (absent({ what, among })), never to a refusal.',
      },
    ];
  }
  const leaves: [string, string][] = [];
  stringLeaves(value, '', leaves, new Set());
  for (const [, leaf] of leaves) {
    const phrase = nonExistencePhrase(leaf) ?? wrongnessPhrase(leaf);
    if (phrase === undefined) continue;
    return [
      {
        code,
        field,
        message:
          `a refusal says "${phrase}" — a refused call read nothing, so it cannot say what ` +
          'does not exist or that the input is wrong. Say what was refused and why ("array_id ' +
          'must start with PS-"); when a lookup ran and found nothing, return ' +
          'absent({ what, among }) instead.',
      },
    ];
  }
  return [];
}

/** The absence fields a wrongness phrase is looked for in, as `[path, text]`. */
function absenceTexts(absence: ToolAbsence): [string, string][] {
  const out: [string, string][] = [];
  const own = absence as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(own)) {
    // The library's own sentence, and the model-only names (the tool's data,
    // not its words), are not the author's claim.
    if (key === 'note' || key === 'known_names' || key === 'af_absent') continue;
    if (key === 'checked' || key === 'not_checked' || key === 'cannot_cover') {
      if (!Array.isArray(value)) continue;
      value.forEach((item: unknown, i) => {
        if (!isRecord(item)) return;
        for (const part of ['what', 'why'] as const) {
          const text = item[part];
          if (typeof text === 'string') out.push([`${key}[${i}].${part}`, text]);
        }
      });
      continue;
    }
    stringLeaves(value, key, out, new Set());
  }
  return out;
}

/**
 * `absence-asserts-wrongness` and `authoritative-names` over one absence. An
 * absence says what was searched; it never calls the input wrong — a name
 * missing from one list may exist elsewhere.
 */
export function absenceIssues(absence: ToolAbsence): OverclaimIssue[] {
  const issues: OverclaimIssue[] = [];
  for (const [field, text] of absenceTexts(absence)) {
    const phrase = wrongnessPhrase(text);
    if (phrase === undefined) continue;
    issues.push({
      code: 'absence-asserts-wrongness',
      field,
      message:
        `the absence's \`${field}\` says "${phrase}" — an absence says what was searched, not ` +
        'that the input is wrong: a name missing from one list may exist elsewhere. Name the ' +
        'list searched (absent({ what, among: { source, … } })) and let the gap "names outside ' +
        '<source>" stand.',
    });
  }
  const facet = namesFacetOf(absence);
  if (facet?.authoritative !== undefined) {
    const at = absence.checked.indexOf(facet);
    issues.push({
      code: 'authoritative-names',
      field: `checked[${at}].authoritative`,
      message:
        `\`among.authoritative\` removes the gap "names outside ${facet.source}" — the tool ` +
        `says ${facet.source} holds every name there is (why: "${facet.authoritative.why}"). ` +
        'Review that it holds for every caller this tool serves.',
    });
  }
  return issues;
}

/**
 * The absences a sample result carries — a bare one, or one a `coverage()`
 * ledger bounds, to any depth: the shapes the dispatch door recognizes.
 */
export function absencesIn(value: unknown): ToolAbsence[] {
  const out: ToolAbsence[] = [];
  const seen = new Set<unknown>();
  let at: unknown = value;
  while (typeof at === 'object' && at !== null && !seen.has(at)) {
    seen.add(at);
    const absence = readAbsence(at);
    if (absence !== undefined) {
      out.push(absence);
      break;
    }
    const covered = readCoverageLedger(at);
    if (covered === undefined) break;
    at = covered.result;
  }
  return out;
}
