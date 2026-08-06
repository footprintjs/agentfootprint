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

  it('per-adapter memory aliases stayed removed (collapsed in 4.0.0)', () => {
    const exp = loadExports();
    // ./memory-redis + ./memory-agentcore collapsed into ./memory-providers,
    // which 8.0.0 in turn folded into ./memory. They do not come back.
    expect(exp['./memory-redis']).toBeUndefined();
    expect(exp['./memory-agentcore']).toBeUndefined();
  });

  it('./providers is back in 8.0.0 — as a DOOR, not the old per-vendor alias', () => {
    const exp = loadExports();
    // 4.0.0 removed `./providers` as a one-file alias of ./llm-providers.
    // 8.0.0 reintroduces the name for a different, bigger job: every "plug in
    // a backend" surface behind one door. It resolves to its own barrel, NOT
    // to the llm-providers file the 4.0.0 alias pointed at.
    expect(exp['./providers']).toBeDefined();
    expect(exp['./providers'].require.default).toBe('./dist/doors/providers.js');
    expect(exp['./providers'].require.default).not.toBe('./dist/llm-providers.js');
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

// ─── 8.0.0 — the door map ─────────────────────────────────────────

describe('8.0.0 door map — every path a consumer can type still resolves', () => {
  function loadPkg(): {
    exports: Record<string, { import: { types: string; default: string } } | string>;
    typesVersions: Record<string, Record<string, string[]>>;
  } {
    return JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
  }

  /** The 10 canonical doors. `./cache` and `./events` stand alone by design. */
  const DOORS = [
    '.',
    './providers',
    './memory',
    './cache',
    './observe',
    './events',
    './context',
    './resilience',
    './hosting',
    './security',
  ];

  /** Every path 7.x consumers could type. NONE of these may ever disappear
   *  during 8.x — that is the whole promise of the consolidation. */
  const SEVEN_X_PATHS = [
    '.',
    './cache',
    './events',
    './memory',
    './llm-providers',
    './memory-providers',
    './strategies',
    './observability-providers',
    './observe',
    './debug',
    './debug/finders',
    './observability/contextError/finders',
    './resilience',
    './stream',
    './injection-engine',
    './tool-providers',
    './security',
    './identity',
    './hosting',
    './hosting-providers',
    './reliability',
    './thinking',
    './locales',
    './status',
    './embedders',
    './package.json',
  ];

  it('every 7.x import path still resolves in 8.x', () => {
    const exp = loadPkg().exports;
    for (const path of SEVEN_X_PATHS) {
      expect(exp[path], `${path} worked in 7.x and must keep working`).toBeDefined();
    }
  });

  it('every door is present and points at a real barrel', () => {
    const exp = loadPkg().exports;
    for (const door of DOORS) expect(exp[door], `door ${door} missing`).toBeDefined();
  });

  it('the two doors added in 8.0.0 are exactly ./providers and ./context', () => {
    const exp = loadPkg().exports;
    const added = Object.keys(exp).filter((k) => !SEVEN_X_PATHS.includes(k));
    expect(added.sort()).toEqual(['./context', './providers']);
  });

  it('typesVersions covers every non-root export path (TS < 4.7 fallback)', () => {
    const pkg = loadPkg();
    const tv = pkg.typesVersions['*'];
    for (const key of Object.keys(pkg.exports)) {
      if (key === '.' || key === './package.json') continue;
      expect(tv[key.slice(2)], `typesVersions missing ${key}`).toBeDefined();
    }
  });

  it('typesVersions agrees with the require condition, entry for entry', () => {
    const pkg = loadPkg();
    const tv = pkg.typesVersions['*'];
    for (const [key, entry] of Object.entries(pkg.exports)) {
      if (key === '.' || key === './package.json' || typeof entry === 'string') continue;
      const fromExports = (entry as { require: { types: string } }).require.types;
      expect(tv[key.slice(2)], `typesVersions drifted for ${key}`).toEqual([fromExports]);
    }
  });

  it('the manifest declares its module type and a full git URL (publint)', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
      type: string;
      repository: { url: string };
    };
    // The root build is CJS; dist/esm carries its own {"type":"module"}.
    expect(pkg.type).toBe('commonjs');
    expect(pkg.repository.url).toMatch(/^git\+https:\/\//);
  });
});
