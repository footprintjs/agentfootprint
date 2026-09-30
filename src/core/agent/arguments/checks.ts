/**
 * arguments/checks — the declared-sources checks: where the model SAID a value
 * came from, checked against the one place that source lives.
 *
 * Pattern: Walker, pure. `checkSource` is a function of one argument's value,
 *          its rule, the model's claim about it (`_findings.from`, read by
 *          `sources.ts` · `readSources`) and the corpora the layer is handed
 *          (`SourceCorpus`). The same inputs always give the same verdict; no
 *          clock, no model, no scope.
 * Role:    core/ layer, the inputs layer (honesty layer 2), step 5. Loaded with
 *          the layer's stage bodies (`resolve.ts` imports it; both through
 *          `import()`), never on a plain agent's graph. Imports nothing from
 *          `findings/` (the one-way law): the mount builds the corpus and hands
 *          it in.
 * Emits:   N/A.
 *
 * ## One claim, one corpus — and a pass is never support
 *
 * Every check is whole-token membership (`evidence/normalize.ts` · `tokenize`
 * and `canonicalForm`, the evidence gate's own "same value", through
 * `evidence/resultCarries.ts` · `canonicalTokens`) in the ONE place the
 * claimed source lives:
 *
 * | Claim     | Checked against                                                       | Verified as                        |
 * |-----------|-----------------------------------------------------------------------|------------------------------------|
 * | `user`    | the quote in the person's own messages; the value in the quote, or a phrase the author declared for it | `said` (`matched: 'quote' \| 'phrase'`), or a READING |
 * | `result`  | the named result's own bytes (`evidence/resultCarries.ts` · `resultReader`, read once per batch) | `result` (`setAside` when the model set it aside) |
 * | `turn`    | the person's earlier answers to the library's ask (the ledger's `answered` rows) | `answered` (`matched: 'spelling'` across `24h` ↔ `-24h`) |
 * | `app`     | the app's own text (system messages, the composed system prompt, `externalGrounds`) | `app` (`appSource` = the ground's label) |
 * | `assumed`, nothing | nothing — the model's own                                    | `model`                            |
 *
 * A failed check is FILED as written (`failed`), never repaired and never
 * retried against another corpus: a false claim is itself a fact. For a failed
 * claim and for the model's own value, the library still looks the value up
 * (`coincides`) — a HINT for the lens and the bench, never a source, never
 * support, never enough to skip an ask.
 *
 * Membership can REFUTE a claim ("those words are not in any message you
 * sent"); a pass proves nothing — the words can be there by coincidence, in a
 * negation, in another sentence. So no verdict here ever supports "known": a
 * pass only keeps a reason from firing (`assessment/assess.ts` ·
 * `readArgumentVerdicts`).
 *
 * ## The declared default beats the app and a result (V1)
 *
 * A value equal to the argument's own `assume` value that the checks did not
 * verify as the PERSON's (their quoted words, or their answer) is filed
 * `default`, the claim kept as written — a model that copies a default from a
 * description chose nothing, and a default must never earn more standing
 * through `app` or `result` than the same default declared as `assume`.
 */

import { isPlacedToolResult } from '../../../artifacts/placement.js';
import { MAX_INDEX_TOKENS } from '../evidence/evidenceIndex.js';
import { canonicalTokens, occursIn, resultReader } from '../evidence/resultCarries.js';
import { leadingJsonValues } from '../evidence/servedJson.js';
import {
  convertSpelling,
  sameArgumentValue,
  type PeriodSpelling,
  type RuledArgument,
} from './declare.js';
import { HIDDEN_VALUE, type ArgumentCheckFailed, type ArgumentClaim } from './rows.js';
import type { DeclaredSource } from './sources.js';

// ─── The corpora ────────────────────────────────────────────────────────

/** One message a PERSON wrote (`lib/saidByPerson.ts` · `isSaidByPerson`), in the served window. */
export interface PersonWords {
  readonly text: string;
  /** Before the current request — an earlier turn. */
  readonly earlier?: true;
  /**
   * The run's OWN message in a composed run (`AgentInput.messageFrom:
   * 'composed'`): another runner's words handed on by a composition, never
   * the person's. A quote found only here fails as `composed-message`.
   */
  readonly composed?: true;
}

