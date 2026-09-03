/**
 * frames — which `role: 'user'` turns the LIBRARY wrote rather than a person.
 *
 * Pattern: one predicate, two consumers (the message builder and the exempt
 *          corpus), so the two cannot disagree about what a correction is.
 * Role:    core/ layer. Tiny on purpose — it exists to break a real bug, not
 *          to hold a constant.
 * Emits:   N/A.
 *
 * ## The bug this file exists to prevent
 *
 * Values the USER supplied are exempt from the evidence check: the user gave
 * them, so the model did not invent them. The corrections this library writes
 * are also `role: 'user'` turns — and the evidence correction's whole job is to
 * QUOTE the unsupported values back to the model. Index it as user-supplied
 * and the gate exempts exactly the values it just flagged: the second check
 * comes back clean, `guard` congratulates a repeated fabrication, and `rails`
 * never refuses anything. Measured, not imagined — the first end-to-end run of
 * the `rails` posture did precisely that.
 *
 * So a library-authored turn is recognised by its authored frame and excluded
 * from the exempt corpus. The frames are stable exported constants for this
 * reason as much as for the tests that match on them.
 */

import {
  EVIDENCE_CHECK_FRAME_PREFIX,
  SCHEMA_CHECK_FRAME_PREFIX,
} from '../../../lib/saidByPerson.js';

// Both markers live in the authorship registry (9.84.0) — the one list of
// openings this library puts on a user-role message it wrote. The sentences
// that carry them are still `gate.ts`'s and `outputEnforcement.ts`'s.
export { EVIDENCE_CHECK_FRAME_PREFIX } from '../../../lib/saidByPerson.js';

/**
 * True when this message content is a CORRECTION the library wrote.
 *
 * Both in-loop corrections are listed: the schema re-ask quotes a validator's
 * message about the model's own output, and the evidence recheck quotes the
 * model's own values. Neither is a person supplying data, and treating either
 * as one would exempt the very text it was written to challenge.
 *
 * DELIBERATELY NARROWER than `isSaidByPerson` (9.84.0), which excludes all
 * four authored frames. This one is the exempt corpus's rule, and the exempt
 * corpus is about who SUPPLIED a value, not who typed the message: widening it
 * to the drop notice and the compaction frame would change which values the
 * evidence gate exempts, which is a decision about the gate and not about
 * authorship. Read `LIBRARY_AUTHORED_PREFIXES` if you want the whole list.
 */
export function isLibraryAuthoredTurn(content: string): boolean {
  return (
    content.startsWith(EVIDENCE_CHECK_FRAME_PREFIX) || content.startsWith(SCHEMA_CHECK_FRAME_PREFIX)
  );
}
