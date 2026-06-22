/**
 * Subpath exports — Block B parallel-providers restructure.
 *
 * Verifies the four canonical subpaths and the legacy aliases all
 * resolve to working source files with the expected exports.
 *
 * 7-pattern matrix-lite (this is mechanical; the matrix here is
 * structure validation rather than logical scenarios):
 *
 *   - unit:        Each new subpath file exists and re-exports a known symbol
 *   - integration: Symbol identity is preserved across alias and canonical paths
 *                  (`providers.ts.mock === llm-providers.ts.mock`)
 *   - property:    package.json `exports` table has the canonical + legacy entries
 *   - security:    package.json `exports` field paths point at expected dist locations
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Source-level imports (canonical) ──────────────────────────────

import * as llmProviders from '../../src/llm-providers.js';
import * as memoryProviders from '../../src/memory-providers.js';
import * as toolProviders from '../../src/tool-providers/index.js';
import * as security from '../../src/security/index.js';

// ─── Source-level imports (legacy aliases) ─────────────────────────

import * as legacyProviders from '../../src/providers.js';
import * as legacyRedis from '../../src/adapters/memory/redis.js';
import * as legacyAgentcore from '../../src/adapters/memory/agentcore.js';

// ─── Tests ────────────────────────────────────────────────────────

describe('Block B — canonical subpath barrels expose expected symbols', () => {
  it('llm-providers exports mock + provider classes', () => {
    expect(typeof (llmProviders as { mock: unknown }).mock).toBe('function');
    // Anthropic / OpenAI / others are exported by name; spot-check one
    expect((llmProviders as Record<string, unknown>).MockProvider).toBeDefined();
  });

  it('memory-providers exports RedisStore + AgentCoreStore', () => {
    expect((memoryProviders as Record<string, unknown>).RedisStore).toBeDefined();
    expect((memoryProviders as Record<string, unknown>).AgentCoreStore).toBeDefined();
  });

  it('tool-providers exports staticTools + gatedTools + skillScopedTools', () => {
    expect(typeof (toolProviders as { staticTools: unknown }).staticTools).toBe('function');
    expect(typeof (toolProviders as { gatedTools: unknown }).gatedTools).toBe('function');
    expect(typeof (toolProviders as { skillScopedTools: unknown }).skillScopedTools).toBe(
      'function',
    );
  });

  it('security exports PermissionPolicy', () => {
    expect((security as Record<string, unknown>).PermissionPolicy).toBeDefined();
  });
});

describe('Block B — legacy aliases preserve symbol identity', () => {
  it('legacy providers === canonical llm-providers (same exports)', () => {
    // The new file is `export *` from providers.ts, so identities match
    expect((llmProviders as Record<string, unknown>).mock).toBe(
      (legacyProviders as Record<string, unknown>).mock,
    );
    expect((llmProviders as Record<string, unknown>).MockProvider).toBe(
      (legacyProviders as Record<string, unknown>).MockProvider,
    );
  });

  it('legacy memory-redis exposes same RedisStore as memory-providers', () => {
    expect((memoryProviders as Record<string, unknown>).RedisStore).toBe(
      (legacyRedis as Record<string, unknown>).RedisStore,
    );
  });

  it('legacy memory-agentcore exposes same AgentCoreStore as memory-providers', () => {
    expect((memoryProviders as Record<string, unknown>).AgentCoreStore).toBe(
      (legacyAgentcore as Record<string, unknown>).AgentCoreStore,
    );
  });
});

describe('Block B — package.json exports table', () => {
  function loadExports(): Record<string, { types?: string; import?: string; require?: string }> {
    const pkgPath = join(__dirname, '../../package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { exports?: Record<string, unknown> };
    return pkg.exports as Record<string, { types?: string; import?: string; require?: string }>;
  }

  it('canonical subpaths are present', () => {
    const exp = loadExports();
    expect(exp['./llm-providers']).toBeDefined();
    expect(exp['./memory-providers']).toBeDefined();
    expect(exp['./tool-providers']).toBeDefined();
    expect(exp['./security']).toBeDefined();
  });

  it('legacy alias subpaths removed in 4.0.0 (collapsed into canonical)', () => {
    const exp = loadExports();
    // ./providers collapsed into ./llm-providers; ./memory-redis +
    // ./memory-agentcore collapsed into ./memory-providers.
    expect(exp['./providers']).toBeUndefined();
    expect(exp['./memory-redis']).toBeUndefined();
    expect(exp['./memory-agentcore']).toBeUndefined();
  });

  it('every exports entry serves per-condition types (import→ESM, require→CJS)', () => {
    const exp = loadExports();
    for (const [key, entry] of Object.entries(exp)) {
      // The package.json self-reference is a plain string by Node
      // convention — it lets the library read its own version at
      // runtime (auditExport genesis records) and lets tooling
      // deep-import the manifest.
      if (key === './package.json') {
        expect(entry).toBe('./package.json');
        continue;
      }
      // Each condition carries its OWN context-correct types: the `import`
      // (ESM) condition points at ESM-context declarations, the `require`
      // (CJS) condition at CJS-context ones. A single flat `types` field
      // masquerades one module system's types as the other's (attw 🎭/👺).
      expect(entry.import?.types, `missing import.types for ${key}`).toBeDefined();
      expect(entry.import?.default, `missing import.default for ${key}`).toBeDefined();
      expect(entry.require?.types, `missing require.types for ${key}`).toBeDefined();
      expect(entry.require?.default, `missing require.default for ${key}`).toBeDefined();
    }
  });

  it('canonical subpath dist paths follow predictable conventions', () => {
    const exp = loadExports();
    // import → ESM build (dist/esm), require → CJS build (dist), each with
    // its matching-context .d.ts.
    expect(exp['./llm-providers'].import.types).toBe('./dist/esm/llm-providers.d.ts');
    expect(exp['./llm-providers'].import.default).toBe('./dist/esm/llm-providers.js');
    expect(exp['./llm-providers'].require.types).toBe('./dist/types/llm-providers.d.ts');
    expect(exp['./llm-providers'].require.default).toBe('./dist/llm-providers.js');
    expect(exp['./memory-providers'].import.types).toBe('./dist/esm/memory-providers.d.ts');
    expect(exp['./memory-providers'].require.default).toBe('./dist/memory-providers.js');
  });
});
