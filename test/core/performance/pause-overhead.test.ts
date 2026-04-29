/**
 * Performance + ROI tests — pause/resume overhead.
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

function freshAgent() {
  return Agent.create({
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
}

describe('performance — pause round trip is fast', () => {
  it('pause + resume completes in under 500ms (CI-safe)', async () => {
    const agent = freshAgent();
    const t0 = performance.now();
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail();
    await agent.resume(paused.checkpoint, 'ok');
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
  });
});

describe('performance — checkpoint size is bounded', () => {
  it('JSON-serialized checkpoint for a minimal agent is under 32KB', async () => {
    const agent = freshAgent();
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail();
    const size = JSON.stringify(paused.checkpoint).length;
    expect(size).toBeLessThan(32 * 1024);
  });
});

// Cycling provider — every run() asks for a tool call (→ pause), every
// resume() advances to the 'done' response. Repeats forever.
function cyclingProvider(): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => {
      const out = i % 2 === 0 ? resp('', [{ id: `t${i}`, name: 'ask', args: {} }]) : resp('done');
      i++;
      return out;
    },
  };
}

describe('ROI — pause/resume cycle reuses the same Agent instance cleanly', () => {
  it('10 consecutive pause/resume cycles on the same Agent complete without error', async () => {
    const agent = Agent.create({ provider: cyclingProvider(), model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({});
          return '';
        },
      })
      .build();

    for (let i = 0; i < 10; i++) {
      const paused = await agent.run({ message: `r${i}` });
      if (!isPaused(paused)) return expect.fail(`cycle ${i}: expected paused`);
      const final = await agent.resume(paused.checkpoint, `answer-${i}`);
      expect(final).toBe('done');
    }
  });

  it('listener subscriptions survive N pause/resume cycles without accumulation', async () => {
    const agent = Agent.create({ provider: cyclingProvider(), model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({});
          return '';
        },
      })
      .build();

    let pauseCount = 0;
    let resumeCount = 0;
    agent.on('agentfootprint.pause.request', () => pauseCount++);
    agent.on('agentfootprint.pause.resume', () => resumeCount++);

    for (let i = 0; i < 5; i++) {
      const paused = await agent.run({ message: `r${i}` });
      if (!isPaused(paused)) return expect.fail(`cycle ${i}: expected paused`);
      await agent.resume(paused.checkpoint, 'ok');
    }

    // N cycles → N pauses, N resumes. No duplication.
    expect(pauseCount).toBe(5);
    expect(resumeCount).toBe(5);
  });
});
