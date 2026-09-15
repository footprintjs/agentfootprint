import { describe, expect, it } from 'vitest';
import { Agent, LLMCall } from '../../src/index.js';
import * as main from '../../src/index.js';
import {
  CONTEXT_FIELD_MEANINGS,
  contextContractForModel,
  defineSteering,
} from '../../src/doors/context.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import type { LLMRequest } from '../../src/adapters/types.js';

const context = {
  objective: 'Describe the recorded queue state.',
  completionRequirements: ['Use only this snapshot; retain missing coverage.'],
  scope: { snapshot: 'snapshot:one', queue: 'queue:A' },
  facts: [{ waiting: 0, oldestAgeSeconds: null, evidenceRef: 'evidence:queue:A' }],
  limitations: ['Worker health was not checked.'],
  evidenceRefs: ['evidence:queue:A'],
  nextSteps: ['Inspect worker health if authorized.'],
  domainDefinitions: { waiting: 'Number of queued jobs in this snapshot.' },
};

describe('outer context field contract', () => {
  it('exports only through the context door, with immutable named field meanings', () => {
    expect(Object.keys(CONTEXT_FIELD_MEANINGS).sort()).toEqual(
      [
        'facts',
        'limitations',
        'scope',
        'evidenceRefs',
        'nextSteps',
        'domainDefinitions',
        'objective',
        'completionRequirements',
      ].sort(),
    );
    expect(Object.isFrozen(CONTEXT_FIELD_MEANINGS)).toBe(true);
    expect(Reflect.set(CONTEXT_FIELD_MEANINGS, 'facts', 'Everything is true.')).toBe(false);
    expect(main).not.toHaveProperty('CONTEXT_FIELD_MEANINGS');
    expect(main).not.toHaveProperty('contextContractForModel');
  });

  it('formats each authoritative definition exactly once in a small deterministic guide', () => {
    const guide = contextContractForModel();
    for (const [field, meaning] of Object.entries(CONTEXT_FIELD_MEANINGS)) {
      expect(guide.split(`${field}: ${meaning}`)).toHaveLength(2);
    }
    expect(contextContractForModel()).toBe(guide);
    expect(new TextEncoder().encode(guide).length).toBeLessThan(2200);
  });

  it('keeps scoped observations, missing evidence and unresolved references distinct', () => {
    expect(CONTEXT_FIELD_MEANINGS.facts).toMatch(/sourced.*scoped/i);
    expect(CONTEXT_FIELD_MEANINGS.facts).toMatch(/not universal/i);
    expect(CONTEXT_FIELD_MEANINGS.limitations).toMatch(/absence.*healthy/i);
    expect(CONTEXT_FIELD_MEANINGS.limitations).toMatch(/no conflict.*complete/i);
    expect(CONTEXT_FIELD_MEANINGS.evidenceRefs).toMatch(/resolve/i);
    expect(CONTEXT_FIELD_MEANINGS.evidenceRefs).toMatch(/not evidence/i);
    expect(CONTEXT_FIELD_MEANINGS.scope).toMatch(/snapshot|version/i);
  });

  it('distinguishes task requirements and proposed work from observations and authorization', () => {
    expect(CONTEXT_FIELD_MEANINGS.nextSteps).toMatch(/not executed/i);
    expect(CONTEXT_FIELD_MEANINGS.nextSteps).toMatch(/not.*authorization/i);
    expect(CONTEXT_FIELD_MEANINGS.domainDefinitions).toMatch(/not.*observations/i);
    expect(CONTEXT_FIELD_MEANINGS.objective).toMatch(/not.*result/i);
    expect(CONTEXT_FIELD_MEANINGS.completionRequirements).toMatch(/not.*satisfied/i);
    expect(contextContractForModel()).toMatch(/application.*instruction/i);
    expect(contextContractForModel()).toMatch(/data.*not.*instructions/i);
  });
});

describe('context contract opt-in at the native provider boundary', () => {
  it('uses the existing system slot and preserves the caller JSON exactly', async () => {
    const requests: LLMRequest[] = [];
    const provider = new MockProvider({
      respond: (request) => {
        requests.push(request);
        return 'All workers are healthy.';
      },
    });
    const guide = contextContractForModel();
    const message = JSON.stringify(context);
    const call = LLMCall.create({ provider, model: 'mock' }).system(guide).build();
    // Guidance does not validate or rewrite a model's unsupported answer.
    expect(await call.run({ message })).toBe('All workers are healthy.');
    expect(requests).toHaveLength(1);
    expect(requests[0].systemPrompt).toBe(guide);
    expect(requests[0].messages.filter((entry) => entry.role === 'user')).toEqual([
      { role: 'user', content: message },
    ]);
    expect(JSON.parse(message).facts[0]).toEqual(context.facts[0]);
  });

  it('also composes with existing Agent steering without injecting a second copy', async () => {
    const requests: LLMRequest[] = [];
    const provider = new MockProvider({
      respond: (request) => {
        requests.push(request);
        return 'No worker-health evidence was supplied.';
      },
    });
    const guide = contextContractForModel();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 1 })
      .steering(defineSteering({ id: 'outer-context-contract', prompt: guide }))
      .build();
    await agent.run({ message: JSON.stringify(context) });
    expect(requests).toHaveLength(1);
    expect(requests[0].systemPrompt?.split(guide)).toHaveLength(2);
    expect(requests[0].messages.some((entry) => entry.content === JSON.stringify(context))).toBe(
      true,
    );
  });

  it('does not recognize or transform matching JSON fields when the caller does not opt in', async () => {
    const requests: LLMRequest[] = [];
    const provider = new MockProvider({
      respond: (request) => {
        requests.push(request);
        return 'Unchanged reply.';
      },
    });
    const call = LLMCall.create({ provider, model: 'mock' })
      .system('Application baseline.')
      .build();
    expect(await call.run({ message: JSON.stringify(context) })).toBe('Unchanged reply.');
    expect(requests[0].systemPrompt).toBe('Application baseline.');
    expect(requests[0].systemPrompt).not.toContain('completionRequirements:');
    expect(requests[0].messages.filter((entry) => entry.role === 'user')).toEqual([
      { role: 'user', content: JSON.stringify(context) },
    ]);
  });
});
