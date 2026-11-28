import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  isPaused,
  sealToolEffectContent,
} from '../../../src/index.js';
import { defineInstruction } from '../../../src/injection-engine.js';
import { bearer } from '../../../src/identity.js';
import { mock } from '../../../src/providers.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

const instruction = defineInstruction({
  id: 'fixture-note',
  prompt: 'Fixture context only.',
  activeWhen: () => false,
});

describe('typed effect settlement in the native Agent', () => {
  it.each([
    ['batch', 'no-hook'],
    ['batch', 'untouched'],
    ['batch', 'unowned'],
    ['batch', 'rewrite'],
    ['batch', 'admit'],
    ['batch', 'withhold'],
    ['ask', 'untouched'],
    ['ask', 'unowned'],
    ['ask', 'rewrite'],
    ['ask', 'admit'],
    ['ask', 'withhold'],
    ['check-in', 'untouched'],
    ['check-in', 'rewrite'],
    ['check-in', 'admit'],
    ['check-in', 'withhold'],
    ['credential', 'untouched'],
    ['credential', 'rewrite'],
    ['credential', 'admit'],
    ['credential', 'withhold'],
  ] as const)('%s %s', async (door, policy) => {
    const content =
      policy === 'no-hook' || policy === 'unowned'
        ? { summary: 'original' }
        : sealToolEffectContent('{"summary":"original"}');
    let calls = 0;
    let ready = false;
    let delivered = '';
    const observed: unknown[] = [];
    const evaluated: boolean[] = [];
    const builder = Agent.create({
      model: 'fixture',
      provider: mock({
        respond: (request) => {
          const tool = request.messages.find((entry) => entry.role === 'tool');
          if (tool) {
            delivered = String(tool.content);
            return { content: 'done' };
          }
          return { toolCalls: [{ id: 'fixture', name: 'lookup', args: {} }] };
        },
      }),
      ...(door === 'credential' && {
        credentials: {
          id: 'fixture',
          getCredential: async () =>
            ready
              ? { status: 'issued' as const, credential: bearer('inert-fixture') }
              : {
                  status: 'authorization-required' as const,
                  authorizationUrl: 'https://example.invalid/fixture',
                  sessionId: 'fixture',
                },
        },
      }),
    })
      .injection(instruction)
      .tool(
        defineTool({
          name: 'lookup',
          description: 'An inert fixture',
          inputSchema: { type: 'object', properties: {} },
          ...(door === 'check-in' && { checkIn: 'always' as const }),
          ...(door === 'credential' && { needs: { credential: 'fixture' } }),
          execute: () => {
            calls++;
            return {
              content,
              effects: [
                {
                  kind: 'require-instruction',
                  instructionId: 'fixture-note',
                  deliveryLease: 'next-call',
                },
              ],
            };
          },
        }),
      );
    if (door === 'ask')
      builder.toolMiddleware({
        name: 'fixture-approval',
        onToolCall: () => ask({ question: 'Run the fixture?' }),
      });
    if (policy !== 'no-hook')
      builder.toolMiddleware({
        name: 'fixture-result',
        onToolResult: () => {
          if (policy === 'withhold') return deny('Withheld by fixture policy.');
          if (policy === 'untouched' || policy === 'unowned') return allow();
          return allow('replacement', 'Summarize the inert result.');
        },
        ...(policy === 'admit' && {
          admitToolResultEffects({ content, proposals }) {
            expect(content).toBe('replacement');
            return proposals;
          },
        }),
      });
    const agent = builder.build();
    agent.on('agentfootprint.tools.effect', (event) => observed.push(event.payload));
    agent.on('agentfootprint.context.evaluated', (event) => {
      evaluated.push(event.payload.activeIds.includes('fixture-note'));
    });
    const result = await agent.run({ message: 'Run the fixture.' });
    if (door === 'batch') expect(isPaused(result)).toBe(false);
    else {
      if (!isPaused(result)) throw new Error('Fixture did not reach native pause.');
      expect(calls).toBe(0);
      ready = true;
      const answer =
        door === 'credential'
          ? 'Fixture authorized.'
          : checkInApproved({ request: pausedRequest(result), by: 'fixture' });
      await agent.resume(JSON.parse(JSON.stringify(result.checkpoint)), answer);
    }
    expect(calls).toBe(1);
    if (policy === 'withhold') expect(delivered).toBe('Withheld by fixture policy.');
    else if (policy === 'admit' || policy === 'rewrite') expect(delivered).toBe('replacement');
    else expect(delivered).toBe('{"summary":"original"}');
    const admitted = policy === 'untouched' || policy === 'admit' || policy === 'no-hook';
    expect(evaluated.includes(true)).toBe(admitted);
    const decisions = agent.getLastSnapshot()?.sharedState as {
      middlewareDecisions?: readonly { resultEffects?: { disposition: string } }[];
    };
    const settlement = decisions.middlewareDecisions?.find(
      (row) => row.resultEffects,
    )?.resultEffects;
    expect(settlement?.disposition).toBe(
      policy === 'no-hook' ? undefined : admitted ? 'admitted' : 'suppressed',
    );
    if (policy === 'untouched' || policy === 'admit' || policy === 'no-hook')
      expect(observed).toMatchObject([{ outcome: 'accepted', instructionId: 'fixture-note' }]);
    else expect(observed).toEqual([]);
  });
});
