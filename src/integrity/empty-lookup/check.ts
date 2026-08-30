/**
 * empty-lookup — the run itself produced this identifier, and the lookup for
 * it found nothing. Filed at the WRITE seam, as an advisory, never an
 * accusation.
 *
 * Pattern: pure function over (one finished call, the results its declared
 *          producers served); the domain check, one seam later than
 *          `unsupported-argument`.
 * Role:    the decidable fragment of "did this tool answer, or did it only
 *          appear to answer?".
 *
 * THE MEASURED FAILURE. A triage agent's reverse-lookup tool filtered a
 * column before a pivot, so the column did not exist yet and EVERY reverse
 * lookup returned an empty result — for every identifier, always. The tool
 * then answered SUCCESSFULLY with an empty list, and the agent reported in a
 * table, with confidence, that the device was "not currently logged in to any
 * port on the collected switches" and advised checking physical cabling. It
 * was logged in the whole time. Nothing in the framework noticed, because an
 * empty result from a broken filter is byte-identical to an empty result from
 * a genuine absence.
 *
 * WHAT THE LIBRARY ALREADY KNOWS, and this check is nothing more than the
 * join of the two:
 *   (a) the identifier was GROUNDED — it came out of an earlier tool result
 *       in THIS run, from a tool the consumer's author named in
 *       `Tool.argumentsFrom`;
 *   (b) the lookup keyed on it came back EMPTY.
 * When the run produced the identifier and the lookup for it finds nothing,
 * that is worth filing. It is not worth accusing anyone of.
 *
 * THE CEILING, and it is the whole reason this is an advisory: an empty
 * answer can be perfectly true. The device may exist and simply have no
 * logins right now. NOTHING IN THIS FILE CAN TELL THOSE APART, and nothing in
 * this file pretends to — the finding says "here is a pair worth a look", the
 * record carries the ceiling sentence verbatim, and the same finding is filed
 * for the true absence and the broken filter alike. A check that guessed
 * which one it was looking at would be inventing the certainty the field
 * failure was made of.
 *
 * DECLARED, NEVER INFERRED — the `argumentsFrom` precedent, THIRD use. A tool
 * is this check's subject only because its author said its arguments come
 * from another tool's results. One declaration now arms three seams:
 * `dangling-reference` asks whether the ground is still in reach when the
 * tool is OFFERED, `unsupported-argument` whether the value the model chose
 * came from that ground when the tool was CALLED, and this whether the ground
 * the run really did serve then found anything when the tool ANSWERED.
 *
 * WHAT COUNTS AS EMPTY — and what this refuses to judge. See
 * {@link readLookupResult}. A rowset is counted, never interpreted; an
 * absence is read from the marker its own helper mints. Every other shape a
 * tool has ever returned — a sentence, an object, a `null`, a claim ticket —
 * is BESPOKE: the library cannot see whether it holds rows, so the encounter
 * is `not-applicable` and says so in the ledger. That row is the point. A
 * check that silently skipped what it could not read would be the decoration
 * the disposition family exists to make impossible.
 *
 * Detection only. Nothing here blocks, retries, rewrites or delays anything;
 * the result the model reads is the result the tool returned.
 */

import { MIN_CHECKED_LENGTH, clipValue, stringLeaves } from '../argumentLeaves.js';
import type { Assertion, SubjectRef } from '../assertion/types.js';
import type { Disposition } from '../disposition/types.js';
import type { ContextError } from '../finding/types.js';

/**
 * THE CEILING, as one string with one owner.
 *
 * Quoted verbatim into every finding's message, into the check's README and
 * into its docs page, so the bound cannot drift out of one of them and leave
 * a reader thinking the library knows more than it does.
 */
export const EMPTY_LOOKUP_CEILING =
  'An empty result can be perfectly true — the thing may exist and simply have nothing to show ' +
  'right now — so this is a place to look, never a verdict that anything is wrong.';

