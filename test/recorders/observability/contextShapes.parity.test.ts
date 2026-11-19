import { isCommitBundle, stateAt } from 'foottrace';
import { describe, expect, it, vi } from 'vitest';
import { createContextShapeCapture } from '../../../src/recorders/observability/contextShapes.js';
import { contextShapeAt } from '../../../src/recorders/observability/contextShapes/read.js';
import {
  classify,
  lookup,
  type ContextShapeOptions,
  type ShapeEntry,
} from '../../../src/recorders/observability/contextShapes/value.js';

vi.mock('foottrace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('foottrace')>();
  return { ...actual, isCommitBundle: vi.fn(actual.isCommitBundle) };
});

const verbs = ['set', 'delete', 'append', 'merge'] as const;
const paths = [
  ['a'],
  ['a', '0'],
  ['a', '3'],
  ['a', '0', 'parts'],
  ['box'],
  ['box', 'items'],
  ['box', 'items', '1'],
  ['box', 'items', '0'],
];
const modes: ContextShapeOptions[] = [{}, { paths }, { scan: 'full' }];

function generatedLog(seed: number) {
  // A fixed seed makes each failing history reproducible in isolation.
  let random = seed;
  function pick<T>(choices: readonly T[]): T {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return choices[Math.floor((random / 2 ** 32) * choices.length)];
  }
  const values = [false, 0, null, 'text', [], [1, 1], [{ x: 3 }], { items: [1, 2] }];
  return Array.from({ length: 15 }, (_, commit) => {
    const path = pick(paths);
    const verb = verbs[(seed + commit) % verbs.length];
    const parts = path.join('\u001f');
    const mask = commit % 6 === 0 && verb !== 'delete';
    const value = mask ? { hidden: [seed], visible: [seed] } : pick(values);
    const patch = path.reduceRight<unknown>((child, key) => ({ [key]: child }), value);
    return {
      runtimeStageId: `stage#${commit}`,
      trace: [{ path: parts, verb }],
      redactedPaths: mask ? [`${parts}\u001fhidden`] : [],
      ...(verb === 'merge' ? { updates: patch } : { overwrite: patch }),
    };
  });
}

describe('recorded context shape parity with Foottrace replay', () => {
  for (const [mode, options] of modes.entries()) {
    it(`checks every reported fact at every commit in ${
      ['default', 'paths', 'full'][mode]
    } mode`, () => {
      for (let seed = 1; seed <= 10; seed++) {
        const source = {
          initialState: { a: [{ parts: [1, 1] }, { parts: [] }], box: { items: [{ items: [] }] } },
          commitLog: generatedLog(seed),
        };
        const index = createContextShapeCapture(options)(source).contextShapes!;
        expect(index.changes.length).toBeGreaterThan(0);
        const changes = new Map(index.changes);
        const observed = new Map<string, ShapeEntry>();
        for (let commit = -1; commit < source.commitLog.length; commit++) {
          const fold = stateAt(source, commit);
          expect(fold.skipped).toBeUndefined();
          for (const mask of source.commitLog[commit]?.redactedPaths ?? [])
            expect(contextShapeAt(index, commit, mask.split('\u001f'))).toEqual(['unknown']);
          const entries = commit === -1 ? index.initial : changes.get(commit) ?? [];
          for (const entry of entries) {
            const [path, kind] = entry;
            observed.set(JSON.stringify(path), entry);
            if (kind === 'deleted') expect(classify(lookup(fold.state, path))).toEqual(['deleted']);
          }
          for (const [path, kind, length] of observed.values()) {
            const at = `seed ${seed}, commit ${commit}, path ${path.join('.')}`;
            const shape = kind === 'array' ? [kind, length] : [kind];
            const exposed = kind === 'deleted' ? ['unknown'] : shape;
            expect(contextShapeAt(index, commit, path), at).toEqual(exposed);
            if (exposed[0] !== 'unknown')
              expect(shape, at).toEqual(classify(lookup(fold.state, path)));
          }
        }
      }
    });
  }

  it('omits the whole index when a future Foottrace version admits a fifth verb', () => {
    const source = {
      initialState: { a: [1] },
      commitLog: [
        {
          runtimeStageId: 'change#1',
          trace: [
            { path: 'a', verb: 'merge' },
            { path: 'b', verb: 'new-verb' },
          ],
          updates: { a: [2], b: 'unproved' },
        },
      ],
    };
    for (const options of modes) {
      // Today's Foottrace already refuses the record. Simulate acceptance by
      // its next version, including a merge on the full-scan shortcut.
      vi.mocked(isCommitBundle).mockReturnValueOnce(true);
      expect(createContextShapeCapture(options)(source).contextShapes).toBeUndefined();
    }
  });
});