/** One tool result the model was served, by id. */
export interface ServedResult {
  readonly toolCallId: string;
  readonly toolName?: string;
  /**
   * The TOOL's own bytes as served — cut at the tool-bytes boundary
   * (`lib/toolBytes.ts` · `toolBytesOf`), so a library note never speaks for
   * the tool. Absent when the id is known only through the previous batch
   * (its entry carries no cut): such a claim is `uncheckable`, never "found".
   */
  readonly text?: string;
  /** Served before the current request — an earlier turn. */
  readonly earlier?: true;
  /** The model's current standing on it — the ledger's fold plus this batch's own `previous[]`. */
  readonly standing?: 'fact' | 'open' | 'noise' | 'ruled-out';
}

/** One piece of the app's own text. `label` names an `externalGrounds` entry's source. */
export interface AppWords {
  readonly text: string;
  readonly label?: string;
}

/** One answer the person gave the library's ask earlier (an `answered` row on the ledger). */
export interface EarlierAnswer {
  readonly toolName: string;
  readonly argument: string;
  /** The row's value — the tool's own view, clipped; `'REDACTED'` where the view hides it. */
  readonly value: string;
  readonly turn: number;
  readonly period?: true;
  /** The answered tool's declared period spelling, on its period argument. */
  readonly spelling?: PeriodSpelling;
}

/**
 * What the checks read — built by the mount from the served history, the
 * composed system prompt, the app's `externalGrounds` and the ledger's
 * standings and answers (`honesty/sourceCorpus.ts` · `sourceCorpusOf`). Never
 * the library's own frames, notes or served sentences; assistant text only to
 * say a value was found nowhere else (`only-in-model-answer`).
 */
export interface SourceCorpus {
  /** The conversation turn this batch belongs to (`AgentState.turnNumber`). */
  readonly turn: number;
  readonly person: readonly PersonWords[];
  readonly results: readonly ServedResult[];
  readonly assistant: readonly string[];
  readonly app: readonly AppWords[];
  readonly answers: readonly EarlierAnswer[];
}

// ─── The subject and the verdict ────────────────────────────────────────

/** One argument of one call, as the check is handed it. The value is RAW — never stored. */
export interface SourceSubject {
  readonly toolName: string;
  readonly argument: string;
  readonly value: unknown;
  /** The argument's rule; absent on a free argument a `from` entry named. */
  readonly rule?: RuledArgument;
  /** The tool's declared period spelling, when this is its period argument. */
  readonly spelling?: PeriodSpelling;
  /** The tool's `argumentsFrom` — the tools whose results ground its arguments. */
  readonly argumentsFrom?: readonly string[];
  /** The model's `from` entry for this argument; absent when it declared none. */
  readonly claim?: DeclaredSource;
}

/** The check's verdict — enums, flags, one id, one label; never a value. */
export interface SourceCheck {
  readonly source: 'said' | 'answered' | 'result' | 'app' | 'default' | 'model';
  readonly claimed: ArgumentClaim;
  readonly matched?: 'quote' | 'phrase' | 'spelling' | 'mention';
  readonly reading?: true;
  readonly earlier?: true;
  readonly result?: string;
  readonly setAside?: 'open' | 'noise' | 'ruled-out';
  readonly argumentsFrom?: 'listed' | 'unlisted';
  readonly appSource?: string;
  readonly coincides?: 'person' | 'result' | 'app';
  readonly failed?: ArgumentCheckFailed;
}

type Judged = Omit<SourceCheck, 'claimed'>;

/**
 * Whether a verdict traces the value to a source the record holds — the
 * person's words (`said` via the quote or a declared phrase), the person's
 * answer, a result, the app. A READING (`said` + `reading`), the model's own
 * value, a hint and a failed claim do not. Under an `ask` rule with declared
 * sources armed, a value this says no to is asked about (`resolve.ts`).
 */
export function isTraced(check: Pick<SourceCheck, 'source' | 'reading'>): boolean {
  if (check.source === 'said') return check.reading !== true;
  return check.source === 'answered' || check.source === 'result' || check.source === 'app';
}

/** Whether a verdict makes the value the PERSON's — their quoted words or their answer. */
function isPersons(check: Judged): boolean {
  return check.source === 'answered' || (check.source === 'said' && check.reading !== true);
}

// ─── Membership ─────────────────────────────────────────────────────────

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

/** Per corpus, each haystack's canonical tokens — computed once per text. */
const tokenCache = new WeakMap<SourceCorpus, Map<string, readonly string[]>>();

/** Per corpus, each served result read ONCE (`evidence/resultCarries.ts` · `resultReader`). */
const readerCache = new WeakMap<SourceCorpus, Map<ServedResult, ReturnType<typeof resultReader>>>();

