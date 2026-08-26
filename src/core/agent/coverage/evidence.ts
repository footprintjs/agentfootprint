/**
 * evidence — what an absence is allowed to GROUND.
 *
 * Pattern: one projection, one consumer (`evidence/evidenceIndex.ts`). The
 *          `evidence/frames.ts` argument applied to the other side of the
 *          conversation: there, text the library wrote into a `role: 'user'`
 *          turn must not become user-supplied evidence; here, text the MODEL
 *          supplied that a tool echoed back must not become tool evidence.
 * Role:    core/ layer, pure.
 * Emits:   N/A.
 *
 * ## The bug this file exists to prevent
 *
 * The evidence gate's corpus is every `role: 'tool'` result: a value the
 * model read from a tool is grounded. An absence is a tool result — and its
 * whole job is to say what was looked for, which in practice means quoting
 * the arguments the model passed ("no FLOGI entries on fc1/3", where `fc1/3`
 * came from the model, not from the fabric).
 *
 * Index that whole frame and an invented identifier becomes grounded by the
 * one route that proves nothing about it: handing it to a tool that found
 * nothing. The model could then assert "fc1/3 has no FLOGI entries" about a
 * port it invented, and the gate would agree, because it saw the string in a
 * tool result. **A failed lookup is the cheapest possible laundering
 * machine**, and adding a primitive whose purpose is to make failed lookups
 * informative would have made it cheaper still.
 *
 * ## The line, and where it actually falls
 *
 * The first cut of this file drew the line at the coverage lists. That was too
 * narrow, and the field said so: a share-lookup tool returned its absence with
 * the answer attached — an extra `known_shares` key holding the 40 real share
 * names on the filer — and a `try_instead` telling the model to pick one. The
 * model did exactly that, and the gate called the share it picked ungrounded.
 * Following the tool's own advice produced a flagged answer, which makes the
 * advice worthless and the gate wrong.
 *
 * So the line is not "coverage vs everything else". It is **tool-authored
 * knowledge vs caller echo**:
 *
 *   • Everything a recognized absence carries is the TOOL speaking about the
 *     world — the coverage lists, an extra key like `known_shares`, the
 *     author's `try_instead`, the library's own note. Tool knowledge is
 *     precisely what the corpus is for, so all of it grounds.
 *   • `looked_for` is the one field that quotes the REQUEST rather than
 *     stating what the tool knows. It never grounds. See
 *     {@link CALLER_ECHO_FIELD}.
 *
 * This widens leniency — the gate accuses less — which is the safe direction
 * on an accusation boundary: a missed fabrication costs a value nobody
 * checked, a false accusation costs a correct answer and a real turn.
 *
 * The consequence of the exclusion is deliberate and worth stating: if the
 * USER named the thing, it is exempt anyway (their message is the exempt
 * corpus), so a real question about a real port is unaffected. Only a value
 * that appears *for the first time* in an absence's `looked_for` loses its
 * grounding — which is the only case where it was never evidence to begin
 * with.
 *
 * ## What this does NOT close, said plainly
 *
 * The rule rests on "everything but `looked_for` is the tool's own words about
 * the world". An author who interpolates an unvalidated argument into any
 * other field — a `checked` line built by string-interpolating the `switch`
 * argument the model passed, an extra key echoing the request back — puts a
 * model-supplied token into the corpus by hand. That is narrower than the hole
 * this file closes (the author chose to echo, rather than the primitive
 * echoing by design), and it is not detectable from here: this library cannot
 * tell which characters of a sentence a tool composed and which it copied. The
 * guidance is on the door itself — interpolate identifiers you RESOLVED, not
 * identifiers you were handed. It is also the general limit of the evidence
 * corpus, not a new one: any tool that echoes its arguments into its result
 * has always grounded them.
 */

import { readAbsence } from './absent.js';
import { readCoverageLedger } from './ledger.js';
import type { ToolAbsence } from './types.js';

/**
 * The ONE field of an absence that is withheld from the evidence corpus.
 *
 * Tool-authored knowledge grounds; caller echoes never do. Every other field —
 * the coverage lists, the note, `try_instead`, and any extra key the tool
 * attached — is the tool stating what it knows about the world, and that is
 * what an answer built on an absence is entitled to cite. `looked_for` states
 * what was ASKED FOR, and in practice quotes the arguments the model passed,
 * so indexing it would ground every identifier a model invented as long as it
 * handed the invention to one tool that found nothing.
 *
 * The distinction is about the SOURCE of the words, not their position in the
 * shape: a tool author who interpolates an unvalidated argument into any other
 * field re-opens the same hole by hand — see "What this does NOT close" above.
 */
const CALLER_ECHO_FIELD = 'looked_for';

/** One absence, minus the caller's echo. */
function toolAuthoredOnly(absence: ToolAbsence): unknown {
  // Entries, not fields: a tool may spread `absent(…)` and attach keys the
  // `ToolAbsence` type never named, and those are the point of this widening.
  const entries: ReadonlyArray<readonly [string, unknown]> = Object.entries(absence);
  return Object.fromEntries(entries.filter(([key]) => key !== CALLER_ECHO_FIELD));
}

/**
 * Project a parsed tool result down to what it may ground, or `undefined`
 * when it carries no absence frame — the ordinary case, which the caller
 * indexes exactly as it always did.
 *
 * Two shapes carry one: a bare absence, and an absence bounded by a coverage
 * ledger (`coverage(absent(…), …)`). A ledger's own lists are all tool prose,
 * so they are indexed whole; the absence inside it loses the same one field a
 * bare absence loses, and nothing else. An absence buried deeper than that —
 * inside a tool's own domain object — is NOT found, and is left indexed as
 * ordinary data: this projection recognizes the shapes this library mints, and
 * does not go hunting through values it did not write.
 *
 * What comes back is a value to WALK, not a set of strings: the caller's
 * indexer does the leaf and key work, so an extra key holding a nested object
 * or an array of names is projected without this file knowing its shape.
 */
export function absenceEvidenceProjection(parsed: unknown): unknown | undefined {
  const absence = readAbsence(parsed);
  if (absence !== undefined) return toolAuthoredOnly(absence);
  const covered = readCoverageLedger(parsed);
  if (covered === undefined) return undefined;
  const inner = readAbsence(covered.result);
  if (inner === undefined) return undefined;
  return [covered.af_coverage, toolAuthoredOnly(inner)];
}
