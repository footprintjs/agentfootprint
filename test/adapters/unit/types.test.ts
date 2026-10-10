/**
 * Unit tests — adapter interfaces (structural typing conformance).
 *
 * These are compile-time contracts; runtime-side we just assert that a
 * minimal concrete implementation of each interface is structurally
 * assignable to the port.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LLMProvider,
  MemoryStore,
  PermissionChecker,
  PricingTable,
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

/** Type regression tests separately prove absence through the public root door. */
describe('removed unused adapter ports', () => {
  const source = readFileSync(join(__dirname, '../../../src/adapters/types.ts'), 'utf8');
  for (const name of [
    'ResolveCtx',
    'ContextContribution',
    'ContextSourceAdapter',
    'EmbeddingProvider',
    'RiskContext',
    'RiskResult',
    'RiskDetector',
  ]) {
    it(`${name} has no private declaration left behind`, () => {
      expect(source).not.toMatch(new RegExp(`\\b(?:interface|type|class)\\s+${name}\\b`));
    });
  }
});
