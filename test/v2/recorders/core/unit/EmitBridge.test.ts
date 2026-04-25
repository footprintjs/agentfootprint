/**
 * Unit tests — EmitBridge (shared adapter for prefix-based forward recorders).
 */

import { describe, it, expect, vi } from 'vitest';
import type { EmitEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { EmitBridge } from '../../../../src/recorders/core/EmitBridge.js';
import { streamRecorder } from '../../../../src/recorders/core/StreamRecorder.js';
import { agentRecorder } from '../../../../src/recorders/core/AgentRecorder.js';
import type { RunContext } from '../../../../src/bridge/eventMeta.js';

function runCtx(): RunContext {
  return { runStartMs: Date.now(), runId: 'r-test', compositionPath: [] };
}

function emit(name: string, payload: Record<string, unknown>): EmitEvent {
  return {
    name,
    payload,
    stageName: 'stage',
    runtimeStageId: `stage#0`,
    subflowPath: [],
    pipelineId: 'p',
    timestamp: Date.now(),
  } as EmitEvent;
}

describe('EmitBridge — prefix routing', () => {
  it('forwards events matching the configured prefix', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.stream.llm_start', fn);
    const bridge = new EmitBridge({
      id: 'test',
      prefix: 'agentfootprint.stream.',
      dispatcher: d,
      getRunContext: runCtx,
    });
    bridge.onEmit(emit('agentfootprint.stream.llm_start', { iteration: 1 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('skips events with a non-matching prefix', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('*', fn);
    const bridge = new EmitBridge({
      id: 'test',
      prefix: 'agentfootprint.stream.',
      dispatcher: d,
      getRunContext: runCtx,
    });
    bridge.onEmit(emit('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    expect(fn).not.toHaveBeenCalled();
  });

  it('honors the listener fast-path skip', () => {
    const d = new EventDispatcher();
    const dispatchSpy = vi.spyOn(d, 'dispatch');
    const bridge = new EmitBridge({
      id: 'test',
      prefix: 'agentfootprint.stream.',
      dispatcher: d,
      getRunContext: runCtx,
    });
    bridge.onEmit(emit('agentfootprint.stream.llm_start', { iteration: 1 }));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('streamRecorder / agentRecorder factories', () => {
  it('streamRecorder has id, routes stream.* events', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.stream.llm_end', fn);
    const rec = streamRecorder({ dispatcher: d, getRunContext: runCtx });
    expect(rec.id).toBe('agentfootprint.stream-recorder');
    rec.onEmit?.(emit('agentfootprint.stream.llm_end', { iteration: 1, content: '', toolCallCount: 0, usage: { input: 0, output: 0 }, stopReason: 'stop', durationMs: 0 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('agentRecorder has id, routes agent.* events', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.agent.turn_end', fn);
    const rec = agentRecorder({ dispatcher: d, getRunContext: runCtx });
    expect(rec.id).toBe('agentfootprint.agent-recorder');
    rec.onEmit?.(
      emit('agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: '',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        iterationCount: 1,
        durationMs: 0,
      }),
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('streamRecorder does NOT forward agent.* events (prefix mismatch)', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('*', fn);
    const rec = streamRecorder({ dispatcher: d, getRunContext: runCtx });
    rec.onEmit?.(emit('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    expect(fn).not.toHaveBeenCalled();
  });
});
