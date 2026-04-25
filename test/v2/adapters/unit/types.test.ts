/**
 * Unit tests — adapter interfaces (structural typing conformance).
 *
 * These are compile-time contracts; runtime-side we just assert that a
 * minimal concrete implementation of each interface is structurally
 * assignable to the port.
 */

import { describe, it, expect } from 'vitest';
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
