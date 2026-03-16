import { describe, it, expect, vi } from 'vitest';
import {
  runnerAsStage,
  AgentScope,
  MULTI_AGENT_PATHS,
  MultiAgentRecorder,
  FlowChart,
} from '../../src';
import type { ScopeFacade } from 'footprintjs';
import type { RunnerLike, AgentResultEntry } from '../../src';

// ── Helpers ──────────────────────────────────────────────────

function mockScope(initial: Record<string, unknown> = {}): ScopeFacade {
  const store: Record<string, unknown> = { ...initial };
  return {
    getValue: vi.fn((key: string) => store[key]),
    setValue: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
    updateValue: vi.fn(),
    deleteValue: vi.fn(),
    getArgs: vi.fn(() => ({})),
    attachRecorder: vi.fn(),
  } as unknown as ScopeFacade;
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

    const resultCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === MULTI_AGENT_PATHS.RESULT,
    );
    expect(resultCall[1]).toBe('the result');
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

    const customCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'customKey');
    expect(customCall[1]).toBe('RAW OUTPUT');
  });

  it('appends agent result entry', async () => {
    const runner = fakeRunner('output', ['step 1', 'step 2']);
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({ pipelineInput: 'hi', agentResults: [] });
    await stage(scope);

    const resultsCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === MULTI_AGENT_PATHS.AGENT_RESULTS,
    );
    const entries = resultsCall[1] as AgentResultEntry[];
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

    const resultsCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === MULTI_AGENT_PATHS.AGENT_RESULTS,
    );
    expect(resultsCall[1]).toHaveLength(2);
    expect(resultsCall[1][1].id).toBe('a2');
  });

  it('passes signal and timeoutMs from scope to runner', async () => {
    const runner = fakeRunner('output');
    const controller = new AbortController();
    const stage = runnerAsStage({ id: 'a1', name: 'Agent1', runner });

    const scope = mockScope({
      pipelineInput: 'hi',
      _signal: controller.signal,
      _timeoutMs: 5000,
    });
    await stage(scope);

    expect(runner.run).toHaveBeenCalledWith('hi', {
      signal: controller.signal,
      timeoutMs: 5000,
    });
  });
});

// ── MULTI_AGENT_PATHS ────────────────────────────────────────

describe('MULTI_AGENT_PATHS', () => {
  it('has correct path values', () => {
    expect(MULTI_AGENT_PATHS.PIPELINE_INPUT).toBe('pipelineInput');
    expect(MULTI_AGENT_PATHS.AGENT_RESULTS).toBe('agentResults');
    expect(MULTI_AGENT_PATHS.RESULT).toBe('result');
    expect(MULTI_AGENT_PATHS.SIGNAL).toBe('_signal');
    expect(MULTI_AGENT_PATHS.TIMEOUT_MS).toBe('_timeoutMs');
  });
});

// ── AgentScope multi-agent accessors ─────────────────────────

describe('AgentScope multi-agent accessors', () => {
  it('getPipelineInput / setPipelineInput', () => {
    const scope = mockScope({});
    AgentScope.setPipelineInput(scope, 'test input');
    expect(scope.setValue).toHaveBeenCalledWith('pipelineInput', 'test input');
  });

  it('getAgentResults returns empty array when not set', () => {
    const scope = mockScope({});
    expect(AgentScope.getAgentResults(scope)).toEqual([]);
  });

  it('setAgentResults writes to scope', () => {
    const scope = mockScope({});
    const entries = [{ id: 'a1', name: 'A1', content: 'x', latencyMs: 5 }];
    AgentScope.setAgentResults(scope, entries as AgentResultEntry[]);
    expect(scope.setValue).toHaveBeenCalledWith('agentResults', entries);
  });
});

// ── MultiAgentRecorder ───────────────────────────────────────

describe('MultiAgentRecorder', () => {
  it('records agent entries from agentResults writes', () => {
    const recorder = new MultiAgentRecorder();

    recorder.onWrite({
      key: MULTI_AGENT_PATHS.AGENT_RESULTS,
      value: [{ id: 'a1', name: 'Agent1', content: 'Hello', latencyMs: 50, narrative: ['step1'] }],
    });

    const stats = recorder.getStats();
    expect(stats.totalAgents).toBe(1);
    expect(stats.entries[0].id).toBe('a1');
    expect(stats.entries[0].contentLength).toBe(5);
    expect(stats.entries[0].hasNarrative).toBe(true);
  });

  it('only records new entries on append', () => {
    const recorder = new MultiAgentRecorder();

    recorder.onWrite({
      key: MULTI_AGENT_PATHS.AGENT_RESULTS,
      value: [{ id: 'a1', name: 'A1', content: 'x', latencyMs: 10 }],
    });
    recorder.onWrite({
      key: MULTI_AGENT_PATHS.AGENT_RESULTS,
      value: [
        { id: 'a1', name: 'A1', content: 'x', latencyMs: 10 },
        { id: 'a2', name: 'A2', content: 'yy', latencyMs: 20 },
      ],
    });

    expect(recorder.getTotalAgents()).toBe(2);
    expect(recorder.getStats().entries[1].id).toBe('a2');
  });

  it('ignores writes to non-agent keys', () => {
    const recorder = new MultiAgentRecorder();
    recorder.onWrite({ key: 'messages', value: [] });
    recorder.onWrite({ key: 'result', value: 'something' });
    expect(recorder.getTotalAgents()).toBe(0);
  });

  it('calculates averageLatencyMs', () => {
    const recorder = new MultiAgentRecorder();
    recorder.onWrite({
      key: MULTI_AGENT_PATHS.AGENT_RESULTS,
      value: [
        { id: 'a1', name: 'A1', content: 'x', latencyMs: 100 },
        { id: 'a2', name: 'A2', content: 'y', latencyMs: 200 },
      ],
    });
    expect(recorder.getStats().averageLatencyMs).toBe(150);
    expect(recorder.getStats().totalLatencyMs).toBe(300);
  });

  it('clear resets state', () => {
    const recorder = new MultiAgentRecorder();
    recorder.onWrite({
      key: MULTI_AGENT_PATHS.AGENT_RESULTS,
      value: [{ id: 'a1', name: 'A1', content: 'x', latencyMs: 10 }],
    });
    recorder.clear();
    expect(recorder.getTotalAgents()).toBe(0);
  });

  it('uses custom id', () => {
    const recorder = new MultiAgentRecorder('my-recorder');
    expect(recorder.id).toBe('my-recorder');
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