/** What the library could read about a finished lookup's result. */
export interface LookupResultReading {
  /** `'rowset'` — an array, counted. `'absence'` — the `absent()` envelope. */
  readonly shape: 'rowset' | 'absence';
  readonly empty: boolean;
  /** Rows counted, for a rowset. Absent for an absence, which declares itself. */
  readonly rows?: number;
}

/**
 * READ a finished result's shape, or decline to.
 *
 * The two readable shapes, and why only these two:
 *
 *   • a **rowset** — an array. Its length is COUNTED, not interpreted: zero
 *     rows is zero rows, and no judgement about what the tool meant is
 *     involved. This is the shape the recorded failure actually returned.
 *   • an **absence** — the `absent()` envelope, whose author said in so many
 *     words "the search ran and matched nothing".
 *
 * Everything else returns `undefined`, which the caller files as
 * `not-applicable`. A prose sentence, a bespoke `{ rows: [...] }` wrapper, a
 * `null`, a placement claim ticket — the library cannot see rows in any of
 * them, and guessing is how a checker starts lying.
 *
 * @param value the tool's own answer, as it returned it.
 * @param declaredAbsence whether `readAbsence` recognized the value. PASSED
 *   IN rather than re-derived here on purpose: the `af_absent` marker has
 *   exactly one owner (`core/agent/coverage/absent.ts`), a second spelling of
 *   a reserved word would eventually disagree with the first, and
 *   `src/integrity/` stays a leaf that imports no agent code.
 */
export function readLookupResult(
  value: unknown,
  declaredAbsence: boolean,
): LookupResultReading | undefined {
  if (declaredAbsence) return { shape: 'absence', empty: true };
  if (Array.isArray(value))
    return { shape: 'rowset', empty: value.length === 0, rows: value.length };
  return undefined;
}

/** One finished call to a tool whose author declared where its arguments come from. */
export interface EmptyLookupCall {
  /** The CONSUMER — the tool that was called and answered. */
  readonly toolName: string;
  /** The provider's id for this call — what the witness points a reader at. */
  readonly toolCallId: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** `Tool.argumentsFrom` — the tools whose results were meant to ground these arguments. */
  readonly argumentsFrom: readonly string[];
  /** What the library could read about the result — `undefined` = bespoke shape. */
  readonly reading: LookupResultReading | undefined;
}

/** One earlier tool result this run served, with the tool that produced it. */
export interface ProducedResult {
  readonly toolName: string;
  /** The result exactly as the run served it into the conversation. */
  readonly text: string;
}

/** One encounter's outcome: the findings, and the disposition it earns. */
export interface EmptyLookupEncounter {
  readonly findings: readonly ContextError[];
  /**
   * The ledger row this encounter files — computed HERE, beside the rules
   * that decide it, so "the library refused to judge this shape" is provable
   * without a live agent.
   */
  readonly disposition: Disposition;
}

/**
 * Judge one finished call to an armed tool.
 *
 * @param call the call and what the library could read of its result. The
 *   caller has already established the tool declared `argumentsFrom`;
 *   nothing here re-decides who is a subject.
 * @param produced every tool result this run served BEFORE this call, with
 *   the tool that produced each. Filtered to the declared producers here.
 * @param epoch the run iteration, stamped on every witness.
 */
