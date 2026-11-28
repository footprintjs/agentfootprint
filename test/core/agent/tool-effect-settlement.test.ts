import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  isPaused,
} from '../../../src/index.js';
import { defineInstruction, defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { bearer } from '../../../src/identity.js';
import { mock } from '../../../src/providers.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

const instruction = defineInstruction({
  id: 'fixture-note',
  prompt: 'Fixture context only.',
  activeWhen: () => false,
});

const triage = defineSkill({ id: 'triage', description: 'Fixture entry', body: 'Triage.' });
const followUp = defineSkill({
  id: 'follow-up',
  description: 'Fixture destination',
  body: 'Follow up.',
});
const graph = skillGraph().entry(triage).route(triage, followUp).build();

describe('typed effect settlement in the native Agent', () => {
  const doors = ['batch', 'ask', 'check-in', 'credential'] as const;
  const cases = [
    'no-hook',
    'pass-through',
    'immutable-content',
    'rewrite',
    'rewrite-shaped',
    'withhold',
  ] as const;
  it.each(doors.flatMap((door) => cases.map((policy) => [door, policy] as const)))(
    '%s %s',
    async (door, policy) => {
      const original = { summary: 'original' };
      const replacement = {
        content: 'later content',
        effects: [
          {
            kind: 'require-instruction',
            instructionId: 'fixture-note',
            deliveryLease: 'next-call',
          },
        ],
      };
      const content = policy === 'immutable-content' ? Object.freeze(original) : original;
      let calls = 0;
      let ready = false;
      let delivered = '';
      const observed: unknown[] = [];
      const activeIds = new Set<string>();
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
        .skillGraph(graph)
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
                  {
                    kind: 'propose-transition',
                    targetSkillId: 'follow-up',
                    reason: 'Synthetic follow-up.',
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
            if (policy === 'rewrite-shaped')
              return allow(replacement, 'Return result-shaped data.');
            if (policy !== 'rewrite') return allow();
            return allow('replacement', 'Summarize the inert result.');
          },
        });
      const agent = builder.build();
      agent.on('agentfootprint.tools.effect', (event) => observed.push(event.payload));
      agent.on('agentfootprint.context.evaluated', (event) => {
        for (const id of event.payload.activeIds) activeIds.add(id);
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
      else if (policy === 'rewrite') expect(delivered).toBe('replacement');
      else if (policy === 'rewrite-shaped') expect(delivered).toBe(JSON.stringify(replacement));
      else expect(delivered).toBe('{"summary":"original"}');
      const admitted = policy === 'no-hook';
      expect(activeIds.has('fixture-note')).toBe(admitted);
      expect(activeIds.has('follow-up')).toBe(admitted);
      const rows = agent.getLastSnapshot()?.sharedState.middlewareDecisions ?? [];
      const recorded = rows.flatMap((row) => (row.resultEffects ? [row.resultEffects] : []));
      expect(recorded).toEqual(admitted ? [] : [{ disposition: 'suppressed' }]);
      if (admitted)
        expect(observed).toMatchObject([
          { outcome: 'accepted', instructionId: 'fixture-note' },
          { outcome: 'accepted', targetSkillId: 'follow-up' },
        ]);
      else expect(observed).toEqual([]);
    },
  );
});
