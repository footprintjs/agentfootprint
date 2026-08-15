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
 * So an absence grounds its COVERAGE and nothing else. `checked`,
 * `not_checked` and `cannot_cover` are the tool's own words about the world —
 * a fabric name, a collector, a window — and they are exactly what an answer
 * built on an absence should be allowed to cite. `looked_for`, `try_instead`,
 * the note and the marker are not.
 *
 * The consequence is deliberate and worth stating: if the USER named the
 * thing, it is exempt anyway (their message is the exempt corpus), so a real
 * question about a real port is unaffected. Only a value that appears *for
 * the first time* in an absence loses its grounding — which is the only case
 * where it was never evidence to begin with.
 *
 * ## What this does NOT close, said plainly
 *
 * The whitelist rests on "coverage is the tool's own words about the world".
 * An author who interpolates an unvalidated argument into a coverage entry —
 * a `checked` line built by string-interpolating the `switch` argument the
 * model passed — puts a model-supplied token back into the corpus through the
 * one list this file admits. That is narrower than the hole it closes (the
 * author chose to echo, rather than the primitive echoing by design), and it
 * is not detectable from here: this library cannot tell which characters of a
 * sentence a tool composed and which it copied. The guidance is on the door
 * itself — interpolate identifiers you RESOLVED, not identifiers you were
 * handed. It is also the general limit of the evidence corpus, not a new one:
 * any tool that echoes its arguments into its result has always grounded
 * them.
 */

import { readAbsence } from './absent.js';
import { readCoverageLedger } from './ledger.js';
import type { CoverageItem, ToolAbsence } from './types.js';

/** The coverage lists of one absence, as the only thing it grounds. */
function coverageOnly(absence: ToolAbsence): ReadonlyArray<readonly CoverageItem[]> {
  return [absence.checked ?? [], absence.not_checked ?? [], absence.cannot_cover ?? []];
}

/**
 * Project a parsed tool result down to what it may ground, or `undefined`
 * when it carries no absence frame — the ordinary case, which the caller
 * indexes exactly as it always did.
 *
 * Two shapes carry one: a bare absence, and an absence bounded by a coverage
 * ledger (`coverage(absent(…), …)`). A ledger's own lists are all tool
 * prose, so they are indexed whole; only the absence inside it is narrowed.
 * An absence buried deeper than that — inside a tool's own domain object —
 * is NOT found, and is left indexed as ordinary data: this projection
 * recognizes the shapes this library mints, and does not go hunting through
 * values it did not write.
 */
export function absenceEvidenceProjection(parsed: unknown): unknown | undefined {
  const absence = readAbsence(parsed);
  if (absence !== undefined) return coverageOnly(absence);
  const covered = readCoverageLedger(parsed);
  if (covered === undefined) return undefined;
  const inner = readAbsence(covered.result);
  if (inner === undefined) return undefined;
  return [covered.af_coverage, ...coverageOnly(inner)];
}
