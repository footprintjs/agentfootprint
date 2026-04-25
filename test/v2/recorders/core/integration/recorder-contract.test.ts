/**
 * Integration tests — ContextRecorder matches footprintjs's CombinedRecorder
 * interface contract (structurally assignable, correct method shapes).
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRecorder } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { ContextRecorder } from '../../../../src/recorders/core/ContextRecorder.js';

describe('integration — CombinedRecorder contract', () => {
  it('ContextRecorder is structurally assignable to CombinedRecorder', () => {
    const dispatcher = new EventDispatcher();
    const rec: CombinedRecorder = new ContextRecorder({
      dispatcher,
      getRunContext: () => ({
        runStartMs: Date.now(),
        runId: 'r',
        compositionPath: [],
      }),
    });
    // Structural assignability check + id field present
    expect(rec.id).toBe('agentfootprint.context-recorder');
  });

  it('exposes the 3 required hook methods (onSubflowEntry/Exit/onWrite)', () => {
    const rec = new ContextRecorder({
      dispatcher: new EventDispatcher(),
      getRunContext: () => ({
        runStartMs: Date.now(),
        runId: 'r',
        compositionPath: [],
      }),
    });
    expect(typeof rec.onSubflowEntry).toBe('function');
    expect(typeof rec.onSubflowExit).toBe('function');
    expect(typeof rec.onWrite).toBe('function');
  });

  it('accepts a custom recorder id', () => {
    const rec = new ContextRecorder({
      id: 'my-custom-id',
      dispatcher: new EventDispatcher(),
      getRunContext: () => ({
        runStartMs: Date.now(),
        runId: 'r',
        compositionPath: [],
      }),
    });
    expect(rec.id).toBe('my-custom-id');
  });
});
