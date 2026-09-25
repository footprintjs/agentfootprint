/**
 * No model is called — the fences around the answer account.
 *
 *   1. IMPORT-GRAPH FENCE — `src/lib/answer-account/**` reaches, at run time,
 *      no module under `adapters/`, `llm-providers`, `core/agent/stages/`,
 *      `lib/mcp/` (the precedent is `test/lib/mcp/browserGraph.test.ts`, which
 *      bundles `dist/`; this walk reads the sources, so it needs no build). Its
 *      DIRECT edges out of the folder are exactly the ones named below, each for
 *      one owner the account must not duplicate.
 *   2. RUNTIME TRAP — `fetch`, `XMLHttpRequest`, `WebSocket` replaced with
 *      throwing stubs and every timer spied, over fixtures A, A0 and B: none is
 *      touched. The account is a pure function of its inputs.
 *   3. SIGNATURE LAW — pinned by the compiler in
 *      `test/type-regressions/AnswerAccount.assignability.test.ts`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { showLeaves } from '../../../src/lib/answer-account/shown.js';
import { fixtureA, fixtureB, FLAGSHIP_RUN_ID, NEO_DECLARATIONS } from './helpers.js';

const SRC = resolve(__dirname, '../../../src');
const FOLDER = join(SRC, 'lib/answer-account');

/** Runtime (non-type) relative imports of one source file. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(
    /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s+'([^']+)'/gms,
  )) {
    if (m[2]) continue; // `import type` / `export type` — erased
    const clause = m[3] ?? '';
    // `import { type A, type B }` — every binding a type → erased
    const inner = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (
      inner &&
      inner[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith('type '))
    )
      continue;
    out.push(m[4]!);
  }
  for (const m of text.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push(m[1]!);
  return out;
}

function resolveTs(from: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined; // a package (footprintjs) — not ours to walk
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')])
    if (existsSync(candidate)) return candidate;
  return undefined;
}

function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(file)) {
      const next = resolveTs(file, spec);
      if (next !== undefined) stack.push(next);
    }
  }
  return seen;
}

const folderFiles = (): string[] => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  return walk(FOLDER);
};

describe('IMPORT-GRAPH FENCE', () => {
  it('reaches no provider, adapter, loop stage or MCP module at run time', () => {
    const reached = [...closure(join(FOLDER, 'index.ts'))].map((f) => relative(SRC, f));
    const forbidden = reached.filter((f) =>
      /^(adapters\/|llm-providers|core\/agent\/stages\/|lib\/mcp\/|providers|core\/Agent\.ts|core\/runner)/.test(
        f,
      ),
    );
    expect(forbidden).toEqual([]);
    // The walk is real: it reaches past the folder (the owners below and what they import).
    expect(reached).toContain('bridge/eventMeta.ts');
    expect(reached).toContain('core/agent/coverage/items.ts');
  });

  it('its direct edges out of the folder are exactly the named owners', () => {
    const outside = new Set<string>();
    for (const file of folderFiles()) {
      for (const spec of runtimeImports(file)) {
        const target = resolveTs(file, spec);
        if (target === undefined) {
          if (!spec.startsWith('.')) outside.add(spec);
          continue;
        }
        if (!target.startsWith(FOLDER)) outside.add(relative(SRC, target));
      }
    }
    expect([...outside].sort()).toEqual([
      'bridge/eventMeta.ts', // eventBelongsToRun — the ONE owner of "which run is this event for"
      'core/agent/coverage/absent.ts', // readAbsence — the ONE recognizer of an absence envelope
      'core/agent/coverage/answer.ts', // COVERAGE_BLOCK_HEADING — the library-owned limits block
      'core/agent/coverage/read.ts', // servedToModel — what the record-only strip serves
      'core/agent/evidence/gate.ts', // MAX_REPORTED_VALUES — the event's cap on `unsupported`
    ]);
  });
});

describe('RUNTIME TRAP — no network, no timer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fixtures A, A0 and B: fetch / XMLHttpRequest / WebSocket never touched, no timer scheduled', () => {
    const trap = (name: string) =>
      vi.fn(() => {
        throw new Error(`${name} was called by the answer account`);
      });
    const fetch = trap('fetch');
    const xhr = trap('XMLHttpRequest');
    const ws = trap('WebSocket');
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('WebSocket', ws);
    const timers = [
      vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
      vi.spyOn(globalThis, 'setImmediate'),
      vi.spyOn(globalThis, 'queueMicrotask'),
    ];
    const cases = [
      [fixtureA(), NEO_DECLARATIONS],
      [fixtureA(), undefined],
      [fixtureB(), NEO_DECLARATIONS],
    ] as const;
    for (const [recording, declarations] of cases) {
      const account = accountForAnswer(recording, declarations, { runId: FLAGSHIP_RUN_ID });
      showLeaves(account, recording, declarations);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(ws).not.toHaveBeenCalled();
    for (const t of timers) expect(t).not.toHaveBeenCalled();
  });

  it('pure: no clock is read — the same inputs give the same bytes a second later', () => {
    const now = vi.spyOn(Date, 'now');
    const one = JSON.stringify(
      accountForAnswer(fixtureA(), NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID }),
    );
    expect(now).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    expect(
      JSON.stringify(accountForAnswer(fixtureA(), NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID })),
    ).toBe(one);
    vi.useRealTimers();
  });
});
