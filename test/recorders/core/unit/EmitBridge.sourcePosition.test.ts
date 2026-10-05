import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmitEvent } from 'footprintjs';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { EmitBridge } from '../../../../src/recorders/core/EmitBridge.js';

const name = 'agentfootprint.stream.llm_start';

function source() {
  return {
    runId: 'engine-leg',
    logRunId: 'engine-log',
    drillPath: ['mount#2', 'inner#3'],
    committedThroughIdx: 4,
  };
}

function event(extra: object = {}): EmitEvent {
  return Object.assign(
    {
      name,
      payload: { iteration: 1 },
      stageName: 'stage',
      runtimeStageId: 'mount/stage#4',
      subflowPath: ['mount'],
      pipelineId: 'pipeline',
      timestamp: 125,
    },
    extra,
  );
}

function harness(listen = true) {
  const dispatcher = new EventDispatcher();
  const seen: AgentfootprintEvent[] = [];
  if (listen) dispatcher.on('*', (value) => seen.push(value));
  const bridge = new EmitBridge({
    id: 'source-position-test',
    prefix: 'agentfootprint.stream.',
    dispatcher,
    getRunContext: () => ({ runId: 'agent-run', runStartMs: 100, compositionPath: ['Agent:test'] }),
  });
  return { bridge, seen };
}

afterEach(() => vi.restoreAllMocks());

describe('EmitBridge source-time metadata', () => {
  it('uses emission time rather than delayed observer arrival time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(900);
    const { bridge, seen } = harness();
    bridge.onEmit(event());
    expect(seen[0].meta).toMatchObject({ wallClockMs: 125, runOffsetMs: 25, runId: 'agent-run' });
    expect(seen[0].meta).not.toHaveProperty('sourcePosition');
  });

  it('preserves a zero emission timestamp rather than replacing it with now', () => {
    vi.spyOn(Date, 'now').mockReturnValue(900);
    const { bridge, seen } = harness();
    bridge.onEmit(event({ timestamp: 0 }));
    expect(seen[0].meta).toMatchObject({ wallClockMs: 0, runOffsetMs: -100 });
  });

  it('projects the engine coordinates without changing the Agent run namespace or payload', () => {
    const { bridge, seen } = harness();
    const emitted = event({ sourcePosition: source() });
    bridge.onEmit(emitted);
    expect(seen[0].payload).toBe(emitted.payload);
    expect(seen[0].meta).toMatchObject({
      runId: 'agent-run',
      runtimeStageId: 'mount/stage#4',
      subflowPath: ['mount'],
      sourcePosition: {
        engineRunId: 'engine-leg',
        logRunId: 'engine-log',
        drillPath: ['mount#2', 'inner#3'],
        committedThroughIdx: 4,
      },
    });
    expect(seen[0].meta.sourcePosition).not.toHaveProperty('runId');
  });

  it('keeps the root before-first-commit coordinate instead of inventing a first commit', () => {
    const { bridge, seen } = harness();
    bridge.onEmit(
      event({ sourcePosition: { ...source(), drillPath: [], committedThroughIdx: -1 } }),
    );
    expect(seen[0].meta.sourcePosition).toEqual({
      engineRunId: 'engine-leg',
      logRunId: 'engine-log',
      drillPath: [],
      committedThroughIdx: -1,
    });
  });

  it('detaches and freezes the projected data, retaining no unknown fields', () => {
    const { bridge, seen } = harness();
    const position = { ...source(), privateExtra: 'do-not-retain' };
    bridge.onEmit(event({ sourcePosition: position }));
    position.drillPath.push('changed#8');
    position.committedThroughIdx = 90;
    const retained = seen[0].meta.sourcePosition;
    expect(retained).toEqual({
      engineRunId: 'engine-leg',
      logRunId: 'engine-log',
      drillPath: ['mount#2', 'inner#3'],
      committedThroughIdx: 4,
    });
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained?.drillPath)).toBe(true);
  });

  it.each(['no listener', 'different prefix'] as const)(
    'keeps the %s fast path ahead of source metadata inspection',
    (mode) => {
      const { bridge, seen } = harness(mode !== 'no listener');
      const read = vi.fn(() => {
        throw new Error('must not inspect metadata');
      });
      const emitted = event(mode === 'different prefix' ? { name: 'elsewhere' } : {});
      Object.defineProperty(emitted, 'sourcePosition', { get: read });
      bridge.onEmit(emitted);
      expect(read).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
    },
  );

  it('does not invoke a sourcePosition getter on an otherwise accepted event', () => {
    const { bridge, seen } = harness();
    const read = vi.fn(() => source());
    const emitted = event();
    Object.defineProperty(emitted, 'sourcePosition', { get: read });
    bridge.onEmit(emitted);
    expect(read).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].meta).not.toHaveProperty('sourcePosition');
  });
});