export function emptyLookupOf(
  call: EmptyLookupCall,
  produced: readonly ProducedResult[],
  epoch: number,
): EmptyLookupEncounter {
  // A shape the library cannot read is not a pass and not a fail. It is the
  // check looking at a subject that is out of its scope BY RULE, which is
  // exactly what `not-applicable` was minted for.
  if (call.reading === undefined) return { findings: [], disposition: 'not-applicable' };
  // The lookup found something. Nothing to say — and a `checked-pass` rather
  // than silence, because a check that only speaks when it fires cannot be
  // told apart from one that was never wired.
  if (!call.reading.empty) return { findings: [], disposition: 'checked-pass' };

  // Only the DECLARED producers ground anything here. The choice seam asks
  // the broader question (did ANYTHING the run served carry this value); this
  // one is narrower on purpose — `argumentsFrom` says where the value was
  // supposed to come from, and "it came from exactly there, and the lookup
  // still found nothing" is the pair worth a person's attention.
  const grounds = produced
    .filter((p) => call.argumentsFrom.includes(p.toolName) && p.text.length > 0)
    .map((p) => ({ toolName: p.toolName, lowered: p.text.toLowerCase() }));
  // The declared ground served nothing at all in this run, so there is no
  // corpus to join against and no identity edge between the two tools. Not a
  // pass — the check could not run. `unreachable` is the family's word for
  // exactly that, and it is the falsification instrument: an `empty-lookup`
  // row dominated by `unreachable` means apps are calling consumers before
  // their declared producers, and this check is watching a seam that is not
  // where their identifiers come from.
  if (grounds.length === 0) return { findings: [], disposition: 'unreachable' };

  const consumer: SubjectRef = { kind: 'tool', id: call.toolName };
  const emptyPhrase =
    call.reading.shape === 'absence'
      ? 'a declared absence — the tool said the search ran and matched nothing'
      : 'a rowset with zero rows';
  const findings: ContextError[] = [];

  for (const leaf of stringLeaves(call.args, '')) {
    const value = leaf.value.trim();
    // The same fences as the choice seam, for the same reasons and from the
    // same file: non-strings are never identifier-shaped, and below four
    // characters substring matching is noise in both directions.
    if (value.length < MIN_CHECKED_LENGTH) continue;
    const needle = value.toLowerCase();
    // Substring, case-insensitive — deliberately THE SAME rule the choice
    // seam grounds by. The two checks must agree about what "this value came
    // from that tool" means, or a value could fall between them and be seen
    // by neither.
    const ground = grounds.find((g) => g.lowered.includes(needle));
    if (ground === undefined) continue;

    const producer: SubjectRef = { kind: 'tool', id: ground.toolName };
    const witnesses: Assertion[] = [
      {
        subject: consumer,
        predicate: leaf.path,
        value: leaf.value,
        epoch,
        stratum: 'asserted',
        provenance: `tool call ${call.toolCallId}: argument '${leaf.path}' as the model chose it`,
      },
      {
        subject: producer,
        predicate: leaf.path,
        value: 'served this value earlier in this run',
        epoch,
        stratum: 'asserted',
        provenance:
          `'${ground.toolName}' is a declared ground of '${call.toolName}' ` +
          `(Tool.argumentsFrom) and one of its results in this run carries the value`,
      },
      {
        subject: consumer,
        predicate: leaf.path,
        value: `found nothing — ${emptyPhrase}`,
        epoch,
        stratum: 'asserted',
        provenance: `tool call ${call.toolCallId}: the result, as the tool returned it`,
      },
    ];

    findings.push({
      kind: 'empty-lookup',
      seam: 'write',
      subjects: [consumer, producer],
      // The dot-path IS the discriminator, exactly as at the choice seam: two
      // arguments of one call are two notices. The stated limit is the same
      // one — the SAME argument re-chosen with a different value stays one
      // finding, and the ledger's `findings` count is what says how often.
      predicate: leaf.path,
      witnesses,
      epoch,
      // Doubt, not contradiction. Counted apart from real defects everywhere
      // the family reports, because this check can never know it found one.
      advisory: true,
      message:
        `'${call.toolName}' was called with ${leaf.path} = "${clipValue(value)}" — a value ` +
        `this run itself produced, in a result from '${ground.toolName}', which ` +
        `'${call.toolName}' declares as where its arguments come from — and the lookup came ` +
        `back with ${emptyPhrase}. That pairing is what makes it worth a look: the run had ` +
        `the identifier, so an empty answer is either a true absence or a lookup that could ` +
        `never have matched, and those two are byte-identical from here. ` +
        `${EMPTY_LOOKUP_CEILING} Call id ${call.toolCallId}. Nothing here blocked the call, ` +
        `changed the result, or retried anything.`,
    });
  }

  return { findings, disposition: findings.length > 0 ? 'checked-fail' : 'checked-pass' };
}
