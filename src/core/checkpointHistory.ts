/**
 * core/checkpointHistory — a stored conversation's `history`, admitted message
 * by message at the checkpoint door (`runCheckpoint.ts` · `validateCheckpoint`).
 *
 * The conversation itself, message by message (8.18.0). `Array.isArray` was
 * the whole check, one field away from `originalInput.message` — which HAS
 * been string-checked since the door was written. A checkpoint that
 * round-tripped through a store, a hand edit, or an older writer could carry
 * a turn with no `content`, deserialize cleanly, and take the run down on
 * its first composition with a TypeError naming neither the checkpoint nor
 * the turn. A persisted artifact is checked at the door it comes in.
 *
 * @example
 * ```ts
 * admitStoredHistory([{ role: 'user', content: 'hi' }]); // passes
 * admitStoredHistory([{ role: 'user' }]); // TypeError naming history[0]
 * ```
 */

/** Throws a `TypeError` naming the first entry that is not `{ role: string, content: string }`. */
export function admitStoredHistory(history: readonly unknown[]): void {
  for (const [i, msg] of history.entries()) {
    if (!msg || typeof msg !== 'object') {
      throw new TypeError(
        `[resumeOnError] checkpoint history[${i}] is not a message (got ${
          msg === null ? 'null' : typeof msg
        }). Each entry must be { role, content }.`,
      );
    }
    const m = msg as { role?: unknown; content?: unknown };
    if (typeof m.role !== 'string' || typeof m.content !== 'string') {
      throw new TypeError(
        `[resumeOnError] checkpoint history[${i}] is missing text: \`role\` is ${typeof m.role}, ` +
          `\`content\` is ${
            m.content === undefined ? 'missing' : typeof m.content
          }. Every turn in a stored conversation must carry { role: string, content: string } — ` +
          `a turn without content cannot be composed into the next request, and the failure ` +
          `would otherwise surface deep inside the run rather than here.`,
      );
    }
  }
}
