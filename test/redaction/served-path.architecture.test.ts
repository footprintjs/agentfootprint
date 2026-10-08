/**
 * Every typed event the library's stages emit leaves through ONE served path:
 * `typedEmit` → `emitServed` (`src/redaction/runRedaction.ts`), which serves
 * the payload under the run's rule before footprintjs's `$emit`. A stage that
 * called `scope.$emit` itself would put its payload on every channel raw.
 *
 * Pinned by reading the source: the only `.$emit(` call in `src/` is the one
 * inside `runRedaction.ts`, and `typedEmit` delegates to `emitServed`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

/** A file's code with its comments taken out. */
const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the one served path for a stage’s typed events', () => {
  it('no file but runRedaction.ts calls `$emit` itself', () => {
    const callers = sourceFiles(SRC)
      .filter((path) => /\.\$emit\s*\(/.test(codeOf(path)))
      .map((path) => relative(SRC, path));
    expect(callers).toEqual(['redaction/runRedaction.ts']);
  });

  it('typedEmit hands every payload to emitServed', () => {
    const code = codeOf(join(SRC, 'recorders/core/typedEmit.ts'));
    expect(code).toMatch(/emitServed\(scope, type, payload\)/);
    expect(code).not.toMatch(/\.\$emit\s*\(/);
  });

  it('every stage that emits imports the served path, never footprintjs’s emit directly', () => {
    const stages = sourceFiles(join(SRC, 'core/agent/stages'));
    const emitting = stages.filter((path) => /typedEmit\(|emitServed\(/.test(codeOf(path)));
    expect(emitting.length).toBeGreaterThan(5);
    for (const path of emitting) {
      expect(codeOf(path), relative(SRC, path)).toMatch(/typedEmit|emitServed/);
      expect(codeOf(path), relative(SRC, path)).not.toMatch(/\.\$emit\s*\(/);
    }
  });
});
