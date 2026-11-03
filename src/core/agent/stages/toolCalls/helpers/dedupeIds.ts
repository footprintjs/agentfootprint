/** Declaration order preserved, ids de-duplicated — the shape the gate's re-prompt
 *  and the `skill.rejected` payload both report as "what this gate accepts". */
export function dedupeIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}
