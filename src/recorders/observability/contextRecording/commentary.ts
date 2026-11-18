import type { ContextCallChange } from './types.js';

/** Call prose reads the change list, never repeats the bodies behind its ids. */
export function contextCallCommentary(change: ContextCallChange): string {
  const rules =
    (change.counts.base ?? 0) + (change.counts.steering ?? 0) + (change.counts.instructions ?? 0);
  const tools = change.counts.tools ?? 0;
  const skills = change.counts.skill ?? 0;
  const known = rules + tools + skills;
  const total = Object.values(change.counts).reduce((a, b) => a + b, 0);
  const detail = [
    `${rules} rules`,
    `${tools} tools`,
    ...(skills ? [`${skills} skills`] : []),
    ...(total > known ? [`${total - known} other pieces`] : []),
  ].join(', ');
  if (change.call === 1) return `Context recorded for call 1 (${detail}).`;
  if (change.added.length === 0 && change.removed.length === 0 && change.order === undefined)
    return `Context unchanged since call ${change.call - 1} (${detail}).`;
  if (change.added.length === 0 && change.removed.length === 0)
    return `Context order changed since call ${change.call - 1} (${detail}).`;
  return `Context changed for call ${change.call}: ${change.added.length} added, ${change.removed.length} removed, ${change.unchanged} unchanged (${detail}).`;
}
