import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/index.js';
import { InMemoryStore } from '../../../src/memory/store/index.js';
import {
  eventsFor,
  fixture,
  modes,
  publicText,
  read,
  response,
  textDelta,
} from './bedrockGuardrailFixtures.js';

describe('unconfigured intrinsic intervention admission', () => {
  for (const classDoor of [false, true]) {
    for (const mode of modes) {
      for (const code of ['guardrail_intervened', 'content_filtered']) {
        it(`${mode}, class=${classDoor}: ${code} is unknown and never final memory`, async () => {
          const fx = fixture({
            classDoor,
            guardrail: null,
            complete: response(undefined, code),
            events: eventsFor(undefined, code),
          });
          const { result, chunks } = await read(fx.provider, mode);
          expect(result.intervention).toEqual({ outcome: 'unknown', code, filters: [] });
          expect(result.content).toBe('');
          expect(result.toolCalls).toEqual([]);
          // The unconfigured stream may already have served this prefix. Its
          // terminal refusal cannot recall it or admit it as a final answer.
          if (mode === 'stream')
            expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.content)).toEqual([
              publicText,
            ]);
          expect(fx.send).toHaveBeenCalledTimes(1);

          const store = new InMemoryStore();
          const identity = { conversationId: `${mode}-${classDoor}-${code}` };
          const agent = Agent.create({
            provider: {
              name: 'scripted-bedrock',
              complete: async (request) => (await read(fx.provider, mode, request)).result,
            },
            model: 'bedrock',
          })
            .memory(
              defineMemory({
                id: 'turns',
                type: MEMORY_TYPES.EPISODIC,
                strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
                store,
              }),
            )
            .build();
          await expect(agent.run({ message: 'hello', identity })).rejects.toMatchObject({
            code: 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
          });
          expect((await store.list(identity)).entries).toHaveLength(0);
          expect(fx.send).toHaveBeenCalledTimes(2);
        });
      }

      it(`${mode}, class=${classDoor}: ordinary unconfigured output stays usable`, async () => {
        const fx = fixture({
          classDoor,
          guardrail: null,
          complete: response(undefined, 'end_turn'),
          events: eventsFor(undefined, 'end_turn'),
        });
        const { result } = await read(fx.provider, mode);
        expect(result.content).toBe(publicText);
        expect(result.intervention).toBeUndefined();
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }

    it(`stream, class=${classDoor}: intrinsic refusal precedes malformed tool parsing`, async () => {
      const fx = fixture({
        classDoor,
        guardrail: null,
        events: eventsFor(undefined, 'content_filtered', [
          textDelta(),
          {
            contentBlockStart: {
              contentBlockIndex: 1,
              start: { toolUse: { toolUseId: 'call-1', name: 'act' } },
            },
          },
          { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{' } } } },
          { contentBlockStop: { contentBlockIndex: 1 } },
        ]),
      });
      const { result } = await read(fx.provider, 'stream');
      expect(result.intervention?.outcome).toBe('unknown');
      expect(result.toolCalls).toEqual([]);
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
  }
});
