/** How many run ids one instance remembers. */
export const MAX_REMEMBERED_RUNS = 256;

/** Drop the oldest entries of an insertion-ordered Set or Map past `max`. */
export function boundInsertionOrder(held: Set<string>, max: number): void {
  while (held.size > max) {
    const oldest = held.keys().next();
    if (oldest.done === true) return;
    held.delete(oldest.value);
  }
}
