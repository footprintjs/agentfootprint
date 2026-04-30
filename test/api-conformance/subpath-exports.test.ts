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
    return pkg.exports as Record<
      string,
      { types?: string; import?: string; require?: string }
    >;
  }

  it('canonical subpaths are present', () => {
    const exp = loadExports();
    expect(exp['./llm-providers']).toBeDefined();
    expect(exp['./memory-providers']).toBeDefined();
    expect(exp['./tool-providers']).toBeDefined();
    expect(exp['./security']).toBeDefined();
  });

  it('legacy aliases preserved (back-compat through v2.x)', () => {
    const exp = loadExports();
    expect(exp['./providers']).toBeDefined();
    expect(exp['./memory-redis']).toBeDefined();
    expect(exp['./memory-agentcore']).toBeDefined();
  });

  it('every exports entry has types + import + require triple', () => {
    const exp = loadExports();
    for (const [key, entry] of Object.entries(exp)) {
      if (key === '.') continue; // root
      expect(entry.types, `missing types for ${key}`).toBeDefined();
      expect(entry.import, `missing import for ${key}`).toBeDefined();
      expect(entry.require, `missing require for ${key}`).toBeDefined();
    }
  });

  it('canonical subpath dist paths follow predictable conventions', () => {
    const exp = loadExports();
    expect(exp['./llm-providers'].types).toBe('./dist/types/llm-providers.d.ts');
    expect(exp['./llm-providers'].import).toBe('./dist/esm/llm-providers.js');
    expect(exp['./memory-providers'].types).toBe('./dist/types/memory-providers.d.ts');
    expect(exp['./memory-providers'].import).toBe('./dist/esm/memory-providers.js');
  });
});
