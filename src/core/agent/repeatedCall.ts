/**
 * core/agent/repeatedCall — tell a model when it has already asked this.
 *
 * ── The measured failure ────────────────────────────────────────────────────
 * A traced production run: the model called one tool three times in a row with
 * byte-identical arguments and got a byte-identical result each time. The tool
 * was doing its job — the arguments named a filter the backend did not honour,
 * so the same rows came back — and the model read the same rows as a fresh
 * answer each iteration, concluded nothing had changed, and tried again. Three
 * calls, three identical results, one wasted turn, and nothing anywhere in the
 * loop that could say "you have done this".
 *
 * That class of loop is invisible from inside the conversation, because the
 * history genuinely does show three separate calls that each returned data. The
 * only party with the whole picture is the framework, which watched all three
 * land.
 *
 * ── The intervention: a NOTE, never a refusal ───────────────────────────────
 * On the Nth identical (tool, args) → identical result, the framework appends
 * one sentence to that result. It does not block the call, does not change the
 * result, does not error, and does not stop a later identical call from
 * running. That restraint is the design:
 *
 *   • **A repeat is sometimes correct.** Polling a job until its status
 *     changes is a loop of identical calls returning identical results, on
 *     purpose. Refusing it would break a legitimate pattern to fix an
 *     illegitimate one, and the model is the only party that knows which it is
 *     doing.
 *   • **A note is evidence; a refusal is a wall.** The model reads what
 *     happened and decides. That is the same posture every teaching refusal in
 *     this library takes, minus the refusal.
 *
 * ── Why the result must match too ───────────────────────────────────────────
 * Identical ARGUMENTS alone are not evidence of anything: a "check status" call
 * with the same arguments returning a DIFFERENT status is progress. It is the
 * identical RESULT that makes the repeat pointless, so both halves are
 * required. Which also means the note can say something true and specific —
 * *calling again will not change it* — rather than a vague "you seem to be
 * repeating yourself".
 *
 * ── What is stored, and what is deliberately not ────────────────────────────
 * A short non-cryptographic FINGERPRINT of the arguments and the result, never
 * the values. Tool arguments routinely carry the things redaction exists for,
 * and a fingerprint answers the only question this feature asks ("is this the
 * same?") and answers nothing else.
 *
 * ── And WHERE it is stored: beside the run, never inside its state ──────────
 * The counters live in {@link repeatedCallLedgers}, a run-keyed map the
 * dispatch loop holds — NOT on tracked scope. That is not a tidiness
 * preference, it is the zero-cost law:
 *
 *   • Tracked scope IS the commit log, the snapshot, the narrative, every
 *     recording and every causal slice. A key written there on every tool
 *     landing would appear in all of them for every existing agent the moment
 *     it upgraded — a turn that never repeated anything would no longer be
 *     byte-identical to the release before, and a consumer asserting a state-key
 *     set would break for a feature it never asked for.
 *   • A within-turn counter is not conversation state. Nothing resumes from it,
 *     nothing branches on it later, and no reader of a trace needs it: the
 *     repeat itself lands on the record as `agentfootprint.tools.repeated_call`,
 *     which is the telemetry channel this library puts per-attempt facts on
 *     (the same reasoning as retries and streaming tokens, and the same
 *     reasoning that keeps a consent record off tracked state).
 *
 * So an agent that never repeats a call is byte-identical to 9.25 in behaviour,
 * in state AND in events — the ledger exists only in memory, only for the
 * duration of a run, and only where a tool actually landed.
 */

/** How many identical (tool, args, result) landings trigger the note. The
 *  SECOND one: the first repeat is the first moment the fact exists. */
export const REPEATED_CALL_THRESHOLD = 2;

/**
 * The ledger: fingerprint → how many times this exact (tool, args, result) has
 * landed in this run.
 *
 * A plain record of small strings to numbers — a few dozen bytes per distinct
 * call, and nothing in it that could not be printed in a bug report.
 */
export type RepeatedCallLedger = Readonly<Record<string, number>>;

/**
 * Where the ledgers live: one per RUN, held beside the dispatch loop.
 *
 * ── Why the run and not the conversation ────────────────────────────────────
 * The failure this counts is a model calling the same thing twice inside ONE
 * answer. A counter that spanned turns would tell somebody who asked the same
 * question again tomorrow that they had already asked — which is true, and not
 * what the note says. `runId` is the exact grain, and it is already the key
 * every event on this run is stamped with.
 *
 * A resume mints a fresh `runId`, so a run that was paused for a person and
 * continued starts counting again. That is the honest reading of "this turn":
 * the framework watched half of it.
 *
 * ── Why BOUNDED ─────────────────────────────────────────────────────────────
 * One agent instance serves many runs, and nothing tells this map when a run
 * ended — a run can also end by throwing, by pausing forever, or by the process
 * losing interest. So it keeps the most recent few and drops the rest. The cost
 * of dropping one is exactly one note that is never given; it can never produce
 * a note for the wrong run, because a run only ever reads counters filed under
 * its own id.
 */
