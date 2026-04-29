/**
 * Property tests — pause/resume invariants that hold for any Agent + tool shape.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 0, output: content.length / 4 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

describe('property — every pause emits exactly one pause.request', () => {
  it.each(['simple', { x: 1 }, 'complex object', 42])(
    'for pauseData=%s, exactly 1 pause.request event fires',
    async (pauseData) => {
      const agent = Agent.create({
        provider: scripted(resp('', [{ id: 't', name: 'ask', args: {} }]), resp('done')),
        model: 'mock',
      })
        .system('')
        .tool({
          schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
          execute: () => {
            pauseHere(pauseData);
            return '';
          },
        })
        .build();

      let requests = 0;
      agent.on('agentfootprint.pause.request', () => requests++);

      const out = await agent.run({ message: 'hi' });
      expect(isPaused(out)).toBe(true);
      expect(requests).toBe(1);
    },
  );
});

describe('property — every resume emits exactly one pause.resume', () => {
  it('regardless of resume input shape', async () => {
    for (const input of ['str', 42, { a: 1 }, null]) {
      const agent = Agent.create({
        provider: scripted(resp('', [{ id: 't', name: 'ask', args: {} }]), resp('done')),
        model: 'mock',
      })
        .system('')
        .tool({
          schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
          execute: () => {
            pauseHere({});
            return '';
          },
        })
        .build();

      let resumes = 0;
      agent.on('agentfootprint.pause.resume', () => resumes++);

      const paused = await agent.run({ message: 'hi' });
      if (!isPaused(paused)) return expect.fail();
      await agent.resume(paused.checkpoint, input);
      expect(resumes).toBe(1);
    }
  });
});

describe('property — checkpoint round-trips through JSON without data loss', () => {
  it('serialize/deserialize preserves pausedStageId + subflowPath + pauseData', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't', name: 'ask', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'confirm?', level: 'high' });
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail();

    const before = paused.checkpoint;
    const after = JSON.parse(JSON.stringify(before));

    expect(after.pausedStageId).toBe(before.pausedStageId);
    expect(after.subflowPath).toEqual(before.subflowPath);
    expect(after.pauseData).toEqual(before.pauseData);
  });
});

describe('property — pause.request meta.runtimeStageId identifies the paused stage', () => {
  it('runtimeStageId embeds the paused stageId', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't', name: 'ask', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({});
          return '';
        },
      })
      .build();

    let meta: unknown;
    agent.on('agentfootprint.pause.request', (e) => {
      meta = e.meta;
    });

    await agent.run({ message: 'hi' });
    expect((meta as { runtimeStageId: string }).runtimeStageId).toContain('tool-calls');
  });
});
