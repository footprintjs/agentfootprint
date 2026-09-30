/**
 * The time bench's case sheet (`bench/time/cases.mjs`) — sound, and each case in the cell the
 * English reader really puts it in (`bench/time/RULE.md`, "The cases").
 *
 * Test types:
 *   - UNIT — `sheetProblems` is empty; a readable message reads to a window, an unreadable one to
 *            a mention marked `unreadable`, a control to no mention at all.
 */
import { describe, expect, it } from 'vitest';

import { englishTimeReader } from '../../../src/index.js';
// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, sheetProblems } from '../../../bench/time/cases.mjs';

describe('the case sheet', () => {
  it('is sound', () => {
    expect(sheetProblems()).toEqual([]);
  });

  for (const c of CASES as { id: string; cell: string; message: string }[]) {
    it(`${c.id}: the reader puts "${c.message}" in the ${c.cell} cell`, async () => {
      const { mentions } = await englishTimeReader().read(c.message, { locale: 'en-US' });
      if (c.cell === 'control') {
        expect(mentions).toEqual([]);
        return;
      }
      expect(mentions).toHaveLength(1);
      if (c.cell === 'unreadable') expect(mentions[0]!.problem).toBe('unreadable');
      else expect(mentions[0]!.problem).toBeUndefined();
    });
  }
});
