/**
 * Unit tests — the answer layer's event (honesty layer 4, `.answerLayer()`).
 *
 * Pattern: Test-as-specification.
 * Role:    Lock the name and the payload LAW: `agentfootprint.answer.assessed`
 *          is registered at every site the registry has (`EVENT_NAMES`,
 *          `AgentfootprintEventMap`, `ALL_EVENT_TYPES`), in the three-segment
 *          snake-case form the registry's own test demands, its domain has a
 *          wildcard AND a bridge (the credential-domain lesson: a domain with
 *          no bridge fires into silence), and its payload carries the standing
 *          as data ONLY — the value, the words, the reason kinds, the checks
 *          that ran, the turn and the iteration; never a value or a quote.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEventMap,
} from '../../../src/events/registry.js';
import type { DomainWildcard } from '../../../src/events/dispatcher.js';
import type { AnswerAssessedPayload } from '../../../src/events/payloads.js';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

describe('answer event — registered at every site', () => {
  it('EVENT_NAMES.answer names the one event in the three-segment form', () => {
    expect(EVENT_NAMES.answer).toEqual({ assessed: 'agentfootprint.answer.assessed' });
  });

  it('it is in ALL_EVENT_TYPES, directly after the ontology domain', () => {
    const list = [...ALL_EVENT_TYPES];
    const at = list.indexOf('agentfootprint.ontology.served');
    expect(at).toBeGreaterThan(-1);
    expect(list[at + 1]).toBe('agentfootprint.answer.assessed');
  });

  it('it is a key of AgentfootprintEventMap with its own payload type, and the domain has a wildcard', () => {
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.answer.assessed']['payload']
    >().toEqualTypeOf<AnswerAssessedPayload>();
    expectTypeOf<'agentfootprint.answer.*'>().toMatchTypeOf<DomainWildcard>();
  });
});

describe('answer event — the payload law, and the bridge', () => {
  it('assessed: the standing as data and its stamps — nothing the model or a tool wrote', () => {
    expectTypeOf<keyof AnswerAssessedPayload>().toEqualTypeOf<
      'assessment' | 'standing' | 'reasons' | 'checked' | 'turn' | 'iteration'
    >();
    expectTypeOf<AnswerAssessedPayload['turn']>().toEqualTypeOf<number>();
  });

  it('the bridge is attached under the arm: `agent.on("agentfootprint.answer.*")` hears it', async () => {
    const build = (armed: boolean) => {
      const b = Agent.create({
        provider: mock({
          replies: [{ toolCalls: [{ id: 'c1', name: 'look', args: {} }] }, { content: 'done' }],
        }),
        model: 'mock',
      }).tool(
        defineTool({
          name: 'look',
          description: 'look',
          inputSchema: { type: 'object', properties: {} },
          execute: () => [],
        }),
      );
      return (armed ? b.answerLayer() : b).build();
    };
    const armed = build(true);
    const heard: string[] = [];
    armed.on('agentfootprint.answer.*', (e) => heard.push(e.type));
    await armed.run({ message: 'go' });
    expect(heard).toEqual(['agentfootprint.answer.assessed']);

    const unarmed = build(false);
    const none: string[] = [];
    unarmed.on('*', (e) => {
      if (e.type.startsWith('agentfootprint.answer.')) none.push(e.type);
    });
    await unarmed.run({ message: 'go' });
    expect(none).toEqual([]);
  });
});