/** Whether one served result carries a value — its bytes read once per corpus, however many values ask. */
function carries(
  corpus: SourceCorpus,
  result: ServedResult & { readonly text: string },
  value: string | number | boolean,
): 'found' | 'not-found' | 'uncheckable' {
  let cache = readerCache.get(corpus);
  if (cache === undefined) {
    cache = new Map();
    readerCache.set(corpus, cache);
  }
  let reader = cache.get(result);
  if (reader === undefined) {
    reader = resultReader(result.text);
    cache.set(result, reader);
  }
  return reader(value);
}

const hasText = (r: ServedResult): r is ServedResult & { readonly text: string } =>
  r.text !== undefined;

function haystackOf(corpus: SourceCorpus, text: string): readonly string[] {
  let cache = tokenCache.get(corpus);
  if (cache === undefined) {
    cache = new Map();
    tokenCache.set(corpus, cache);
  }
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const tokens = canonicalTokens(text);
  cache.set(text, tokens);
  return tokens;
}

type Membership = 'found' | 'not-found' | 'uncheckable';

/** `needle` in one text, read to the evidence index's ceiling: past it, never "not found". */
function contains(corpus: SourceCorpus, text: string, needle: readonly string[]): Membership {
  const hay = haystackOf(corpus, text);
  if (hay.length <= MAX_INDEX_TOKENS) return occursIn(needle, hay) ? 'found' : 'not-found';
  return occursIn(needle, hay.slice(0, MAX_INDEX_TOKENS)) ? 'found' : 'uncheckable';
}

/** The same value, by the evidence module's rule: equal canonical token sequences. */
function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((t, i) => t === b[i]);
}

/** A row value the clip cut (`integrity/argumentLeaves.ts` · `clipValue`) — nothing to compare. */
const isClipped = (value: string): boolean => value.length >= 80 && value.endsWith('…');

/**
 * A placement ticket — the model was served the ticket, not the value. Read
 * as the result's LEADING JSON value (`evidence/servedJson.ts`), so a ticket a
 * framework note follows is still a ticket.
 */
function isPlaced(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return false;
  const [first] = leadingJsonValues(trimmed).values;
  return first !== undefined && isPlacedToolResult(first);
}

// ─── The hint ───────────────────────────────────────────────────────────

/**
 * The library's OWN lookup of a value — the person's words (never a composed
 * run's own message), then the results, then the app's text. A hit is a hint
 * (`coincides`): never a source, never support, never enough to skip an ask.
 */
function hintOf(corpus: SourceCorpus, value: string | number | boolean): Judged['coincides'] {
  const needle = canonicalTokens(String(value));
  if (needle.length === 0) return undefined;
  if (
    corpus.person.some((p) => p.composed !== true && contains(corpus, p.text, needle) === 'found')
  ) {
    return 'person';
  }
  if (corpus.results.some((r) => hasText(r) && carries(corpus, r, value) === 'found')) {
    return 'result';
  }
  if (corpus.app.some((a) => contains(corpus, a.text, needle) === 'found')) return 'app';
  return undefined;
}

/** A failed claim: filed as written, the hint still computed. */
function failedWith(corpus: SourceCorpus, value: unknown, failed: ArgumentCheckFailed): Judged {
  const coincides = isPrimitive(value) ? hintOf(corpus, value) : undefined;
  return { source: 'model', failed, ...(coincides !== undefined && { coincides }) };
}

// ─── V2 · `user` + quote ────────────────────────────────────────────────

/** A phrase the author declared for the value's OWN choice, inside the quote. */
function phraseInQuote(subject: SourceSubject, quote: readonly string[]): boolean {
  const own = subject.rule?.ask?.phrases?.find((p) => sameArgumentValue(p.value, subject.value));
  if (own === undefined) return false;
  return own.said.some((phrase) => occursIn(canonicalTokens(phrase), quote));
}

function checkQuote(
  subject: SourceSubject,
  quoteText: string,
  value: string | number | boolean,
  corpus: SourceCorpus,
): Judged {
  const quote = canonicalTokens(quoteText);
  if (quote.length === 0) return failedWith(corpus, value, 'uncheckable');
  const matches: PersonWords[] = [];
  let unreadable = false;
  for (const p of corpus.person) {
    const found = contains(corpus, p.text, quote);
    if (found === 'found') matches.push(p);
    else if (found === 'uncheckable') unreadable = true;
  }
  if (matches.length === 0) {
    return failedWith(corpus, value, unreadable ? 'uncheckable' : 'quote-not-found');
  }
  // In a composed run, the run's own message is another runner's words.
  const persons = matches.filter((p) => p.composed !== true);
  if (persons.length === 0) return failedWith(corpus, value, 'composed-message');
  const earlier = persons.every((p) => p.earlier === true);
  const valueTokens = canonicalTokens(String(value));
  if (valueTokens.length === 0) return failedWith(corpus, value, 'uncheckable');
  const at = earlier ? { earlier: true as const } : {};
  if (occursIn(valueTokens, quote)) return { source: 'said', matched: 'quote', ...at };
  if (phraseInQuote(subject, quote)) return { source: 'said', matched: 'phrase', ...at };
  // The words are the person's; the value is the model's READING of them.
  return { source: 'said', reading: true, ...at };
}

