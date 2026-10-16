/**
 * Every LLM adapter honours cancellation — the shared conformance
 * (`abortConformance.ts`), run against one rig per factory (`rigs.ts`).
 *
 * The listing case reads `src/adapters/llm/` itself: every exported factory
 * that builds a provider must have a rig, so a new adapter cannot ship
 * without passing the same cases. The only factory with no wire is the mock.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abortConformance } from './abortConformance.js';
import { ADAPTER_RIGS } from './rigs.js';

const LLM_DIR = join(__dirname, '..', '..', '..', 'src', 'adapters', 'llm');

/**
 * Factories that are not adapters of their own, each with its reason. The
 * list only shrinks.
 */
const NOT_ADAPTERS: Readonly<Record<string, string>> = {
  createProvider: 'a router: it returns one of the listed factories, chosen by `kind`',
};

/** Every `export function <name>(…): LLMProvider | MockProvider` in the folder. */
function exportedFactories(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(LLM_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(LLM_DIR, file), 'utf8');
    const pattern =
      /^export function (\w+)\s*\([^)]*\)\s*:\s*(?:LLMProvider|MockProvider)\s*[;{]/gm;
    for (const match of source.matchAll(pattern)) names.add(match[1]!);
  }
  return [...names].sort();
}

describe('cancellation conformance — the listing', () => {
  it('finds the factories it lists (the scan itself works)', () => {
    const found = exportedFactories();
    expect(found).toEqual(expect.arrayContaining(['anthropic', 'openai', 'ollama', 'mock']));
  });

  it('every LLM adapter factory under src/adapters/llm/ has a rig', () => {
    const rigged = new Set(ADAPTER_RIGS.map((r) => r.factory));
    const missing = exportedFactories().filter((f) => !rigged.has(f) && !(f in NOT_ADAPTERS));
    expect(missing, 'add a rig in test/adapters/conformance/rigs.ts').toEqual([]);
  });

  it('every rig names a factory that exists, and only the mock rides no wire', () => {
    const factories = new Set(exportedFactories());
    for (const rig of ADAPTER_RIGS) {
      expect(factories.has(rig.factory), rig.factory).toBe(true);
      if (rig.transport === 'none') expect(rig.factory).toBe('mock');
    }
  });
});

for (const rig of ADAPTER_RIGS) {
  const label = rig.variant === undefined ? rig.factory : `${rig.factory} (${rig.variant})`;
  describe(`cancellation conformance — ${label}`, () => {
    abortConformance(rig);
  });
}
