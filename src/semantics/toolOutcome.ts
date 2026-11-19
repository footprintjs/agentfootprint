/**
 * toolOutcome — the normalized tool-outcome vocabulary, as a PURE leaf
 * (9.34.0).
 *
 * WHY IT LIVES HERE. A skill-graph route edge can key on what a tool
 * DECLARED happened (`onToolStatus`), so this vocabulary is part of the
 * graph's own reading of a turn — `InjectionContext.toolResults[].status`
 * is typed by it. It used to be declared inside `core/agent/toolEffects.ts`
 * (today `semantics/toolEffects.ts`),
 * which meant the graph's context type reached into the agent loop's
 * tool-effects module for one string union: the loop's vocabulary embedded
 * in the graph's contract, pointing the dependency the wrong way.
 *
 * So the words moved DOWN here — a module with zero imports that both
 * sides read. `semantics/toolEffects.ts` re-exports them under the same
 * names, so every existing import path is unchanged; that module remains
 * the owner of the ENVELOPE grammar (the two effect kinds, the recognizer).
 *
 * Zone: a zero-import leaf the skill-graph PURE CORE may reach (`PURE_LEAVES`).
 * Pinned by `test/injection-engine/skill-graph-fence.test.ts`.
 */

/**
 * Normalized outcome of one tool call, declared by the tool itself. Seven
 * values, deliberately closed: routing keyed on meaning needs a vocabulary
 * both sides spell identically. A word a tool wrote is read by this
 * module's `readToolResultStatus`: another case or surrounding spaces still
 * name the same word, and a string that names none of the seven makes the
 * value NOT an envelope (data path, unchanged).
 *
 * `'absent'` is the seventh (the `absent()` primitive, from field use), and
 * it earns its own word rather than folding into `'success'` or `'failure'`
 * for the reason the primitive exists: *nothing found* and *could not look*
 * must not route down the same edge. Under `'failure'` an honest empty answer
 * sends an operator to investigate a healthy collector; under `'success'` a
 * route that wants to escalate on "we found nothing" has nothing to key on.
 * A tool may declare it directly (`{ content, effects: [], status:
 * 'absent' }`); returning `absent(…)` makes the framework declare it.
 */
export type ToolResultStatus =
  | 'success'
  | 'failure'
  | 'denied'
  | 'invalid'
  | 'partial'
  | 'pending'
  | 'absent';

/** The closed set, as data — validators and docs read one list. */
export const TOOL_RESULT_STATUSES: readonly ToolResultStatus[] = [
  'success',
  'failure',
  'denied',
  'invalid',
  'partial',
  'pending',
  'absent',
];

/**
 * THE ONE READING of a status word a tool wrote: one of the seven, or
 * `undefined`. A second spelling of a known word — another case, or spaces
 * around it — is that word: `'FAILURE'`, `' Denied '` and `'failure'` all
 * read as `'failure'`. Anything else (not a string, or no known word once
 * trimmed and lower-cased) is `undefined`.
 *
 * Why: the envelope recognizer used to compare the word exactly, so a tool
 * that wrote `status: 'FAILURE'` had its whole result treated as data, and a
 * procedure step it ran advanced as if its tool had reported nothing. A
 * tool written in another language or by hand, or a status read from an
 * upstream API, spells the same meaning in more than one case; reading the
 * word once, here, means the envelope, a step and a route edge cannot
 * disagree about which word a tool meant. Read by
 * `semantics/toolEffects.ts` (the recognizer and its near-miss diagnosis).
 *
 * @example readToolResultStatus(' Failure ') // 'failure'
 * @example readToolResultStatus('oops')      // undefined
 */
export function readToolResultStatus(value: unknown): ToolResultStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase();
  return (TOOL_RESULT_STATUSES as readonly string[]).includes(word)
    ? (word as ToolResultStatus)
    : undefined;
}

/** What every door knows about a call when it commits the call's message. */
export interface DispatchSettlement {
  /** `execute` was entered and no gate refused the call. */
  readonly ran: boolean;
  /** It ran without throwing and its result was not withheld. */
  readonly clean: boolean;
  /** The tool's DECLARED status (an effects envelope), when it gave one. */
  readonly status?: ToolResultStatus;
  /**
   * The word a tool wrote as `status` in a value that is an envelope but for
   * that word, which names none of the library's seven
   * (`semantics/toolEffects.ts` · `unknownStatusOf`, cleaned). The call
   * declared no status; only the procedure step reads this, to name the word
   * instead of saying the tool declared nothing. `callOutcomeOf` ignores it.
   */
  readonly unknownStatus?: string;
}

/**
 * THE ONE RULE for `LLMMessage.outcome`: how a tool call settled, read from
 * what the dispatch already knows — never from the result's words.
 *
 * Why: the check-in trail shows a person approving a call whether each earlier
 * call worked. It used to guess from the first words of the tool message, so a
 * tool that threw ("connection refused") read as ok and a tool that returned
 * "declined by human: …" read as refused. Those words are still the trail's
 * fallback for an unmarked tool message (for example, a completed result or
 * a tool message written before the mark: `core/trailBeforeOutcomeMarker.ts`),
 * so that second tool still reads not ok, on the careful side; a marked call
 * is never judged by them. The dispatch doors that commit a call's result
 * (the batch loop, `deliveredResult.ts`, and the check-in, ask and credential
 * resumes) ask this function, so one call cannot be judged two
 * ways by which of them it came through. Doors that commit a tool message
 * without asking it: a plain resume (`resume/plain.ts` — the person's answer
 * IS the result, so absent is right); a call a paused batch never dispatched
 * (`batch/settlementOperations.ts`, marked `notDispatched`, which the trail
 * skips); and the host's notices (`hosting/answeredPause.ts`,
 * `hosting/standingAgent/turn/run.ts`), which read as not completed when
 * they carry `toolResultOrigin` (always in `answeredPause.ts`; the standing
 * agent's cancel notice only when findings admission is on).
 *
 * It answers "did the call complete?", not "was `execute` entered?":
 * `'refused'` also covers a tool that ran and declared `'denied'`.
 *
 * - did not run (a gate, a person or a credential stopped it) → `'refused'`
 * - ran but threw, or its result was withheld (`clean: false`) → `'failed'`
 * - ran clean, and the tool DECLARED a status (an effects envelope):
 *   `'denied'` → `'refused'`; `'failure'` / `'invalid'` → `'failed'`
 * - otherwise → absent: the call completed. A plain `{ status: 'failed' }`
 *   result is the tool's own words; it is not parsed.
 *
 * @example callOutcomeOf({ ran: true, clean: false })                    // 'failed'
 * @example callOutcomeOf({ ran: true, clean: true, status: 'partial' }) // undefined
 */
export function callOutcomeOf(call: DispatchSettlement): 'refused' | 'failed' | undefined {
  if (!call.ran) return 'refused';
  if (!call.clean) return 'failed';
  if (call.status === 'denied') return 'refused';
  if (call.status === 'failure' || call.status === 'invalid') return 'failed';
  return undefined;
}

/** Read the recorded dispatch verdict without inferring one from the result. */
export function recordedCallOutcome(
  message: Readonly<Record<string, unknown>>,
): ReturnType<typeof callOutcomeOf> {
  const outcome = message.outcome;
  return outcome === 'refused' || outcome === 'failed' ? outcome : undefined;
}