// ─── V3 · `result` + id ─────────────────────────────────────────────────

function checkResult(
  subject: SourceSubject,
  id: string,
  value: string | number | boolean,
  corpus: SourceCorpus,
): Judged {
  const served = corpus.results.find((r) => r.toolCallId === id);
  if (served === undefined) return failedWith(corpus, value, 'unknown-result');
  if (!hasText(served)) return failedWith(corpus, value, 'uncheckable');
  if (isPlaced(served.text)) return failedWith(corpus, value, 'placed-result');
  const carried = carries(corpus, served, value);
  if (carried === 'uncheckable') return failedWith(corpus, value, 'uncheckable');
  if (carried === 'not-found') return failedWith(corpus, value, 'not-in-result');
  const setAside =
    served.standing === 'open' || served.standing === 'noise' || served.standing === 'ruled-out'
      ? served.standing
      : undefined;
  const grounds = subject.argumentsFrom;
  return {
    source: 'result',
    ...(served.earlier === true && { earlier: true as const }),
    result: served.toolCallId,
    ...(setAside !== undefined && { setAside }),
    ...(grounds !== undefined && {
      argumentsFrom:
        served.toolName !== undefined && grounds.includes(served.toolName)
          ? ('listed' as const)
          : ('unlisted' as const),
    }),
  };
}

// ─── V4 · `turn` ────────────────────────────────────────────────────────

/**
 * The earlier answers a `turn` claim may resolve to: the same argument OF THE
 * SAME TOOL (another tool's `limit` is not this one's), or — both period
 * arguments — a period answered for any tool (a period is a period, in the
 * spelling each tool declares).
 */
function answersFor(subject: SourceSubject, corpus: SourceCorpus): readonly EarlierAnswer[] {
  const period = subject.rule?.period === true;
  return corpus.answers.filter(
    (a) =>
      (a.toolName === subject.toolName && a.argument === subject.argument) ||
      (period && a.period === true),
  );
}

function checkTurn(
  subject: SourceSubject,
  value: string | number | boolean,
  corpus: SourceCorpus,
): Judged {
  const valueTokens = canonicalTokens(String(value));
  if (valueTokens.length === 0) return failedWith(corpus, value, 'uncheckable');
  const candidates = answersFor(subject, corpus);
  const readable = candidates.filter((a) => a.value !== HIDDEN_VALUE && !isClipped(a.value));
  const answered = (a: EarlierAnswer, matched?: 'spelling'): Judged => ({
    source: 'answered',
    ...(matched !== undefined && { matched }),
    ...(a.turn < corpus.turn && { earlier: true as const }),
  });
  const same = readable.find((a) => sameTokens(canonicalTokens(a.value), valueTokens));
  if (same !== undefined) return answered(same);
  // The one conversion the library makes between declared spellings (`24h` ↔ `-24h`).
  if (subject.rule?.period === true && subject.spelling !== undefined) {
    const converted = readable.find((a) => {
      if (a.period !== true || a.spelling === undefined) return false;
      const as = convertSpelling(a.value, a.spelling, subject.spelling as PeriodSpelling);
      return as !== undefined && sameTokens(canonicalTokens(String(as)), valueTokens);
    });
    if (converted !== undefined) return answered(converted, 'spelling');
  }
  // An answer the record cannot read back (the tool's view hides it, or the clip cut it).
  if (readable.length < candidates.length) return failedWith(corpus, value, 'uncheckable');
  if (corpus.answers.length === 0 && corpus.turn <= 1) {
    return failedWith(corpus, value, 'no-earlier-turn');
  }
  // Found in earlier words, results or the app's text: a HINT — to be verified, the model
  // quotes the words (`user`) or names the result (`result`).
  const hint = earlierHint(corpus, value, valueTokens);
  if (hint !== undefined) return hint;
  if (corpus.assistant.some((text) => contains(corpus, text, valueTokens) === 'found')) {
    return failedWith(corpus, value, 'only-in-model-answer');
  }
  return failedWith(corpus, value, 'not-in-earlier-turns');
}