export interface RepeatedCallLedgers {
  /** This run's counters, or `undefined` before its first tool landed. */
  read(runId: string): RepeatedCallLedger | undefined;
  /** File this run's counters, evicting the least recently written run when
   *  the map is full. */
  write(runId: string, ledger: RepeatedCallLedger): void;
}

/** How many runs' counters one dispatch loop keeps at once. Small on purpose:
 *  concurrent runs on ONE agent instance are the only reason for more than
 *  one, and a deployment serving many callers at once gives each its own
 *  agent (that is what `agentFactory` is for). */
const LEDGER_RUNS = 8;

/** Build the run-keyed holder. One per agent — the chart is built once, so the
 *  loop that owns this is built once too. */
export function repeatedCallLedgers(maxRuns: number = LEDGER_RUNS): RepeatedCallLedgers {
  const byRun = new Map<string, RepeatedCallLedger>();
  return {
    read: (runId) => byRun.get(runId),
    write: (runId, ledger) => {
      // Delete-then-set makes insertion order recency order, which is what the
      // eviction below reads.
      byRun.delete(runId);
      byRun.set(runId, ledger);
      while (byRun.size > maxRuns) {
        const oldest = byRun.keys().next();
        if (oldest.done === true) break;
        byRun.delete(oldest.value);
      }
    },
  };
}

/**
 * A stable, order-insensitive fingerprint of one call.
 *
 * Object keys are SORTED before hashing, at every depth: `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` are the same call, and a model that happens to emit its JSON
 * in a different key order twice is repeating itself just as surely. Arrays
 * keep their order, because `[1, 2]` and `[2, 1]` are not the same argument.
 */
function stableString(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableString(v)}`).join(',')}}`;
}

/**
 * FNV-1a, 32-bit, as 8 hex characters.
 *
 * Non-cryptographic ON PURPOSE and stated as such: this compares a string to
 * ITSELF a few iterations later inside one run, where an adversary has nothing
 * to gain from a collision and the cost of `crypto.subtle` (async, and one
 * digest per tool result) buys nothing. A collision produces one unnecessary
 * teaching note, which is the cheapest possible failure this could have.
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The two fingerprints for one landing, and the ledger key that joins them.
 *
 * Kept apart on the way out so a debugger reading the event can tell "same
 * call, different answer" from "same call, same answer" — without either value
 * being present anywhere.
 */
export function repeatedCallKey(
  toolName: string,
  args: unknown,
  result: string,
): { readonly key: string; readonly argsFingerprint: string; readonly resultFingerprint: string } {
  const argsFingerprint = fingerprint(stableString(args));
  const resultFingerprint = fingerprint(result);
  return {
    key: `${toolName}:${argsFingerprint}:${resultFingerprint}`,
    argsFingerprint,
    resultFingerprint,
  };
}

/** What one landing came to. `occurrences` counts THIS one. */
export interface RepeatedCallOutcome {
  /** The ledger to write back to scope. */
  readonly ledger: RepeatedCallLedger;
  /** How many times this exact call+result has now landed this run. */
  readonly occurrences: number;
  /** The sentence to append, or `undefined` when this landing is not a
   *  repeat (or the note has already been given for it). */
  readonly note?: string;
  /** Digest of the arguments — never the arguments. Rides the typed event. */
  readonly argsFingerprint: string;
  /** Digest of the result — never the result. */
  readonly resultFingerprint: string;
}

/**
 * The teaching sentence.
 *
 * It says three things, in the order the model needs them: what happened (the
 * fact it cannot see), what follows from it (calling again is not going to
 * help), and what to do instead (two named options, neither of which is "stop"
 * — a model told only to stop tends to stop answering).
 */
function noteFor(toolName: string, occurrences: number): string {
  return (
    `\n\n[identical call: '${toolName}' has now returned exactly this result ${occurrences} ` +
    `times this turn, for exactly these arguments. Calling it again will not change it — ` +
    `act on what you have, or change the arguments (a different filter, a wider range, a ` +
    `different tool). If you are waiting for something to change, say so in your answer ` +
    `rather than calling again.]`
  );
}

/**
 * Record one landing and decide whether it earns the note.
 *
 * PURE — takes the ledger, returns the next one. The dispatch loop owns reading
 * and writing scope, so this file never imports the agent and can be tested as
 * a table.
 *
 * The note fires ONCE per distinct call, on the Nth landing exactly. A third
 * and fourth identical call add nothing further: the model has been told, and
 * repeating the lesson every iteration would be the framework doing the very
 * thing it is complaining about.
 */
export function noteRepeatedCall(
  ledger: RepeatedCallLedger | undefined,
  toolName: string,
  args: unknown,
  result: string,
): RepeatedCallOutcome {
  const { key, argsFingerprint, resultFingerprint } = repeatedCallKey(toolName, args, result);
  const occurrences = (ledger?.[key] ?? 0) + 1;
  const next: RepeatedCallLedger = { ...(ledger ?? {}), [key]: occurrences };
  const outcome = { ledger: next, occurrences, argsFingerprint, resultFingerprint };
  if (occurrences !== REPEATED_CALL_THRESHOLD) return outcome;
  return { ...outcome, note: noteFor(toolName, occurrences) };
}
