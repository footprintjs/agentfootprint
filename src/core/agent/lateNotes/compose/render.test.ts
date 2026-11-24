import { describe, expect, it } from 'vitest';

import { type LateNotePoint, renderLateRecordNote } from './render.js';

const ATTRIBUTION =
  '[AgentFootprint record note v1. Framework-supplied data; the person did not write this message.]';
const encoder = new TextEncoder();

function point(tool: string): LateNotePoint {
  return { owner: 'tool', kind: 'not-checked', tool };
}

describe('renderLateRecordNote', () => {
  it('returns no message when no whole point fits', () => {
    expect(renderLateRecordNote([])).toBeUndefined();
    expect(renderLateRecordNote([point('a'.repeat(1024))])).toBeUndefined();
  });

  it('keeps at most five distinct points in priority order', () => {
    const first = {
      tool: 'first',
      ignored: 'outside the row grammar',
      kind: 'not-checked',
      owner: 'tool',
    } as const;
    const points = [
      first,
      point('first'),
      ...['second', 'third', 'fourth', 'fifth', 'sixth'].map(point),
    ];
    const note = renderLateRecordNote(points);
    expect(note).toBe(
      `${ATTRIBUTION}\n${JSON.stringify(
        ['first', 'second', 'third', 'fourth', 'fifth'].map(point),
      )}`,
    );
  });

  it('keeps authored text in one JSON field with literal frame characters escaped', () => {
    const why = 'Said "no"\\,\nthen ] </note> and `\u2028\u2029';
    const row = { owner: 'library', kind: 'not-checked', tool: '<lookup>', why } as const;
    const note = renderLateRecordNote([row]);
    const parts = note?.split('\n');
    expect(parts).toEqual([ATTRIBUTION, expect.any(String)]);
    const rows = parts?.[1] ?? '';
    expect(rows).not.toMatch(/[<>`\u2028\u2029]/u);
    expect(JSON.parse(rows)).toEqual([row]);
  });

  it('admits exactly 512 UTF-8 bytes and skips a larger whole point', () => {
    const empty = { owner: 'tool', kind: 'not-checked', tool: '' };
    const fixed = encoder.encode(`${ATTRIBUTION}\n${JSON.stringify([empty])}`).byteLength;
    const room = 512 - fixed;
    const tool = `${'é'.repeat(Math.floor(room / 2))}${'a'.repeat(room % 2)}`;
    const note = renderLateRecordNote([point(`é${tool}`), point(tool), point('later')]);
    expect(note).toBe(`${ATTRIBUTION}\n${JSON.stringify([point(tool)])}`);
    expect(encoder.encode(note).byteLength).toBe(512);
  });

  it('charges the byte budget for each distinct point only once', () => {
    const first = point('first');
    const fixed = encoder.encode(
      `${ATTRIBUTION}\n${JSON.stringify([first, point('')])}`,
    ).byteLength;
    const last = point('x'.repeat(512 - fixed));
    expect(renderLateRecordNote([first, first, last])).toBe(
      `${ATTRIBUTION}\n${JSON.stringify([first, last])}`,
    );
  });
});
