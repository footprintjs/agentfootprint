import type { ServedView } from '../servedView.js';

/**
 * The BOUNDARY half of the fold law: a container that leaves this file is this
 * file's own.
 *
 * `keyedFold` deep-freezes its answers, so nothing a consumer does to a view
 * can reach a later epoch. This is the second, cheaper guarantee on top of it:
 * the two arrays a view would otherwise ALIAS straight out of the fold — the
 * conversation and the tool schemas — are copied, so `ServedView` is a value in
 * its own right and not a window onto the fold's cache. Elements are the fold's
 * frozen objects; the container is ours.
 *
 * Every other array on a view is built by a projection and aliases nothing,
 * so it needs the COPY half of this and not the freeze — but it is
 * frozen anyway, by {@link frozenView}, because the type says `readonly`
 * throughout and a claim that is true of two containers out of six is a claim
 * a reader cannot use.
 */
export function detachedList<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

/**
 * A `ServedView` is a VALUE — all of it, not the two containers that happened
 * to need copying.
 *
 * Freezing the whole view costs a handful of `Object.freeze` calls per epoch
 * over containers that are already the right size to hand a person: a few
 * system pieces, at most one request-only line, a tool list, the gaps. It buys
 * one sentence a reader can rely on instead of a rule about which two arrays
 * are safe. `messages.asSent` and `tools.schemas` are already frozen by
 * {@link detachedList} — their ELEMENTS are the fold's own frozen objects and
 * this function does not walk into them, because they are not ours to freeze
 * twice.
 *
 * What this is NOT: protection against a shared reference. Nothing on a view
 * except those two arrays is shared with anything — every other container is
 * built here per call. The freeze makes the type's promise exact; the copy in
 * `detachedList` is what makes the fold safe.
 */
export function frozenView(view: ServedView): ServedView {
  for (const piece of view.system.pieces) Object.freeze(piece);
  Object.freeze(view.system.pieces);
  for (const line of view.messages.requestOnly) Object.freeze(line);
  Object.freeze(view.messages.requestOnly);
  Object.freeze(view.tools.names);
  for (const gap of view.gaps) Object.freeze(gap);
  Object.freeze(view.gaps);
  if (view.basis !== undefined) Object.freeze(view.basis);
  Object.freeze(view.system);
  Object.freeze(view.messages);
  Object.freeze(view.tools);
  return Object.freeze(view);
}