/** The value in an earlier turn's person words or results, or the app's text — a hint. */
function earlierHint(
  corpus: SourceCorpus,
  value: string | number | boolean,
  needle: readonly string[],
): Judged | undefined {
  const person = corpus.person.some(
    (p) =>
      p.earlier === true && p.composed !== true && contains(corpus, p.text, needle) === 'found',
  );
  if (person) return { source: 'model', earlier: true, coincides: 'person' };
  const result = corpus.results.some(
    (r) => r.earlier === true && hasText(r) && carries(corpus, r, value) === 'found',
  );
  if (result) return { source: 'model', earlier: true, coincides: 'result' };
  if (corpus.app.some((a) => contains(corpus, a.text, needle) === 'found')) {
    return { source: 'model', coincides: 'app' };
  }
  return undefined;
}

// ─── V5 · `app` ─────────────────────────────────────────────────────────

function checkApp(value: string | number | boolean, corpus: SourceCorpus): Judged {
  const needle = canonicalTokens(String(value));
  if (needle.length === 0) return failedWith(corpus, value, 'uncheckable');
  let unreadable = false;
  // A labelled ground first, so the row can name the source the app vouched for.
  const ordered = [
    ...corpus.app.filter((a) => a.label !== undefined),
    ...corpus.app.filter((a) => a.label === undefined),
  ];
  for (const piece of ordered) {
    const found = contains(corpus, piece.text, needle);
    if (found === 'found') {
      return { source: 'app', ...(piece.label !== undefined && { appSource: piece.label }) };
    }
    if (found === 'uncheckable') unreadable = true;
  }
  return failedWith(corpus, value, unreadable ? 'uncheckable' : 'not-in-app-text');
}

// ─── The check ──────────────────────────────────────────────────────────

/** V2–V6: the claim, checked against its one corpus. */
function judgeClaim(subject: SourceSubject, corpus: SourceCorpus): Judged {
  const { value, claim } = subject;
  if (!isPrimitive(value)) {
    // Nested and non-primitive values are not ruled in this version.
    return claim === undefined ? { source: 'model' } : { source: 'model', failed: 'uncheckable' };
  }
  switch (claim?.source) {
    case 'user':
      return checkQuote(subject, claim.quote ?? '', value, corpus);
    case 'result':
      return checkResult(subject, claim.id ?? '', value, corpus);
    case 'turn':
      return checkTurn(subject, value, corpus);
    case 'app':
      return checkApp(value, corpus);
    default: {
      // V6 — `assumed`, or nothing declared: the model's own value. The lookup is a hint.
      const coincides = hintOf(corpus, value);
      return { source: 'model', ...(coincides !== undefined && { coincides }) };
    }
  }
}

// FOLD · the one owner of the declared-sources verdict on one argument value
// consumers read this and never re-derive it: arguments/resolve.ts · verifyPlan (the layer's VERIFY
// stage), whose rows and resolutions carry it; the standing fold reads the rows, never re-checks.
// detached: yes — a verdict of enums, flags, one id and one label; the value is never kept.
/**
 * Where one argument value came from, as the record can check it — the
 * model's claim (`subject.claim`) checked against the one corpus that source
 * lives in, then the declared default applied last (V1). The value is read in
 * memory and never kept: the verdict holds enums, flags, a result id and an
 * app label only.
 *
 * @example
 * ```ts
 * checkSource(
 *   { toolName: 'search_logs', argument: 'window', value: '7d',
 *     claim: { argument: 'window', source: 'user', quote: 'over the last week' },
 *     rule: windowRule },            // choices: [{ value: '7d', said: ['last week'] }, …]
 *   corpus,                           // person: [{ text: 'errors on checkout over the last week?' }]
 * );
 * // { source: 'said', claimed: 'user', matched: 'phrase' }
 * ```
 */
export function checkSource(subject: SourceSubject, corpus: SourceCorpus): SourceCheck {
  const claimed: ArgumentClaim = subject.claim?.source ?? 'none';
  const judged = judgeClaim(subject, corpus);
  const assume = subject.rule?.assume;
  if (assume !== undefined && !isPersons(judged) && sameArgumentValue(subject.value, assume)) {
    // V1: a default nobody chose stays a default, whatever the model claimed for it.
    return {
      source: 'default',
      claimed,
      ...(judged.failed !== undefined && { failed: judged.failed }),
    };
  }
  return { ...judged, claimed };
}
