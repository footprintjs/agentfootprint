/**
 * TagRecorder — 5-pattern tests.
 *
 * Tests tag grouping, agent preset rules, time travel navigation,
 * implicit init tag, and repeating tags (multiple LLM calls).
 */
import { describe, it, expect } from 'vitest';
import { TagRecorder, agentTagRules } from '../../src/recorders/v2/TagRecorder';
import type { TagEvent } from '../../src/recorders/v2/TagRecorder';

// ── Helpers ──────────────────────────────────────────────────

function stageEvent(stageId: string, stageName?: string): { stageName: string; traversalContext: { stageId: string; stageName: string; depth: number } } {
  return {
    stageName: stageName ?? stageId,
    traversalContext: { stageId, stageName: stageName ?? stageId, depth: 0 },
  };
}

// ── Unit ───────────────────────────────────────────────────────

describe('TagRecorder — unit', () => {
  it('groups stages into tags based on rules', () => {
    const recorder = new TagRecorder([
      { id: 'start', label: 'Started', match: (e) => e.stageId === 'a' },
      { id: 'end', label: 'Ended', match: (e) => e.stageId === 'c' },
    ]);

    recorder.onStageExecuted(stageEvent('a'));
    recorder.onStageExecuted(stageEvent('b'));
    recorder.onStageExecuted(stageEvent('c'));

    const tags = recorder.getTags();
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe('start');
    expect(tags[0].label).toBe('Started');
    expect(tags[0].entries).toHaveLength(2); // a + b (before 'c' triggers new tag)
    expect(tags[1].id).toBe('end');
    expect(tags[1].entries).toHaveLength(1); // c
  });

  it('creates implicit init tag for events before first rule match', () => {
    const recorder = new TagRecorder([
      { id: 'main', label: 'Main', match: (e) => e.stageId === 'b' },
    ]);

    recorder.onStageExecuted(stageEvent('a')); // before any rule matches
    recorder.onStageExecuted(stageEvent('b'));

    const tags = recorder.getTags();
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe('init');
    expect(tags[0].label).toBe('Initialized');
    expect(tags[0].entries).toHaveLength(1); // just 'a'
    expect(tags[1].id).toBe('main');
  });
});

// ── Agent Preset ──────────────────────────────────────────────

describe('TagRecorder — agentTagRules', () => {
  it('groups agent loop stages into meaningful tags', () => {
    const recorder = new TagRecorder(agentTagRules());

    // Simulate agent loop: seed → slots → CallLLM → ParseResponse → ExecuteTools → CallLLM → Finalize
    recorder.onStageExecuted(stageEvent('seed', 'Seed'));
    recorder.onSubflowEntry({ name: 'SystemPrompt', traversalContext: { stageId: 'sf-system-prompt', stageName: 'SystemPrompt', depth: 1 } });
    recorder.onSubflowExit({ name: 'SystemPrompt', traversalContext: { stageId: 'sf-system-prompt', stageName: 'SystemPrompt', depth: 1 } });
    recorder.onStageExecuted(stageEvent('call-llm', 'CallLLM'));
    recorder.onStageExecuted(stageEvent('parse-response', 'ParseResponse'));
    recorder.onStageExecuted(stageEvent('execute-tool-calls', 'ExecuteToolCalls'));
    recorder.onStageExecuted(stageEvent('call-llm', 'CallLLM'));
    recorder.onStageExecuted(stageEvent('parse-response', 'ParseResponse'));
    recorder.onBreak({ stageName: 'Finalize', traversalContext: { stageId: 'finalize', stageName: 'Finalize', depth: 0 } });

    const tags = recorder.getTags();

    // Should have: init (seed+slots), llm (first call), tools, llm-2 (second call), done
    expect(tags.length).toBeGreaterThanOrEqual(4);

    // First tag: init (everything before first call-llm)
    expect(tags[0].id).toBe('init');

    // Second tag: LLM Call #1
    expect(tags[1].id).toBe('llm');
    expect(tags[1].label).toBe('LLM Call #1');

    // Third tag: Tool Execution
    expect(tags[2].id).toBe('tools');
    expect(tags[2].label).toBe('Tool Execution');

    // Fourth tag: LLM Call #2
    expect(tags[3].id).toBe('llm-2');
    expect(tags[3].label).toBe('LLM Call #2');

    // Fifth tag: Completed
    expect(tags[4].id).toBe('done');
    expect(tags[4].label).toBe('Completed');
  });
});

// ── Time Travel ───────────────────────────────────────────────

describe('TagRecorder — time travel', () => {
  it('getTag retrieves specific tag by ID', () => {
    const recorder = new TagRecorder(agentTagRules());
    recorder.onStageExecuted(stageEvent('seed'));
    recorder.onStageExecuted(stageEvent('call-llm', 'CallLLM'));
    recorder.onBreak({ stageName: 'Finalize', traversalContext: { stageId: 'finalize', stageName: 'Finalize', depth: 0 } });

    const llmTag = recorder.getTag('llm');
    expect(llmTag).toBeDefined();
    expect(llmTag!.label).toBe('LLM Call #1');
  });

  it('getTagAt retrieves by index', () => {
    const recorder = new TagRecorder(agentTagRules());
    recorder.onStageExecuted(stageEvent('seed'));
    recorder.onStageExecuted(stageEvent('call-llm'));

    const first = recorder.getTagAt(0);
    expect(first).toBeDefined();
    expect(first!.index).toBe(0);
  });

  it('count returns number of tags', () => {
    const recorder = new TagRecorder(agentTagRules());
    recorder.onStageExecuted(stageEvent('seed'));
    recorder.onStageExecuted(stageEvent('call-llm'));
    recorder.onBreak({ stageName: 'Finalize', traversalContext: { stageId: 'finalize', stageName: 'Finalize', depth: 0 } });

    expect(recorder.count).toBe(3); // init, llm, done
  });
});

// ── Clear / Snapshot ──────────────────────────────────────────

describe('TagRecorder — lifecycle', () => {
  it('clear resets all state', () => {
    const recorder = new TagRecorder(agentTagRules());
    recorder.onStageExecuted(stageEvent('call-llm'));
    expect(recorder.count).toBeGreaterThan(0);

    recorder.clear();
    expect(recorder.count).toBe(0);
  });

  it('toSnapshot includes tags', () => {
    const recorder = new TagRecorder(agentTagRules());
    recorder.onStageExecuted(stageEvent('seed'));
    recorder.onStageExecuted(stageEvent('call-llm'));

    const snap = recorder.toSnapshot();
    expect(snap.name).toBe('Tags');
    expect(Array.isArray(snap.data)).toBe(true);
  });
});
