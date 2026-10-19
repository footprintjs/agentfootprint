/**
 * Every LLM adapter honours cancellation — the shared conformance
 * (`abortConformance.ts`), run against one rig per factory (`rigs.ts`).
 *
 * The listing cases read `src/adapters/llm/` itself and FAIL CLOSED: every
 * runtime export of the folder must have a rig, be named as no adapter (with
 * its reason), or live in a named helper file — so a new adapter, or a new
 * file, cannot ship without passing the same cases. The only rigs with no
 * wire are the mock's.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abortConformance } from './abortConformance.js';
import { ADAPTER_RIGS } from './rigs.js';

const LLM_DIR = join(__dirname, '..', '..', '..', 'src', 'adapters', 'llm');

/**
 * Runtime exports of the folder that are not adapters, each with its reason.
 * Every OTHER runtime export of a provider file must have a rig. The list only
 * shrinks.
 */
const NOT_ADAPTERS: Readonly<Record<string, string>> = {
  createProvider: 'a router: it returns one of the rigged factories, chosen by `kind`',
  providerFromEnv: 'a router: `createProvider` over the environment',
  foundryInferenceUrl: 'a URL helper for the Foundry door',
  entraBearerToken: 'a credential helper (`openai()`’s per-request token)',
  INVOKE_MODEL_ANTHROPIC_VERSION: 'a wire constant',
  FoundryLocalUnavailableError: 'an error class',
  OllamaUnavailableError: 'an error class',
  InvokeModelGatewayError: 'an error class',
};

/**
 * Files that build no provider: the wires and tables the adapters share. A NEW
 * file in the folder fails until it is rigged or named here with its reason.
 */
const HELPER_FILES: Readonly<Record<string, string>> = {
  'anthropicCacheWire.ts': 'cache-marker wire for the Anthropic body',
  'anthropicMessageProjection.ts': 'messages-to-wire projection',
  'anthropicMessagesWire.ts': 'the shared Anthropic body and SSE assembly',
  'anthropicModels.ts': 'the Claude model-facts table',
  'anthropicReplayLayout.ts': 'thinking-replay content layout',
  'anthropicThinkingReplay.ts': 'thinking-replay preparation',
  'anthropicThinkingWire.ts': 'thinking request shapes per model',
  'anthropicToolArguments.ts': 'streamed tool-argument checks',
  'azureUrl.ts': 'Azure URL composition',
  'bedrockCacheWire.ts':
    'synchronous cache-marker projection, usage reading and capability lookup; no client, I/O or provider construction',
  'bedrockModels.ts':
    'frozen model facts and synchronous exact-ID lookup; no client, I/O or provider construction',
  'googleGenAI.ts': 'the Google client resolver both Gemini doors share',
  'retryAfter.ts': 'Retry-After parsing',
  'wireManifest.ts': 'the manifest read back from a serialized body',
};

const RUNTIME_EXPORT =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class)\s+(\w+)/gm;
/** Export forms the name scan cannot read: a file using one must be a helper file. */
const OPAQUE_EXPORT = /^export\s*(?:\{|\*|default\b)/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** Every runtime export of every file, as `{ file, name }`. */
function runtimeExports(): { file: string; name: string; opaque: boolean }[] {
  return sourceFiles(LLM_DIR).flatMap((full) => {
    const file = relative(LLM_DIR, full);
    const source = readFileSync(full, 'utf8');
    const names = [...new Set([...source.matchAll(RUNTIME_EXPORT)].map((m) => m[1]!))];
    const opaque = OPAQUE_EXPORT.test(source);
    return [
      ...names.map((name) => ({ file, name, opaque: false })),
      ...(opaque ? [{ file, name: '<export { … } / * / default>', opaque: true }] : []),
    ];
  });
}

describe('cancellation conformance — the listing (fails closed)', () => {
  it('the scan reads the folder (it finds what it should)', () => {
    const names = runtimeExports().map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(['anthropic', 'AnthropicProvider', 'openai', 'ollama', 'mock']),
    );
  });

  it('every runtime export is rigged, or named as no adapter, or lives in a helper file', () => {
    const rigged = new Set(ADAPTER_RIGS.map((r) => r.factory));
    const unclassified = runtimeExports()
      .filter((e) => !(e.file in HELPER_FILES))
      .filter((e) => e.opaque || (!rigged.has(e.name) && !(e.name in NOT_ADAPTERS)))
      .map((e) => `${e.file} · ${e.name}`);
    expect(
      unclassified,
      'add a rig in test/adapters/conformance/rigs.ts (or name it, with its reason, above)',
    ).toEqual([]);
  });

  it('no helper file builds a provider class (checked at run time, not by name)', async () => {
    const offenders: string[] = [];
    for (const file of Object.keys(HELPER_FILES)) {
      const mod = (await import(join(LLM_DIR, file))) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        const proto = (value as { prototype?: { complete?: unknown } } | null)?.prototype;
        if (typeof value === 'function' && typeof proto?.complete === 'function') {
          offenders.push(`${file} · ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the lists are not stale: every helper file exists, every named export still does', () => {
    const files = new Set(sourceFiles(LLM_DIR).map((f) => relative(LLM_DIR, f)));
    for (const file of Object.keys(HELPER_FILES)) expect(files.has(file), file).toBe(true);
    const names = new Set(runtimeExports().map((e) => e.name));
    for (const name of Object.keys(NOT_ADAPTERS)) expect(names.has(name), name).toBe(true);
  });

  it('every rig names an export that exists, and only the mock rides no wire', () => {
    const names = new Set(runtimeExports().map((e) => e.name));
    for (const rig of ADAPTER_RIGS) {
      expect(names.has(rig.factory), rig.factory).toBe(true);
      if (rig.transport === 'none') expect(['mock', 'MockProvider']).toContain(rig.factory);
    }
  });

  it('Bedrock providers remain rigged; only their pure cache helpers are classified as helpers', () => {
    expect(HELPER_FILES).not.toHaveProperty('BedrockProvider.ts');
    for (const factory of ['bedrock', 'BedrockProvider']) {
      expect(NOT_ADAPTERS).not.toHaveProperty(factory);
      const rig = ADAPTER_RIGS.find((entry) => entry.factory === factory);
      expect(rig, factory).toBeDefined();
      expect(rig?.transport).not.toBe('none');
    }
  });
});

for (const rig of ADAPTER_RIGS) {
  const label = rig.variant === undefined ? rig.factory : `${rig.factory} (${rig.variant})`;
  describe(`cancellation conformance — ${label}`, () => {
    abortConformance(rig);
  });
}
