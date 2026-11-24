import { LATE_RECORD_NOTE_ATTRIBUTION } from '../../../../lib/saidByPerson.js';

export type LateNotePoint = Readonly<{
  owner: 'library' | 'tool';
  kind: string;
  tool: string;
  why?: string;
}>;

const MAX_POINTS = 5;
const MAX_BYTES = 512;
const encoder = new TextEncoder();

/** The caller supplies only served points, most important first. */
export function renderLateRecordNote(points: readonly LateNotePoint[]): string | undefined {
  const rows = new Set<string>();
  let bytes = encoder.encode(LATE_RECORD_NOTE_ATTRIBUTION).byteLength + 3; // The newline and array brackets.
  for (const { owner, kind, tool, why } of points) {
    // A row that is too large before escaping cannot fit after it. Skip it before allocating JSON.
    if (kind.length + tool.length + (why?.length ?? 0) > MAX_BYTES - bytes) continue;
    const row = JSON.stringify({ owner, kind, tool, why }).replace(
      /[<>`\u2028\u2029]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    if (rows.has(row)) continue;
    const addedBytes = encoder.encode(row).byteLength + (rows.size > 0 ? 1 : 0);
    if (bytes + addedBytes > MAX_BYTES) continue;
    rows.add(row);
    bytes += addedBytes;
    if (rows.size === MAX_POINTS) break;
  }
  return rows.size > 0 ? `${LATE_RECORD_NOTE_ATTRIBUTION}\n[${[...rows].join(',')}]` : undefined;
}
