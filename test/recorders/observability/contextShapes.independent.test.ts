import { stateAt } from 'foottrace';
import { expect, it } from 'vitest';
import { contextShapeAt } from '../../../src/doors/observe.js';
import {
  createContextShapeCapture,
  type ContextShapeOptions,
} from '../../../src/recorders/observability/contextShapes.js';

// Keep this oracle independent of the recorder's classifier, path lookup and redaction book.
type Path = readonly string[];
const delimiter = '\u001f';
const roots = ['a', 'b', 'list', 'box'];
const suffixes = [[], ['x'], ['0'], ['2'], ['items'], ['items', '1'], ['x', 'y'], ['length']];
const watched = roots.flatMap((key) => suffixes.map((suffix) => [key, ...suffix]));
const missing = Symbol('missing');
const prefixes = (a: Path, b: Path) => a.length <= b.length && a.every((key, i) => b[i] === key);

function lookup(value: unknown, path: Path): unknown {
  for (const key of path) {
    if (value === null || typeof value !== 'object') return missing;
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) return missing;
    if (!Object.hasOwn(value, key)) return missing;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function shape(value: unknown): string {
  if (value === missing) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array:' + value.length;
  return typeof value;
}

function pathsIn(value: unknown, path: Path, paths: Path[]) {
  if (path.length) paths.push(path);
  if (value === null || typeof value !== 'object' || path.length >= 5) return;
  for (const [key, child] of Object.entries(value)) pathsIn(child, [...path, key], paths);
}

function generate(seed: number) {
  // Mulberry32. A failing seed reproduces exactly one twelve-commit recording.
  let state = Math.imul(seed, 104729);
  function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  }
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;

  function value(depth = 0): unknown {
    const roll = random();
    if (roll < 0.3 || depth > 2) return pick([0, 7, 'text', '', true, null]);
    if (roll < 0.65) {
      return Array.from({ length: Math.floor(random() * 4) }, () =>
        random() < 0.5 ? pick([1, 'dup']) : value(depth + 1),
      );
    }
    const entries = Array.from({ length: Math.floor(random() * 3) }, () => [
      pick(['x', 'y', 'items', 'hidden', '0']),
      value(depth + 1),
    ]);
    return Object.fromEntries(entries);
  }

  const initialState: Record<string, unknown> = {};
  for (const key of roots) if (random() < 0.6) initialState[key] = value();
  const commitLog = Array.from({ length: 12 }, (_, commit) => {
    const trace: { path: string; verb: 'set' | 'append' | 'merge' | 'delete' }[] = [];
    const overwrite: Record<string, unknown> = {};
    const updates: Record<string, unknown> = {};
    const redactedPaths: string[] = [];
    // A bundle carries one retained operand per root in each write map.
    const choices = [...roots];
    const writes = random() < 0.5 ? 1 : 2;
    for (let n = 0; n < writes; n++) {
      const key = choices.splice(Math.floor(random() * choices.length), 1)[0]!;
      const path = [key, ...pick(suffixes)];
      const verb = pick(['set', 'set', 'merge', 'append', 'delete'] as const);
      let operand: unknown;
      if (verb === 'merge')
        operand = random() < 0.5 ? [1, 'dup', value(1)] : { x: value(1), items: [1, 1] };
      else if (verb === 'append') operand = [value(1), value(1)];
      else if (verb === 'set') operand = value();

      if (verb !== 'delete' && random() < 0.18) {
        if (
          operand !== null &&
          typeof operand === 'object' &&
          !Array.isArray(operand) &&
          random() < 0.6
        ) {
          (operand as Record<string, unknown>).hidden = ['secret', seed];
          redactedPaths.push([...path, 'hidden'].join(delimiter));
        } else {
          redactedPaths.push(path.join(delimiter));
        }
      }
      const patch = path
        .slice(1)
        .reduceRight<unknown>((child, part) => ({ [part]: child }), operand);
      (verb === 'merge' ? updates : overwrite)[key] = patch;
      trace.push({ path: path.join(delimiter), verb });
    }
    return { runtimeStageId: 'stage#' + commit, trace, overwrite, updates, redactedPaths };
  });
  return { runId: 'run-' + seed, initialState, commitLog };
}

