/**
 * The check-in trail's reader for a tool message that carries no outcome mark:
 * the text test the trail used before `LLMMessage.outcome` existed, kept only
 * as the fallback for unmarked messages.
 *
 * Why it is kept: a history stored by an earlier version (a checkpoint, a
 * stored conversation) has no `outcome` on any message, refused calls
 * included. Read by the mark alone, such a run, resumed after an upgrade,
 * would show the person approving a check-in every earlier refused call as
 * ok. With this fallback every unmarked message of a stored history reads as
 * it did before the upgrade; the one change is a host's notice standing in
 * for a result (`toolResultOrigin`), which `buildTrail` now reads not ok.
 *
 * What it costs, on the careful side: the test reads words, not the record,
 * so a completed call whose own result begins with one of these forms (a tool
 * that returned "declined by human: …") still reads not ok, as it did before
 * the marker. A refusal written in one of these forms is never shown as ok; a
 * rare completed call can be shown as not ok. The forms are the ones the old
 * reader used, unchanged: the credential refusal the library writes today
 * begins with a bracket ("[authorization required: …]"), so a stored one does
 * not match and reads ok, as it did before; a call this version refuses is
 * marked and reads not ok anyway.
 *
 * @example
 *   readsRefusedBeforeOutcomeMarker('[permission denied: needs a supervisor]'); // true
 *   readsRefusedBeforeOutcomeMarker('sunny, 21°C');                             // false
 */

/** The opening words of the library's own refusals, as the old reader matched them (lower case). */
const REFUSAL_FORMS = [
  '[permission denied',
  'declined by human',
  'credential error',
  'authorization required',
] as const;

/** True when an UNMARKED tool message's text begins with one of the library's refusal forms. */
export function readsRefusedBeforeOutcomeMarker(content: string | undefined): boolean {
  const text = (content ?? '').toLowerCase();
  return REFUSAL_FORMS.some((form) => text.startsWith(form));
}
