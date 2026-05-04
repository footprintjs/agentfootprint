#!/usr/bin/env node
/**
 * check-dup-types.mjs — Detects duplicate exported type/interface names across src/.
 *
 * Mirrors the footprintjs check. A type defined in two files with different shapes
 * can cause structural mismatches at the barrel boundary.
 *
 * Usage: node scripts/check-dup-types.mjs
 *
 * Allowlist: types that intentionally appear in multiple files (e.g. re-exports,
 * or cases where different layers define same-named types with different shapes).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Types allowed to appear in more than one file.
// Each entry explains WHY it's exempt.
const ALLOWLIST = new Set([
  'LLMClaim',
  // explain.barrel.ts re-exports from ExplainRecorder (recorder-level type).
  // Now only one definition exists; allowlisted defensively.

  'LLMCallOptions',
  // concepts/LLMCall.ts = builder-level options (provider, system, etc.).
  // types/llm.ts = core LLM call options (model, temperature, etc.).
  // Different layers, different shapes. Builder wraps core.

  'AgentLoopConfig',
  // core/config.ts = public simplified config (what consumers pass).
  // lib/loop/types.ts = internal resolved config (all fields required, defaults applied).
  // Consolidation blocked by circular dep (core ← lib).

  'AgentLoopResult',
  // executor/agentLoop.ts = public result type (content, iterations, finishReason).
  // lib/loop/buildAgentLoop.ts = internal result extending AgentLoopBuild (adds runtime state).
  // The internal one extends the public one — different shapes by design.

  'CircuitState',
  // resilience/withCircuitBreaker.ts (v2.10.x) = provider-decorator closure API.
  // reliability/CircuitBreaker.ts (v2.11.1+) = pure state-machine functions.
  // SAME shape ('closed' | 'open' | 'half-open'); both coexist until v3.x
  // removes resilience/ entirely. Wire format identical.

  'CircuitOpenError',
  // resilience/withCircuitBreaker.ts (v2.10.x) = thrown by closure wrapper;
  //   constructor takes (name, cause: unknown, retryAfter).
  // reliability/CircuitBreaker.ts (v2.11.1+) = thrown by pure assertAdmit;
  //   constructor takes (name, lastErrorMessage: string|undefined, retryAfter).
  // Both expose code: 'ERR_CIRCUIT_OPEN' + retryAfter — `err.code` works
  // against either; `instanceof` is class-specific. Coexist until v3.x.
]);

const ROOT = new URL('../src', import.meta.url).pathname;

/** Collect all .ts files under a directory recursively (excluding test files). */
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract locally-defined (not re-exported) type names from a file.
 * We match:
 *   export type Foo = ...
 *   export interface Foo { ...
 * but NOT:
 *   export type { Foo } from ...   ← re-export, not a definition
 *   export type { Foo as Bar }     ← rename re-export
 */
function extractDefinedTypes(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const names = [];

  // export type Foo = ... or export type Foo<T> = ...
  for (const m of src.matchAll(/^export\s+type\s+([A-Z][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*=/gm)) {
    names.push(m[1]);
  }
  // export interface Foo { ...
  for (const m of src.matchAll(/^export\s+interface\s+([A-Z][A-Za-z0-9_]*)\b/gm)) {
    names.push(m[1]);
  }

  return names;
}

const files = collectFiles(ROOT);

/** Map: typeName → list of file paths that define it */
const index = new Map();

for (const file of files) {
  for (const name of extractDefinedTypes(file)) {
    if (!index.has(name)) index.set(name, []);
    index.get(name).push(relative(ROOT, file));
  }
}

let found = 0;
for (const [name, paths] of index) {
  if (paths.length > 1 && !ALLOWLIST.has(name)) {
    console.error(`\nDuplicate type: ${name}`);
    for (const p of paths) console.error(`  src/${p}`);
    found++;
  }
}

if (found > 0) {
  console.error(`\n${found} duplicate type(s) found. Fix by consolidating to a single definition.`);
  console.error('If the duplicate is unavoidable, add it to ALLOWLIST in scripts/check-dup-types.mjs with an explanation.');
  process.exit(1);
} else {
  console.log(`check-dup-types: OK (${index.size} exported types, no duplicates)`);
}