function masksAfter(previous: Path[], bundle: ReturnType<typeof generate>['commitLog'][number]) {
  // Redactions describe this bundle's retained writes. Replacing an older value
  // retires that value's mask; every new mask then applies to the published state.
  const replaced = bundle.trace
    .filter((row) => row.verb === 'delete' || row.verb === 'set')
    .map((row) => row.path.split(delimiter));
  return [
    ...previous.filter((path) => !replaced.some((parent) => prefixes(parent, path))),
    ...bundle.redactedPaths.map((encoded) => encoded.split(delimiter)),
  ];
}

function foldedPrefix(source: ReturnType<typeof generate>): unknown[] {
  const states: unknown[] = [];
  for (let commit = -1; commit < source.commitLog.length; commit++) {
    try {
      const fold = stateAt(source, commit);
      expect(fold.skipped).toBeUndefined();
      states.push(fold.state);
    } catch (error) {
      // A synthetic write to an array's length can be invalid JavaScript.
      // Its earlier prefix still has a native state to compare.
      if (
        !(error instanceof Error) ||
        !/invalid array length|cannot delete property 'length'/i.test(error.message)
      )
        throw error;
      break;
    }
  }
  return states;
}

const modes: Array<[string, ContextShapeOptions]> = [
  ['default', {}],
  ['paths', { paths: watched }],
  ['full', { scan: 'full' }],
];

it.each(modes)(
  'checks generated shape facts and hidden paths against an independent oracle (%s)',
  (mode, options) => {
    let known = 0;
    let hidden = 0;
    let declined = 0;
    let invalid = 0;
    let questions = 0;
    for (let seed = 1; seed <= 48; seed++) {
      const source = generate(seed);
      const states = foldedPrefix(source);
      const invalidFold = states.length !== source.commitLog.length + 1;
      if (invalidFold) invalid++;
      const index = createContextShapeCapture(options)(structuredClone(source)).contextShapes;
      if (!index) {
        // Full scan can ask Foottrace for a merged root. An unreadable fold
        // declines the entire index, without publishing a partial prefix.
        expect({ mode, invalidFold }, 'seed ' + seed).toEqual({ mode: 'full', invalidFold: true });
        declined++;
        continue;
      }
      const changes = new Map(index.changes);
      let masks: Path[] = [];
      for (let commit = -1; commit < source.commitLog.length; commit++) {
        if (commit >= 0) masks = masksAfter(masks, source.commitLog[commit]!);
        const entries = commit < 0 ? index.initial : changes.get(commit) ?? [];
        for (const [path, kind, length] of entries) {
          if (masks.some((mask) => prefixes(mask, path))) {
            expect(
              ['unknown', 'deleted'],
              'hidden wire entry: seed ' + seed + ', commit ' + commit + ', ' + path.join('/'),
            ).toContain(kind);
            expect(length).toBeUndefined();
          }
        }
        // Query masks and their descendants even if replay removed them or
        // stopped at an invalid operation, and even if the index omitted them.
        const paths = [...watched, ...masks, ...masks.map((mask) => [...mask, '0'])];
        const hasState = commit + 1 < states.length;
        if (hasState) pathsIn(states[commit + 1], [], paths);
        for (const path of paths) {
          questions++;
          const answer = contextShapeAt(index, commit, path);
          const label = 'seed ' + seed + ', commit ' + commit + ', ' + path.join('/');
          if (masks.some((mask) => prefixes(mask, path))) {
            hidden++;
            if (answer.length !== 1 || answer[0] !== 'unknown')
              expect(answer, label).toEqual(['unknown']);
          } else if (hasState && answer[0] !== 'unknown') {
            known++;
            const actual = answer[0] === 'array' ? 'array:' + answer[1] : answer[0];
            const expected = shape(lookup(states[commit + 1], path));
            if (actual !== expected) expect(actual, label).toBe(expected);
          }
        }
      }
    }
    expect(questions).toBeGreaterThan(10000);
    expect(known).toBeGreaterThan(1000);
    expect(hidden).toBeGreaterThan(1000);
    expect(invalid).toBeGreaterThan(0);
    if (mode === 'full') expect(declined).toBeGreaterThan(0);
  },
);
