/**
 * Security tests — pause/resume with hostile/malformed inputs.
 *
 * Checkpoints come from untrusted external storage (Redis, Postgres).
 * resume() must validate + reject cleanly; never crash the process with
 * an unhelpful error.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type {
  FlowchartCheckpoint,
  LLMProvider,
  LLMResponse,
} from '../../../src/adapters/types.js';

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

function pausingAgent() {
  return Agent.create({
    provider: scripted(
      resp('', [{ id: 't', name: 'ask', args: {} }]),
      resp('done'),
    ),
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

describe('security — resume() rejects malformed checkpoints', () => {
  it('rejects when pausedStageId is empty', async () => {
    const agent = pausingAgent();
    const bad = {
      sharedState: {},
      executionTree: null,
      pausedStageId: '',
      subflowPath: [],
      pausedAt: Date.now(),
    } as unknown as FlowchartCheckpoint;
    await expect(agent.resume(bad, {})).rejects.toThrow(/Invalid checkpoint/);
  });

  it('rejects when sharedState is not an object', async () => {
    const agent = pausingAgent();
    const bad = {
      sharedState: null,
      executionTree: null,
      pausedStageId: 'x',
      subflowPath: [],
      pausedAt: 0,
    } as unknown as FlowchartCheckpoint;
    await expect(agent.resume(bad, {})).rejects.toThrow(/Invalid checkpoint/);
  });

  it('rejects when subflowPath is not an array of strings', async () => {
    const agent = pausingAgent();
    const bad = {
      sharedState: {},
      executionTree: null,
      pausedStageId: 'x',
      subflowPath: [1, 2, 3],
      pausedAt: 0,
    } as unknown as FlowchartCheckpoint;
    await expect(agent.resume(bad, {})).rejects.toThrow(/Invalid checkpoint/);
  });
});

describe('security — checkpoint tampering detection', () => {
  it('resume with a checkpoint for a nonexistent stageId fails cleanly (no hang)', async () => {
    const agent = pausingAgent();
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail();

    const tampered = {
      ...paused.checkpoint,
      pausedStageId: 'nonexistent-stage-id',
    };

    await expect(agent.resume(tampered, 'x')).rejects.toThrow();
  });
});

describe('security — hostile resume input', () => {
  it('string input is accepted verbatim as the tool result', async () => {
    const agent = pausingAgent();
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail();
    const out = await agent.resume(paused.checkpoint, '<script>alert(1)</script>');
    // The library must not execute or sanitize — downstream trust boundary.
    expect(out).toBe('done');
  });

  it('non-serializable circular resume input is stringified safely', async () => {
    const agent = pausingAgent();
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail();

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // Must complete without throwing JSON.stringify error (safeStringify
    // fallback in Agent handles this).
    const out = await agent.resume(paused.checkpoint, circular);
    expect(typeof out === 'string' || isPaused(out)).toBe(true);
  });
});
