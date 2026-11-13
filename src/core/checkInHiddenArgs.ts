/**
 * checkInHiddenArgs — what a check-in told the person was hidden, kept with
 * the request and read back on resume.
 *
 * Pattern: pure functions over plain data; no imports.
 * Role:    the one owner of the list's three readings: the form bound into the
 *          request id (`consentRequest.ts` · `requestIdOf`), the form the
 *          decision's record carries (`resume/checkIn.ts`), and whether the
 *          resumed tool's view still hides the same names
 *          (`access/heldView.ts`).
 * Emits:   N/A.
 *
 * WHY THE NAMES ARE BOUND AT THE ASK. The person decided on the view they were
 * shown. Worked out again at resume from the tool as it is then, a redeploy
 * that widened the view would make the record say they did not see a value
 * they read; one that removed the view would make it say they saw everything.
 * So the names ride the paused request (`PendingRequest.hiddenArgs`) and the
 * request id commits to them: a checkpoint whose list was edited derives
 * another id and is refused as `'call-changed'`.
 *
 * Example:
 *   asked ['to'], the resumed tool's view now hides ['to', 'memo']
 *     → hiddenViewChange(['to'], ['to', 'memo']) = { nowHidden: ['memo'], noLongerHidden: [] }
 *     → the resume is refused (`'view-changed'`): an approval covers what was shown.
 */

/**
 * What a decision's record says when its request was minted before the list
 * existed: the record does not say what was hidden. One fixed value, never an
 * empty list, which would claim that nothing was.
 */
export const HIDDEN_ARGS_NOT_RECORDED = 'not-recorded' as const;

/** The list as the decision's record carries it. */
export type RecordedHiddenArgs = readonly string[] | typeof HIDDEN_ARGS_NOT_RECORDED;

/**
 * The list as the request id commits to it: omitted when empty, so a request
 * for a tool without a view derives the same id as before the list existed.
 */
export function boundHiddenArgs(list: unknown): unknown {
  return Array.isArray(list) && list.length === 0 ? undefined : list;
}

/** The list as the paused request keeps it: a frozen copy, `[]` included; nothing on an ask. */
export function keptHiddenArgs(list: unknown): { readonly hiddenArgs?: readonly string[] } {
  return Array.isArray(list) ? { hiddenArgs: Object.freeze([...(list as string[])]) } : {};
}

/** The list a paused request holds, as stored — read for the id, never trusted. */
export function hiddenArgsOn(pausedRequest: unknown): unknown {
  return typeof pausedRequest === 'object' && pausedRequest !== null
    ? (pausedRequest as { hiddenArgs?: unknown }).hiddenArgs
    : undefined;
}

/**
 * The names a paused request carried (`pausedRequest.hiddenArgs`), as read
 * from a checkpoint. A request minted before the list existed has none:
 * {@link HIDDEN_ARGS_NOT_RECORDED}. Read only after the request id was held
 * to the call, so an edited list never reaches here.
 */
export function recordedHiddenArgs(pausedRequest: unknown): RecordedHiddenArgs {
  const list = hiddenArgsOn(pausedRequest);
  return Array.isArray(list) && list.every((name) => typeof name === 'string')
    ? Object.freeze([...(list as string[])])
    : HIDDEN_ARGS_NOT_RECORDED;
}

/** How the names a view hides now differ from the names the person was told. */
export interface HiddenViewChange {
  /** Hidden now, but shown to the person when they were asked. */
  readonly nowHidden: readonly string[];
  /** Hidden from the person when they were asked, but shown now. */
  readonly noLongerHidden: readonly string[];
}

/** The difference between the two sets of names, or `undefined` when they are the same set. */
export function hiddenViewChange(
  asked: readonly string[],
  now: readonly string[],
): HiddenViewChange | undefined {
  const nowHidden = now.filter((name) => !asked.includes(name));
  const noLongerHidden = asked.filter((name) => !now.includes(name));
  return nowHidden.length === 0 && noLongerHidden.length === 0
    ? undefined
    : { nowHidden, noLongerHidden };
}
