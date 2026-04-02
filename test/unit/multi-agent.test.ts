import { describe, it, expect, vi } from 'vitest';
import {
  runnerAsStage,
  FlowChart,
} from '../../src';
import type { TypedScope } from 'footprintjs';
import type { RunnerLike, AgentResultEntry } from '../../src';
import type { MultiAgentState } from '../../src/scope/types';

// ── Helpers ──────────────────────────────────────────────────

function mockScope(
  initial: Record<string, unknown> = {},
  env?: { signal?: AbortSignal; timeoutMs?: number },
): TypedScope<MultiAgentState> {
  const obj: any = { ...initial };
  obj.$getValue = vi.fn((key: string) => obj[key]);
  obj.$setValue = vi.fn((key: string, value: unknown) => {
    obj[key] = value;
  });
  obj.$getEnv = vi.fn(() => env);
  return obj as TypedScope<MultiAgentState>;
}

function fakeRunner(content: string, narrative?: string[]): RunnerLike {
  return {
    run: vi.fn(async () => ({ content })),
    getNarrative: narrative ? () => narrative : undefined,
  };
}

// ── runnerAsStage ────────────────────────────────────────────

describe('runnerAsStage', () => {
  it('prefers result (from previous agent) over pipelineInput', async () => {
    const runner = fakeRunner('output');
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({ pipelineInput: 'original', result: 'from previous' });
    await stage(scope);

    expect(runner.run).toHaveBeenCalledWith('from previous', expect.any(Object));
  });

  it('falls back to pipelineInput when no result', async () => {
    const runner = fakeRunner('output');
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({ pipelineInput: 'hello' });
    await stage(scope);

    expect(runner.run).toHaveBeenCalledWith('hello', expect.any(Object));
  });

  it('falls back to empty string when nothing available', async () => {
    const runner = fakeRunner('output');
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({});
    await stage(scope);

    expect(runner.run).toHaveBeenCalledWith('', expect.any(Object));
  });

  it('uses custom inputMapper', async () => {
    const runner = fakeRunner('output');
    const stage = runnerAsStage({
      id: 'a1',
      name: 'Agent1',
      runner,
      inputMapper: (state) => `Custom: ${state.pipelineInput}`,
    });

    const scope = mockScope({ pipelineInput: 'raw input' });
    await stage(scope);

    expect(runner.run).toHaveBeenCalledWith('Custom: raw input', expect.any(Object));
  });

  it('writes result to scope by default', async () => {
    const runner = fakeRunner('the result');
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({ pipelineInput: 'hi', agentResults: [] });
    await stage(scope);

    expect(scope.result).toBe('the result');
  });

  it('uses custom outputMapper', async () => {
    const runner = fakeRunner('raw output');
    const stage = runnerAsStage({
      id: 'a1',
      name: 'Agent1',
      runner,
      outputMapper: (output) => ({ customKey: output.content.toUpperCase() }),
    });

    const scope = mockScope({ pipelineInput: 'hi', agentResults: [] });
    await stage(scope);

    // outputMapper uses $setValue for dynamic keys
    expect(scope.$setValue).toHaveBeenCalledWith('customKey', 'RAW OUTPUT');
  });

  it('appends agent result entry', async () => {
    const runner = fakeRunner('output', ['step 1', 'step 2']);
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({ pipelineInput: 'hi', agentResults: [] });
    await stage(scope);

    const entries = scope.agentResults as AgentResultEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('a1');
    expect(entries[0].name).toBe('Agent1');
    expect(entries[0].content).toBe('output');
    expect(entries[0].narrative).toEqual(['step 1', 'step 2']);
    expect(entries[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('appends to existing agent results', async () => {
    const runner = fakeRunner('second');
    const stage = runnerAsStage({ id: 'a2', name: 'Agent2', runner });

    const existing = [{ id: 'a1', name: 'Agent1', content: 'first', latencyMs: 10 }];
    const scope = mockScope({ result: 'first', agentResults: existing });
    await stage(scope);

    const entries = scope.agentResults as AgentResultEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[1].id).toBe('a2');
  });

  it('passes signal and timeoutMs from env to runner', async () => {
    const runner = fakeRunner('output');
    const controller = new AbortController();
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope(
      { pipelineInput: 'hi' },
      { signal: controller.signal, timeoutMs: 5000 },
    );
    await stage(scope);

    expect(runner.run).toHaveBeenCalledWith('hi', {
      signal: controller.signal,
      timeoutMs: 5000,
    });
  });
});

// ── FlowChart builder ─────────────────────────────────────────

describe('FlowChart', () => {
  it('throws when built with zero agents', () => {
    expect(() => FlowChart.create().build()).toThrow('at least one agent');
  });

  it('builds with one agent', () => {
    const runner = FlowChart.create().agent('a1', 'Agent1', fakeRunner('output')).build();
    expect(runner).toBeDefined();
  });

  it('builds with multiple agents', () => {
    const runner = FlowChart.create()
      .agent('a1', 'Agent1', fakeRunner('step1'))
      .agent('a2', 'Agent2', fakeRunner('step2'))
      .build();
    expect(runner).toBeDefined();
  });
});
