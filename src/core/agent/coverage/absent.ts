/**
 * absent — an absence that names its own coverage.
 *
 * Pattern: minted by a helper, RECOGNIZED by the framework (the tool-effects
 *          envelope precedent). A return shape the framework does not
 *          understand is a convention, and a convention cannot set a status,
 *          keep a value out of the evidence corpus, or stop a retry loop.
 * Role:    core/ layer, pure. The dispatch loop calls `readAbsence` at the
 *          execute boundary; `absent()` is what a tool author writes.
 * Emits:   N/A (the caller emits `agentfootprint.tools.absent`).
 *
 * ## The direction-of-error argument — the whole point of this file
 *
 * A tool that finds nothing returns *something*: an empty array, a `null`, a
 * sentence. From any of those a model cannot tell **"I looked and there is
 * nothing"** from **"I could not look"**. That confusion is not symmetric,
 * and the asymmetry is what makes it worth a primitive:
 *
 *   • a *nothing-found* misread as an *outage* sends someone to investigate a
 *     collector that is working perfectly — expensive, and self-correcting.
 *   • an *outage* misread as *nothing-found* declares a system healthy that
 *     was never checked — cheap, silent, and wrong in the direction that
 *     hurts.
 *
 * So the two must not share a shape. An error is a `role: 'tool'` result with
 * `error: true`, a message, and no coverage. An absence is this: a result
 * that RAN, carries the ground it covered, and says out loud that asking
 * again changes nothing.
 *
 * ## Why the note is never interpolated
 *
 * Everything in the rendered absence except the coverage lists is either
 * static library text or the author's prose about the request — and the
 * author's prose about the request usually quotes the model's own arguments
 * ("no FLOGI entries on fc1/3", where `fc1/3` came from the model). Tool
 * results are the evidence gate's corpus, so an absence that echoed arguments
 * into that corpus would GROUND every identifier a model invented, as long as
 * it handed it to one tool that found nothing. That is laundering an
 * invention through a failed lookup — the same bug `evidence/frames.ts`
 * exists to stop on the other side of the conversation. The gate therefore
 * indexes an absence's COVERAGE only (see `evidenceIndex.ts`), and the note
 * is kept free of interpolation so the whitelist has nothing to leak around.
 */

import { normalizeCoverageList } from './items.js';
import type { AbsenceDeclaration, Coverage, ToolAbsence } from './types.js';

/**
 * The reserved key that makes an absence recognizable. Exported because tests,
 * docs and any consumer inspecting a raw tool result match on it — and
 * because a reserved word on the wire has to be nameable.
 */
export const ABSENCE_MARKER = 'af_absent';

/**
 * The static sentence every absence carries. Says the three things the field
 * implementation proved a model needs: that the call SUCCEEDED, that nothing
 * was substituted, and that a retry is futile. The third clause is the one
 * that ends the loop.
 */
export const ABSENCE_NOTE =
  'The search ran and matched nothing. This is an ANSWER, not an error: nothing failed, ' +
  'nothing was substituted for what was asked, and calling this tool again with the same ' +
  'arguments returns this same result. `checked` is the ground this answer covers; anything ' +
  'under `not_checked` or `cannot_cover` is ground it does NOT cover, and reaching that ' +
  'needs a different question, not a retry.';

/**
 * Say "I looked, and there is nothing" in a way a model cannot read as a
 * failure — and cannot productively retry.
 *
 * Returns the value a tool's `execute` should return. The framework
 * recognizes it at the dispatch boundary and gives it a delivered status of
 * `'absent'` (routable by `onToolStatus`), a `tools.absent` event, and an
 * evidence-corpus rule of its own.
 *
 * @example a port-lookup tool that found no matching FLOGI
 *   defineTool({
 *     name: 'flogi_for_port',
 *     description: 'FLOGI entries for one interface',
 *     inputSchema: { type: 'object', properties: { switch: { type: 'string' },
 *       port: { type: 'string' } }, required: ['switch', 'port'] },
 *     execute: ({ switch: sw, port }) => {
 *       const rows = fcns.flogi(sw, port);
 *       if (rows.length > 0) return rows;
 *       return absent({
 *         what: `FLOGI entries on ${port}`,
 *         checked: [
 *           `${sw}: the live fcns database`,
 *           { what: 'window: the last 24h', why: 'FLOGI history retention on this fabric' },
 *         ],
 *         notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
 *         cannotCover: [{ what: 'ports on the peer fabric',
 *           why: 'this collector is scoped to one fabric' }],
 *         tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
 *       });
 *     },
 *   });
 */
export function absent(decl: AbsenceDeclaration): ToolAbsence {
  const fn = 'absent';
  if (typeof decl !== 'object' || decl === null) {
    throw new Error(
      `${fn}: takes a declaration — { what, checked, notChecked?, cannotCover?, tryInstead? }.`,
    );
  }
  const what = typeof decl.what === 'string' ? decl.what.trim() : '';
  if (what === '') {
    throw new Error(
      `${fn}: \`what\` must say what was looked for (e.g. 'FLOGI entries on fc1/3'). An ` +
        `absence that cannot name what it did not find is indistinguishable from a tool that ` +
        `returned nothing by accident.`,
    );
  }
  const checked = normalizeCoverageList(fn, 'checked', decl.checked, false);
  if (checked.length === 0) {
    throw new Error(
      `${fn}: '${what}' — \`checked\` must name at least one source, window or population ` +
        `that WAS searched. An absence with no coverage is a null with extra steps: the reader ` +
        `still cannot tell "I looked and there is nothing" from "I could not look", which is ` +
        `the confusion this function exists to remove. If you genuinely could not look, that ` +
        `is an error — throw, or return a failure the model can retry.`,
    );
  }
  const notChecked = normalizeCoverageList(fn, 'notChecked', decl.notChecked, false);
  const cannotCover = normalizeCoverageList(fn, 'cannotCover', decl.cannotCover, true);
  const tryInstead = typeof decl.tryInstead === 'string' ? decl.tryInstead.trim() : undefined;

  return {
    af_absent: true,
    outcome: 'nothing_found',
    looked_for: what,
    checked,
    ...(notChecked.length > 0 && { not_checked: notChecked }),
    ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
    retry_returns_the_same: true,
    ...(tryInstead !== undefined && tryInstead !== '' && { try_instead: tryInstead }),
    note: ABSENCE_NOTE,
  };
}

/**
 * Recognize (or decline to recognize) a value as an absence — STRICT, and the
 * strictness is the zero-cost guarantee. Only a plain object whose
 * `af_absent` is exactly `true` and whose `checked` is a non-empty array
 * qualifies; every other value any tool has ever returned takes the path it
 * always took, byte for byte.
 *
 * `undefined` means "not an absence", never "a malformed one" — this library
 * does not guess at a shape it did not mint.
 */
export function readAbsence(value: unknown): ToolAbsence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (rec[ABSENCE_MARKER] !== true) return undefined;
  if (!Array.isArray(rec.checked) || rec.checked.length === 0) return undefined;
  return value as ToolAbsence;
}

/** The absence's coverage, in the normalized three-list shape everything
 *  downstream (the event, the answer block) reads. */
export function coverageOfAbsence(absence: ToolAbsence): Coverage {
  return {
    checked: absence.checked ?? [],
    notChecked: absence.not_checked ?? [],
    cannotCover: absence.cannot_cover ?? [],
  };
}
