/**
 * Integration — typedEmit → footprintjs EmitEvent → EmitBridge → v2 dispatcher.
 *
 * Verifies the full pipeline: stage code calls typedEmit, a simulated
 * footprintjs dispatch delivers the EmitEvent to our StreamRecorder,
 * which enriches with meta and publishes to the v2 dispatcher where
 * consumer .on() handlers fire.
 */

import { describe, it, expect } from 'vitest';
import type { EmitEvent } from 'footprintjs';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import { streamRecorder } from '../../../src/recorders/core/StreamRecorder.js';
import { typedEmit } from '../../../src/recorders/core/typedEmit.js';

describe('integration — stream pipeline round trip', () => {
  it('typedEmit -> EmitBridge -> v2 dispatcher -> consumer listener', () => {
    // Consumer side: attach listener on v2 dispatcher (normally via Runner.on)
    const dispatcher = new EventDispatcher();
    const received: unknown[] = [];
    dispatcher.on('agentfootprint.stream.llm_start', (e) => {
      received.push(e.payload);
    });

    // Library side: attach StreamRecorder (normally done by Runner internally)
    const rec = streamRecorder({
      dispatcher,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });

    // Simulated footprintjs emit flow: stage code calls typedEmit which
    // would feed into the emit channel. We fake the EmitEvent footprintjs
    // would construct and hand it to the recorder.
    const captured: EmitEvent[] = [];
    const fakeScope = {
      $emit: (name: string, payload: Record<string, unknown>) => {
        const emitEvent = {
          name,
          payload,
          stageName: 'call-llm',
          runtimeStageId: 'call-llm#1',
          subflowPath: [],
          pipelineId: 'p',
          timestamp: Date.now(),
        } as EmitEvent;
        captured.push(emitEvent);
        rec.onEmit?.(emitEvent);
      },
    };

    typedEmit(fakeScope, 'agentfootprint.stream.llm_start', {
      iteration: 1,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      systemPromptChars: 800,
      messagesCount: 2,
      toolsCount: 0,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });
  });
});
