/**
 * Scenario tests — typed subscribe → dispatch → receive flow.
 *
 * Simulates consumer-facing usage patterns end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { EventMeta } from '../../../src/events/types.js';

function dispatch<K extends keyof AgentfootprintEventMap>(
  d: EventDispatcher,
  type: K,
  payload: AgentfootprintEventMap[K]['payload'],
  metaOverrides: Partial<EventMeta> = {},
): void {
  d.dispatch({
    type,
    payload,
    meta: {
      wallClockMs: Date.now(),
      runOffsetMs: 0,
      runtimeStageId: 'stage#0',
      subflowPath: [],
      compositionPath: [],
      runId: 'scenario-run',
      ...metaOverrides,
    },
  } as AgentfootprintEventMap[K]);
}

describe('scenario — typed consumer flow (context engineering)', () => {
  it('consumer logs every RAG injection into messages slot', () => {
    const d = new EventDispatcher();
    const ragInjections: string[] = [];

    d.on('agentfootprint.context.injected', (e) => {
      if (e.payload.source === 'rag' && e.payload.slot === 'messages') {
        ragInjections.push(e.payload.contentSummary);
      }
    });

    // Simulate three injections: two RAG, one skill
    dispatch(d, 'agentfootprint.context.injected', {
      slot: 'messages',
      source: 'rag',
      contentSummary: 'chunk-1',
      contentHash: 'h1',
      reason: 'top-k retrieval',
      retrievalScore: 0.92,
    });
    dispatch(d, 'agentfootprint.context.injected', {
      slot: 'messages',
      source: 'rag',
      contentSummary: 'chunk-2',
      contentHash: 'h2',
      reason: 'top-k retrieval',
      retrievalScore: 0.85,
    });
    dispatch(d, 'agentfootprint.context.injected', {
      slot: 'system-prompt',
      source: 'skill',
      contentSummary: 'customer-support skill',
      contentHash: 'h3',
      reason: 'skill activated',
    });

    expect(ragInjections).toEqual(['chunk-1', 'chunk-2']);
  });

  it('consumer filters by compositionPath to isolate one inner runner', () => {
    const d = new EventDispatcher();
    const fromEthics: string[] = [];

    d.on('agentfootprint.stream.llm_start', (e) => {
      if (e.meta.compositionPath.includes('Agent:ethics')) {
        fromEthics.push(e.payload.model);
      }
    });

    dispatch(
      d,
      'agentfootprint.stream.llm_start',
      {
        iteration: 1,
        provider: 'anthropic',
        model: 'claude-opus',
        systemPromptChars: 0,
        messagesCount: 1,
        toolsCount: 0,
      },
      { compositionPath: ['Parallel:review', 'Agent:ethics'] },
    );
    dispatch(
      d,
      'agentfootprint.stream.llm_start',
      {
        iteration: 1,
        provider: 'anthropic',
        model: 'claude-haiku',
        systemPromptChars: 0,
        messagesCount: 1,
        toolsCount: 0,
      },
      { compositionPath: ['Parallel:review', 'Agent:cost'] },
    );

    expect(fromEthics).toEqual(['claude-opus']);
  });

  it('consumer combines typed + wildcard subscriptions', () => {
    const d = new EventDispatcher();
    const typedCalls: string[] = [];
    const wildcardCalls: string[] = [];

    d.on('agentfootprint.agent.turn_start', (e) => {
      typedCalls.push(e.payload.userPrompt);
    });
    d.on('agentfootprint.agent.*', (e) => {
      wildcardCalls.push(e.type);
    });

    dispatch(d, 'agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' });
    dispatch(d, 'agentfootprint.agent.turn_end', {
      turnIndex: 0,
      finalContent: 'a',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      iterationCount: 1,
      durationMs: 0,
    });

    expect(typedCalls).toEqual(['q']);
    expect(wildcardCalls).toEqual([
      'agentfootprint.agent.turn_start',
      'agentfootprint.agent.turn_end',
    ]);
  });
});

describe('scenario — collect-then-await pattern (back-pressure)', () => {
  it("consumer collects Promises in listener; awaits AFTER the 'run'", async () => {
    const d = new EventDispatcher();
    const pending: Promise<number>[] = [];
    const persisted: number[] = [];

    d.on('agentfootprint.stream.llm_end', (e) => {
      pending.push(
        new Promise<number>((resolve) => {
          setTimeout(() => {
            persisted.push(e.payload.iteration);
            resolve(e.payload.iteration);
          }, 5);
        }),
      );
    });

    // Simulate the run emitting 3 llm_end events
    for (let i = 0; i < 3; i++) {
      dispatch(d, 'agentfootprint.stream.llm_end', {
        iteration: i,
        content: '',
        toolCallCount: 0,
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
        durationMs: 0,
      });
    }

    // Run is done — consumer awaits their own collected work here
    const results = await Promise.all(pending);
    expect(results).toEqual([0, 1, 2]);
    expect(persisted).toEqual([0, 1, 2]);
  });
});
