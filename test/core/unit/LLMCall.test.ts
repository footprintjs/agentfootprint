/**
 * Unit tests — LLMCall builder + isolated behavior.
 *
 * Scope: builder state transitions, defaults, validation.
 * Does NOT test end-to-end runs (those live in scenario/).
 */

import { describe, it, expect } from 'vitest';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

describe('LLMCall.create() + builder', () => {
  it('accepts minimum required options (provider + model)', () => {
    const inst = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    expect(inst).toBeDefined();
    expect(inst.id).toBe('llm-call');
    expect(inst.name).toBe('LLMCall');
  });

  it('accepts custom name + id', () => {
    const inst = LLMCall.create({
      provider: new MockProvider(),
      model: 'mock',
      name: 'MyLLM',
      id: 'my-llm-id',
    })
      .system('')
      .build();
    expect(inst.name).toBe('MyLLM');
    expect(inst.id).toBe('my-llm-id');
  });

  it('accepts optional temperature + maxTokens', () => {
    const inst = LLMCall.create({
      provider: new MockProvider(),
      model: 'mock',
      temperature: 0.7,
      maxTokens: 500,
    })
      .system('')
      .build();
    expect(inst).toBeDefined();
  });

  it('system prompt is optional (empty string allowed)', () => {
    const inst = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    expect(inst).toBeDefined();
  });

  it('build() can be called even without .system() (defaults to empty)', () => {
    const inst = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).build();
    expect(inst).toBeDefined();
  });
});

describe('LLMCall runner-contract compliance', () => {
  it('exposes .run() / .toFlowChart() / .on() / .off() / .once() / .attach() / .emit()', () => {
    const inst = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    expect(typeof inst.run).toBe('function');
    expect(typeof inst.toFlowChart).toBe('function');
    expect(typeof inst.on).toBe('function');
    expect(typeof inst.off).toBe('function');
    expect(typeof inst.once).toBe('function');
    expect(typeof inst.attach).toBe('function');
    expect(typeof inst.emit).toBe('function');
  });

  it('exposes enable.thinking and enable.logging namespaces', () => {
    const inst = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    expect(typeof inst.enable.thinking).toBe('function');
    expect(typeof inst.enable.logging).toBe('function');
  });

  it('toFlowChart() returns a defined chart object (composable)', () => {
    const inst = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    const chart = inst.toFlowChart();
    expect(chart).toBeDefined();
    expect(typeof chart).toBe('object');
  });
});
