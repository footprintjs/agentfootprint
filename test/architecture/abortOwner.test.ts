/**
 * EVERY CANCELLATION GOES THROUGH THE ONE RULE.
 *
 * `lib/abort.ts` is the one owner of how the library honours an `AbortSignal`
 * (refuse before sending, race every wait, close the stream, refuse a late
 * answer, hand back the caller's reason). Ollama, Foundry Local and the
 * classifier each kept a private copy of its helpers, and each copy drifted:
 * one threw a non-Error reason raw, two unlinked the caller's signal once the
 * headers arrived, so a body read was deaf to the abort. This guard refuses a
 * fourth: a function under `src/` named like one of those helpers, anywhere
 * but `lib/abort.ts`.
 *
 * Adding a cancellable wait: `import { untilAborted, throwIfAborted } from
 * '<path>/lib/abort.js'`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const OWNER = 'src/lib/abort.ts';

/** The helpers the owner exports, and the names the private copies went by. */
const OWNED_NAMES = [
  'throwIfAborted',
  'untilAborted',
  'abortErrorOf',
  'asAbortError',
  'abortReason',
  'raceAbort',
] as const;

const DEFINES = new RegExp(
  String.raw`(?:function\s+|(?:const|let)\s+)(${OWNED_NAMES.join('|')})\b`,
  'g',
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every private definition of an owned name in one source, as `file — name`. */
function privateCopies(file: string, source: string): string[] {
  return [...source.matchAll(DEFINES)].map((m) => `${file} — ${m[1]}`);
}

describe('the abort owner', () => {
  it('the scanner sees the shapes the private copies took', () => {
    expect(privateCopies('x.ts', 'function throwIfAborted(signal) {}')).toHaveLength(1);
    expect(privateCopies('x.ts', 'function asAbortError(reason: unknown): Error {')).toHaveLength(
      1,
    );
    expect(privateCopies('x.ts', 'const untilAborted = <T>(p: Promise<T>) => p;')).toHaveLength(1);
    expect(privateCopies('x.ts', "import { untilAborted } from '../lib/abort.js';")).toEqual([]);
    expect(privateCopies('x.ts', 'await untilAborted(fetch(url), signal);')).toEqual([]);
  });

  it('no file under src/ but lib/abort.ts defines its own', () => {
    const found = walk(join(ROOT, 'src'))
      .map((full) => relative(ROOT, full))
      .filter((file) => file !== OWNER)
      .flatMap((file) => privateCopies(file, readFileSync(join(ROOT, file), 'utf8')));
    expect(found, `import these from ${OWNER} instead`).toEqual([]);
  });

  it('the owner still defines them (the guard is not stale)', () => {
    const owner = readFileSync(join(ROOT, OWNER), 'utf8');
    for (const name of ['throwIfAborted', 'untilAborted', 'abortErrorOf']) {
      expect(owner).toMatch(new RegExp(String.raw`export function ${name}\b`));
    }
  });
});
