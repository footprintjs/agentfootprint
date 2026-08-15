/**
 * Unit tests — adapter interfaces (structural typing conformance).
 *
 * These are compile-time contracts; runtime-side we just assert that a
 * minimal concrete implementation of each interface is structurally
 * assignable to the port.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ContextSourceAdapter,
  EmbeddingProvider,
  LLMProvider,
  MemoryStore,
  PermissionChecker,
  PricingTable,
  RiskDetector,
} from '../../../src/adapters/types.js';

describe('adapter interface conformance', () => {
  it('LLMProvider has name + complete + optional stream', () => {
    const impl: LLMProvider = {
      name: 'mock',
      complete: async () => ({
        content: '',
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
      }),
    };
    expect(impl.name).toBe('mock');
    expect(impl.stream).toBeUndefined();
  });

  it('MemoryStore has upsert/query/delete', () => {
    const impl: MemoryStore = {
      name: 'in-memory',
      upsert: async () => {},
      query: async () => [],
      delete: async () => {},
    };
    expect(impl.name).toBe('in-memory');
  });

  it('ContextSourceAdapter carries id + targetSlot + source + resolve', () => {
    const impl: ContextSourceAdapter = {
      id: 'rag-1',
      targetSlot: 'messages',
      source: 'rag',
      resolve: async () => [],
    };
    expect(impl.id).toBe('rag-1');
    expect(impl.targetSlot).toBe('messages');
    expect(impl.source).toBe('rag');
  });

  it('EmbeddingProvider has name + dimension + embed', () => {
    const impl: EmbeddingProvider = {
      name: 'openai-small',
      dimension: 1536,
      embed: async () => [[]],
    };
    expect(impl.dimension).toBe(1536);
  });

  it('RiskDetector has name + check', () => {
    const impl: RiskDetector = {
      name: 'llama-guard',
      check: async () => ({
        flagged: false,
        severity: 'low',
        category: 'pii',
        evidence: {},
        suggestedAction: 'warn',
      }),
    };
    expect(impl.name).toBe('llama-guard');
  });

  it('PermissionChecker has name + check', () => {
    const impl: PermissionChecker = {
      name: 'opa',
      check: async () => ({ result: 'allow' }),
    };
    expect(impl.name).toBe('opa');
  });

  it('PricingTable has name + pricePerToken', () => {
    const impl: PricingTable = {
      name: 'anthropic-2026',
      pricePerToken: () => 0.000003,
    };
    expect(impl.pricePerToken('claude-opus-4-7', 'input')).toBe(0.000003);
  });
});

// ─── The three ports with nowhere to plug in ───────────────────────

/**
 * `ContextSourceAdapter`, `EmbeddingProvider` and `RiskDetector` are exported
 * shapes that NOTHING in the library constructs, accepts or calls. The
 * conformance tests above still stand — the shapes are real and a consumer can
 * still satisfy them — but a consumer who satisfies one has nowhere to hand it.
 *
 * Two halves are pinned here, because either one alone rots:
 *
 *   1. STILL DEAD — if a real consumer ever appears, this test fails and
 *      whoever wired it up removes the deprecation instead of leaving a live
 *      seam marked "no implementation exists".
 *   2. STILL MARKED — the `@deprecated` tag survives, so the API reference and
 *      every editor keep telling the truth. Read from source rather than from a
 *      runtime value because an interface has no runtime existence to inspect.
 *
 * Deprecated and not deleted: they are on the root barrel, so removing them is
 * a compile break, and 9.x is additive-only. The removal is on the 10.0.0
 * ledger.
 */
describe('dormant adapter ports (deprecated, not deleted)', () => {
  const DORMANT_PORTS = ['ContextSourceAdapter', 'EmbeddingProvider', 'RiskDetector'] as const;
  const SATELLITES = ['ResolveCtx', 'ContextContribution', 'RiskContext', 'RiskResult'] as const;

  const typesSource = readFileSync(join(__dirname, '../../../src/adapters/types.ts'), 'utf-8');

  /** The declaration, plus every line of the doc comment attached to it. */
  function docCommentFor(name: string): string {
    const decl = typesSource.indexOf(`export interface ${name} {`);
    expect(decl, `${name} is no longer declared in adapters/types.ts`).toBeGreaterThan(-1);
    const commentStart = typesSource.lastIndexOf('/**', decl);
    const commentEnd = typesSource.lastIndexOf('*/', decl);
    // A declaration with no doc comment of its own would pick up the previous
    // symbol's — guard against reading a neighbour's tag as this one's.
    if (commentStart === -1 || commentEnd < commentStart) return '';
    return typesSource.slice(commentStart, commentEnd);
  }

  for (const name of [...DORMANT_PORTS, ...SATELLITES]) {
    it(`${name} is marked @deprecated`, () => {
      expect(docCommentFor(name)).toContain('@deprecated');
    });
  }

  for (const name of DORMANT_PORTS) {
    it(`${name} names the 10.0.0 ledger and says what to use instead`, () => {
      const doc = docCommentFor(name);
      expect(doc).toContain('10.0.0');
      // Not a style check: a deprecation that does not point somewhere leaves
      // the reader exactly as stuck as the dead port did.
      expect(doc.length, `${name}'s deprecation gives no alternative`).toBeGreaterThan(200);
    });
  }

  for (const name of DORMANT_PORTS) {
    it(`${name} is still consumed by nothing — the reason the deprecation stands`, () => {
      const hits = execFileSync(
        'grep',
        ['-rlw', '--include=*.ts', name, join(__dirname, '../../../src')],
        { encoding: 'utf-8' },
      )
        .split('\n')
        .filter((line) => line.length > 0);
      // Its own declaration file is the only legitimate hit. A second file
      // means someone wired it up; unmark it rather than deprecate a live seam.
      expect(hits.map((f) => f.replace(/^.*\/src\//, 'src/'))).toEqual(['src/adapters/types.ts']);
    });
  }
});
