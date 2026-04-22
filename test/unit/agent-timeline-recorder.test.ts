/**
 * AgentTimelineRecorder — 5 pattern tests covering the full circle:
 *
 *   1. emit → entry → folded AgentTimeline (basic shape)
 *   2. ReAct loop ordering (llm_end → tool_start, tool_end captures)
 *      — guards against the regression where tool_start firing AFTER
 *      llm_end was dropped (LiveTimelineBuilder fix in lens commit
 *      6172048)
 *   3. Context-injection routing — events during the LLM phase shape
 *      THIS iter; events between phases shape the NEXT iter
 *   4. Multi-turn — successive turn_start / turn_end produce
 *      independent AgentTurn entries; turn-level ledger folds
 *   5. clear() resets the recorder for re-use across runs
 */
import { describe, it, expect } from 'vitest';
import { agentTimeline, AgentTimelineRecorder } from '../../src/recorders/AgentTimelineRecorder';
import type { EmitEvent } from 'footprintjs';

function evt(name: string, payload: Record<string, unknown>, opts?: Partial<EmitEvent>): EmitEvent {
  return {
    name,
    payload,
    runtimeStageId: opts?.runtimeStageId ?? `${name}#${Date.now()}-${Math.random()}`,
    stageName: opts?.stageName ?? 'test',
    subflowPath: opts?.subflowPath ?? [],
    pipelineId: opts?.pipelineId ?? 'test-pipeline',
    timestamp: opts?.timestamp ?? Date.now(),
  };
}

// Test helper: bundle selectors into one object for assertions that
// historically used the getTimeline() shape. Production code should
// call selectors directly — this helper just minimizes test churn.
function snapshot(t: AgentTimelineRecorder) {
  return {
    agent: t.selectAgent(),
    turns: t.selectTurns(),
    messages: t.selectMessages(),
    tools: t.selectTools(),
    subAgents: t.selectSubAgents(),
    finalDecision: t.selectFinalDecision(),
  };
}

function subEvt(
  name: string,
  payload: Record<string, unknown>,
  subflowPath: readonly string[],
): EmitEvent {
  return evt(name, payload, { subflowPath });
}

