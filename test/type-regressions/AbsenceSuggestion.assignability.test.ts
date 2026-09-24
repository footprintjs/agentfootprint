/**
 * Compile-level regression test — 9.113.0 names a suggested tool as data
 * WITHOUT widening `try_instead`.
 *
 * `ToolAbsence` is what `readAbsence` hands every reader, and `try_instead`
 * has been `string` since the field shipped. Every reader typed against it —
 * a host's own code, a row that quotes the suggestion as printed — reads it
 * as a string. Had the typed tool ridden that same field, each of them would
 * have had to narrow a union or silently drop the object form, and a MINOR
 * release would have broken their build. So the typed tool rides its own key,
 * and the real compiler (`npm run test:types`, this directory's tsconfig)
 * pins three things a runtime test cannot hold for all time:
 *
 *   1. **`ToolAbsence.try_instead` is exactly `string | undefined`.** A string
 *      reader compiles without a cast; the day someone widens it, the
 *      assignment below stops compiling.
 *   2. **The typed tool is `try_instead_tool`**, `{ tool, why? }`.
 *   3. **`AbsenceDeclaration.tryInstead` takes a sentence only** — the object
 *      goes in `tryInsteadTool`, and the `@ts-expect-error` fails the build
 *      the day the sentence slot starts accepting it.
 *
 * The `.test.ts` name lets `npm test` run the runtime assertions too.
 */
import { describe, expect, it } from 'vitest';

import {
  absent,
  readAbsence,
  type AbsenceDeclaration,
  type ToolAbsence,
  type TryInsteadTool,
} from '../../src/index';

describe('a reader of try_instead still reads a string', () => {
  it('assigns `try_instead` to a string slot with no narrowing and no cast', () => {
    const minted = absent({
      what: 'latency samples for the named cluster',
      checked: ['collected latency samples over the last 1h'],
      tryInstead: 'Widen the window, or check cluster_inventory for the collected cluster names.',
      tryInsteadTool: { tool: 'cluster_inventory', why: 'it lists the collected cluster names' },
    });

    // LAW 1. The 9.112.2 reader's line, unchanged.
    const sentence: string | undefined = readAbsence(minted)?.try_instead;
    expect(sentence).toBe(
      'Widen the window, or check cluster_inventory for the collected cluster names.',
    );

    // LAW 2. The typed tool, on its own key.
    const tool: TryInsteadTool | undefined = readAbsence(minted)?.try_instead_tool;
    expect(tool).toEqual({
      tool: 'cluster_inventory',
      why: 'it lists the collected cluster names',
    });
  });

  it('keeps `try_instead` exactly `string | undefined`', () => {
    type Field = ToolAbsence['try_instead'];
    const exact: [Field] extends [string | undefined]
      ? [string | undefined] extends [Field]
        ? true
        : false
      : false = true;
    expect(exact).toBe(true);
  });

  it('takes the object form only where it belongs', () => {
    const typed: AbsenceDeclaration = {
      what: 'x',
      checked: ['a source'],
      tryInsteadTool: { tool: 'cluster_inventory' },
    };
    expect(typed.tryInsteadTool?.tool).toBe('cluster_inventory');

    // LAW 3. The sentence slot takes a sentence.
    const wrongSlot: AbsenceDeclaration = {
      what: 'x',
      checked: ['a source'],
      // @ts-expect-error — the typed tool goes in `tryInsteadTool`, never in `tryInstead`.
      tryInstead: { tool: 'cluster_inventory' },
    };
    expect(() => absent(wrongSlot)).toThrow(/`tryInsteadTool`, beside the sentence/);
  });
});
