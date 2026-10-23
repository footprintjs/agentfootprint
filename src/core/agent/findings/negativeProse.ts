/** Checkpoint admission for observe-only prose findings. No prose or evidence is
 * re-judged on restore, and an unknown/malformed row cannot silently disappear. */
import { PROSE_NOTES } from '../../../integrity/negative-claim/types.js';
import { copyJson } from '../../../lib/boundedJson.js';

export function negativeProseRowIsWellFormed(value: unknown): boolean {
  try {
    const row = copyJson(value, 1024 * 1024, true) as Record<string, unknown>;
    const integer = (v: unknown): v is number =>
      typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    const strings = (v: unknown): boolean =>
      Array.isArray(v) && v.every((item) => typeof item === 'string');
    const span = row.span as Record<string, unknown> | undefined;
    if (
      typeof row.field !== 'string' ||
      typeof row.packVersion !== 'string' ||
      !integer(row.iteration) ||
      !integer(row.turn) ||
      row.turn < 1 ||
      !span ||
      !integer(span.start) ||
      !integer(span.end) ||
      span.end < span.start
    )
      return false;
    if (row.kind === 'negative-claim-note')
      return (
        ['in-code-block', 'language-unsupported', 'too-many-claims', 'input-limit'].includes(
          row.code as string,
        ) &&
        (row.phraseId === undefined || typeof row.phraseId === 'string')
      );
    if (
      row.kind !== 'negative-claim' ||
      !['none', 'complete'].includes(row.claim as string) ||
      typeof row.phraseId !== 'string' ||
      !strings(row.notes) ||
      !(row.notes as string[]).every((note) => (PROSE_NOTES as readonly string[]).includes(note)) ||
      !strings(row.results) ||
      (row.candidates !== undefined && !strings(row.candidates))
    )
      return false;
    const stale = row.staleSince as Record<string, unknown> | undefined;
    return (
      stale === undefined ||
      (stale !== null &&
        integer(stale.turn) &&
        stale.turn > 0 &&
        (stale.readAt === undefined || typeof stale.readAt === 'string'))
    );
  } catch {
    return false;
  }
}