describe('AgentTimelineRecorder — 5 pattern tests', () => {
  it('1. translates emit events into a folded AgentTimeline', () => {
    const t = agentTimeline();

    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'hi' }));
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'hello!',
        model: 'claude-sonnet-4-5',
        usage: { inputTokens: 10, outputTokens: 20 },
        toolCallCount: 0,
      }),
    );
    t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'hello!' }));

    const timeline = snapshot(t);
    expect(timeline.turns).toHaveLength(1);
    const turn = timeline.turns[0];
    expect(turn.userPrompt).toBe('hi');
    expect(turn.iterations).toHaveLength(1);
    expect(turn.iterations[0].assistantContent).toBe('hello!');
    expect(turn.iterations[0].model).toBe('claude-sonnet-4-5');
    expect(turn.iterations[0].inputTokens).toBe(10);
    expect(turn.iterations[0].outputTokens).toBe(20);
    expect(turn.totalInputTokens).toBe(10);
    expect(turn.finalContent).toBe('hello!');
    expect(timeline.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('2. ReAct loop: tool_start firing AFTER llm_end still attaches to the just-ended iter', () => {
    // Real agent loop emits: llm_start → llm_end (with tool_calls) →
    // tool_start → tool_end → llm_start → … . Earlier regression in
    // LiveTimelineBuilder dropped all tool captures because currentIter
    // was nulled at llm_end. AgentTimelineRecorder uses an
    // llmPhaseActive flag instead — currentIter stays bound across the
    // tool execution phase.
    const t = agentTimeline();

    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'use a tool' }));

    // Iter 1 — list_skills
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'looking up skills',
        toolCallCount: 1,
      }),
    );
    t.onEmit(
      evt('agentfootprint.stream.tool_start', {
        toolName: 'list_skills',
        toolCallId: 'c1',
        args: {},
      }),
    );
    t.onEmit(evt('agentfootprint.stream.tool_end', { toolCallId: 'c1', result: '{...}' }));

    // Iter 2 — final
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 2 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', {
        iteration: 2,
        content: 'done',
        toolCallCount: 0,
      }),
    );
    t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'done' }));

    const timeline = snapshot(t);
    expect(timeline.tools.map((tc) => tc.name)).toEqual(['list_skills']);
    expect(timeline.turns[0].iterations[0].toolCalls.map((tc) => tc.name)).toEqual(['list_skills']);
    // Iter 1 owns the tool, not iter 2.
    expect(timeline.turns[0].iterations[1].toolCalls).toHaveLength(0);
  });

  it('3. Context injection routing: during LLM phase → this iter; between phases → next iter', () => {
    const t = agentTimeline();

    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'q' }));

    // Iter 1 — RAG fires DURING the llm phase → attaches to iter 1
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.context.rag.chunks', {
        slot: 'messages',
        role: 'system',
        chunkCount: 3,
        deltaCount: { system: 1 },
      }),
    );
    t.onEmit(
      evt('agentfootprint.stream.llm_end', { iteration: 1, content: 'iter1', toolCallCount: 1 }),
    );
    t.onEmit(
      evt('agentfootprint.stream.tool_start', {
        toolName: 'read_skill',
        toolCallId: 'c1',
        args: { id: 'weather' },
      }),
    );
    t.onEmit(evt('agentfootprint.stream.tool_end', { toolCallId: 'c1', result: 'ok' }));

    // Skill activation fires AFTER iter 1's llm_end and BEFORE iter 2's
    // llm_start → routes to iter 2's pre-iter buffer
    t.onEmit(
      evt('agentfootprint.context.skill.activated', {
        slot: 'system-prompt',
        skillId: 'weather',
        deltaCount: { systemPromptChars: 1200, toolsFromSkill: true },
      }),
    );

    // Iter 2 — pre-iter buffer flushes onto iter 2
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 2 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', { iteration: 2, content: 'final', toolCallCount: 0 }),
    );
    t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'final' }));

    const turn = snapshot(t).turns[0];
    // Iter 1 sees only the RAG injection (fired during its phase)
    expect(turn.iterations[0].contextInjections.map((ci) => ci.source)).toEqual(['rag']);
    // Iter 2 sees only the skill injection (fired between phases)
    expect(turn.iterations[1].contextInjections.map((ci) => ci.source)).toEqual(['skill']);
    // Per-iter ledger folds correctly
    expect(turn.iterations[0].contextLedger.system).toBe(1);
    expect(turn.iterations[1].contextLedger.systemPromptChars).toBe(1200);
    expect(turn.iterations[1].contextLedger.toolsFromSkill).toBe(true);
    // Turn-level ledger sums across iterations
    expect(turn.contextLedger.system).toBe(1);
    expect(turn.contextLedger.systemPromptChars).toBe(1200);
    expect(turn.contextLedger.toolsFromSkill).toBe(true);
    expect(turn.contextInjections.map((ci) => ci.source)).toEqual(['rag', 'skill']);
  });

  it('4. multi-turn: successive turns produce independent AgentTurn entries', () => {
    const t = agentTimeline();

    // Turn 1
    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'first' }));
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'one',
        usage: { inputTokens: 5, outputTokens: 10 },
        toolCallCount: 0,
      }),
    );
    t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'one' }));

    // Turn 2
    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'second' }));
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'two',
        usage: { inputTokens: 7, outputTokens: 14 },
        toolCallCount: 0,
      }),
    );
    t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'two' }));

    const timeline = snapshot(t);
    expect(timeline.turns).toHaveLength(2);
    expect(timeline.turns.map((tt) => tt.userPrompt)).toEqual(['first', 'second']);
    expect(timeline.turns.map((tt) => tt.totalInputTokens)).toEqual([5, 7]);
    expect(timeline.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:first',
      'assistant:one',
      'user:second',
      'assistant:two',
    ]);
  });

  it('6. agent metadata: timeline.agent.{id,name} comes from recorder options', () => {
    // Single source of truth for "which agent did this run belong to."
    // UI libraries read `timeline.agent.name` instead of fishing the
    // name out of the runtime snapshot or asking consumers to thread a
    // separate prop. Multi-agent (next phase) gives each sub-agent its
    // own recorder → its own `agent` block on its own timeline.
    const explicit = agentTimeline({ id: 'classify', name: 'Classify Bot' });
    explicit.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'q' }));
    explicit.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    explicit.onEmit(
      evt('agentfootprint.stream.llm_end', { iteration: 1, content: 'a', toolCallCount: 0 }),
    );
    expect(snapshot(explicit).agent).toEqual({ id: 'classify', name: 'Classify Bot' });
    expect(explicit.id).toBe('classify');
    expect(explicit.name).toBe('Classify Bot');

    // Defaults — id falls back to 'agentfootprint-agent-timeline',
    // name falls back to 'Agent'. UIs that get the fallback name
    // render "Agent · Agent" rather than crashing on undefined.
    const defaults = agentTimeline();
    expect(defaults.selectAgent()).toEqual({
      id: 'agentfootprint-agent-timeline',
      name: 'Agent',
    });
  });

  it('7. multi-agent: events with subflowPath group into AgentTimeline.subAgents', () => {
    // Pipeline-style multi-agent run: parent FlowChart routes through
    // 3 sub-agents (classify → analyze → respond). Each sub-agent's
    // events fire with subflowPath = ["<sub-agent-id>"]. The recorder
    // groups them into per-sub-agent slices on the parent timeline.
    const t = agentTimeline({ name: 'Pipeline' });
    const fakeSubflowEntry = (id: string, name: string) => ({
      name,
      subflowId: id,
      traversalContext: { stageId: id, runtimeStageId: `${id}#0`, stageName: name, depth: 0 },
    });
    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'classify this' }));

    // Sub-agent 'classify' — FlowRecorder fires onSubflowEntry (topology
    // discovers identity), emit events tagged with subflowPath carry the
    // per-sub-agent content. Inner sf-messages entry makes it qualify as
    // a real Agent wrapper under the new heuristic.
    t.onSubflowEntry(fakeSubflowEntry('classify', 'Classify'));
    t.onSubflowEntry(fakeSubflowEntry('sf-messages', 'Messages'));
    t.onSubflowExit(fakeSubflowEntry('sf-messages', 'Messages'));
    t.onEmit(subEvt('agentfootprint.stream.llm_start', { iteration: 1 }, ['classify']));
    t.onEmit(
      subEvt(
        'agentfootprint.stream.llm_end',
        { iteration: 1, content: 'class=A', toolCallCount: 0 },
        ['classify'],
      ),
    );
    t.onSubflowExit(fakeSubflowEntry('classify', 'Classify'));

    // Sub-agent 'analyze'
    t.onSubflowEntry(fakeSubflowEntry('analyze', 'Analyze'));
    t.onSubflowEntry(fakeSubflowEntry('sf-messages', 'Messages'));
    t.onSubflowExit(fakeSubflowEntry('sf-messages', 'Messages'));
    t.onEmit(subEvt('agentfootprint.stream.llm_start', { iteration: 1 }, ['analyze']));
    t.onEmit(
      subEvt(
        'agentfootprint.stream.llm_end',
        { iteration: 1, content: 'analysis done', toolCallCount: 0 },
        ['analyze'],
      ),
    );
    t.onSubflowExit(fakeSubflowEntry('analyze', 'Analyze'));

    // Sub-agent 'respond'
    t.onSubflowEntry(fakeSubflowEntry('respond', 'Respond'));
    t.onSubflowEntry(fakeSubflowEntry('sf-messages', 'Messages'));
    t.onSubflowExit(fakeSubflowEntry('sf-messages', 'Messages'));
    t.onEmit(subEvt('agentfootprint.stream.llm_start', { iteration: 1 }, ['respond']));
    t.onEmit(
      subEvt(
        'agentfootprint.stream.llm_end',
        { iteration: 1, content: 'final answer', toolCallCount: 0 },
        ['respond'],
      ),
    );
    t.onSubflowExit(fakeSubflowEntry('respond', 'Respond'));

    t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'final answer' }));

    const tl = snapshot(t);
    // Three distinct sub-agents, in emission order.
    expect(tl.subAgents.map((s) => s.id)).toEqual(['classify', 'analyze', 'respond']);
    // Each sub-agent has its own turn / iteration slice.
    expect(tl.subAgents[0].turns).toHaveLength(1);
    expect(tl.subAgents[0].turns[0].iterations[0].assistantContent).toBe('class=A');
    expect(tl.subAgents[1].turns[0].iterations[0].assistantContent).toBe('analysis done');
    expect(tl.subAgents[2].turns[0].iterations[0].assistantContent).toBe('final answer');
    // Single-agent runs (no subflowPath) → empty subAgents.
    const single = agentTimeline();
    single.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'hi' }));
    single.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    single.onEmit(
      evt('agentfootprint.stream.llm_end', { iteration: 1, content: 'a', toolCallCount: 0 }),
    );
    expect(single.selectSubAgents()).toEqual([]);
  });

  it('5. clear() wipes recorder state — ready for re-use across runs', () => {
    const t = agentTimeline();
    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'first' }));
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', { iteration: 1, content: 'partial', toolCallCount: 0 }),
    );

    expect(snapshot(t).turns).toHaveLength(1);
    expect(t.entryCount).toBeGreaterThan(0);

    t.clear();

    expect(snapshot(t).turns).toHaveLength(0);
    expect(t.entryCount).toBe(0);

    // After clear, llmPhaseActive is reset → context events route correctly again
    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'fresh' }));
    t.onEmit(evt('agentfootprint.context.rag.chunks', { slot: 'messages', chunkCount: 1 }));
    t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
    t.onEmit(
      evt('agentfootprint.stream.llm_end', { iteration: 1, content: 'done', toolCallCount: 0 }),
    );

    const timeline = snapshot(t);
    expect(timeline.turns).toHaveLength(1);
    expect(timeline.turns[0].userPrompt).toBe('fresh');
    // Pre-iter RAG was buffered + flushed onto iter 1
    expect(timeline.turns[0].iterations[0].contextInjections).toHaveLength(1);
    expect(timeline.turns[0].iterations[0].contextInjections[0].source).toBe('rag');
  });
});
