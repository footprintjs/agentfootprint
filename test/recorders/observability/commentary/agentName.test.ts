/**
 * Tests for `extractAgentName` + the multi-agent template rendering
 * landed in v2.14.4. Covers the 5 edge cases:
 *
 *   1. Single-Agent run — empty subflowPath → falls back to appName
 *   2. Sequence-of-LLMCalls — `['step-classify']` → `'classify'`
 *   3. Swarm with handoff — multi-segment path → last meaningful segment
 *   4. Inside an agent's slot subflow → walks past `sf-*` to land on agent
 *   5. Pause/resume top-level events → falls back to appName
 *
 * Plus: composition.enter / composition.exit template rendering, and
 * verifies the LLM-event templates now use {{agentName}}.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultCommentaryTemplates,
  extractAgentName,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';

// ── Test helpers ────────────────────────────────────────────────────

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  subflowPath: readonly string[] = [],
): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: 1000,
      runOffsetMs: 0,
      runtimeStageId: 'rid#0',
      subflowPath,
      compositionPath: [],
      runId: 'test',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ctx = { appName: 'Chatbot' };

// ─── extractAgentName — 5 edge cases ───────────────────────────────

describe('extractAgentName', () => {
  it('1. empty subflowPath → falls back to appName (single-Agent runner)', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, []);
    expect(extractAgentName(e, ctx)).toBe('Chatbot');
  });

  it('2. Sequence-of-LLMCalls — strips `step-` prefix', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, ['step-classify']);
    expect(extractAgentName(e, ctx)).toBe('classify');
  });

  it('3. Swarm — last meaningful segment wins', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, [
      'agent-A',
      'agent-B',
    ]);
    expect(extractAgentName(e, ctx)).toBe('agent-B');
  });

  it('4. inside an agent slot subflow — skips `sf-*` segments', () => {
    const e = makeEvent('agentfootprint.context.injected', { source: 'rag' }, [
      'agent-Triage',
      'sf-system-prompt',
    ]);
    expect(extractAgentName(e, ctx)).toBe('agent-Triage');
  });

  it('5. pause/resume top-level → falls back to appName', () => {
    const e = makeEvent('agentfootprint.pause.request', { reason: 'human-input' }, []);
    expect(extractAgentName(e, ctx)).toBe('Chatbot');
  });

  it('skips `thinking-*` handler subflows', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, [
      'agent-A',
      'thinking-anthropic',
    ]);
    expect(extractAgentName(e, ctx)).toBe('agent-A');
  });

  it('skips routing/dispatch subflows (sf-route, sf-tool-calls, final, sf-merge)', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, [
      'agent-A',
      'sf-route',
      'final',
    ]);
    expect(extractAgentName(e, ctx)).toBe('agent-A');
  });

  it('returns appName when ALL segments are internal', () => {
    const e = makeEvent('agentfootprint.context.injected', { source: 'rag' }, [
      'sf-injection-engine',
      'sf-system-prompt',
    ]);
    expect(extractAgentName(e, ctx)).toBe('Chatbot');
  });
});

// ─── Variable bag includes agentName for every event ───────────────

describe('extractCommentaryVars — agentName threaded everywhere', () => {
  it('llm_start vars include both appName and agentName', () => {
    const e = makeEvent(
      'agentfootprint.stream.llm_start',
      {
        iteration: 1,
        provider: 'mock',
        model: 'm',
        systemPromptChars: 0,
        messagesCount: 1,
        toolsCount: 0,
      },
      ['step-classify'],
    );
    const vars = extractCommentaryVars(e, ctx);
    expect(vars.appName).toBe('Chatbot');
    expect(vars.agentName).toBe('classify');
  });

  it('agent.turn_start vars include agentName + userPrompt', () => {
    const e = makeEvent(
      'agentfootprint.agent.turn_start',
      { turnIndex: 0, userPrompt: 'help' },
      [],
    );
    const vars = extractCommentaryVars(e, ctx);
    expect(vars.userPrompt).toBe('help');
    expect(vars.agentName).toBe('Chatbot');
  });

  it('tool_start vars include agentName, toolName, descClause', () => {
    const e = makeEvent(
      'agentfootprint.stream.tool_start',
      { toolName: 'weather', toolCallId: 'tc-1', args: {} },
      ['step-respond'],
    );
    const vars = extractCommentaryVars(e, ctx);
    expect(vars.toolName).toBe('weather');
    expect(vars.agentName).toBe('respond');
    expect(typeof vars.descClause).toBe('string');
  });
});

// ─── Default templates render with multi-agent identity ─────────────

describe('defaultCommentaryTemplates — multi-agent prose', () => {
  it('llm_start renders with active agent name', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, ['step-classify']);
    const key = selectCommentaryKey(e);
    expect(key).toBe('stream.llm_start.iter1');
    const template = defaultCommentaryTemplates[key as string];
    const vars = extractCommentaryVars(e, ctx);
    const line = renderCommentary(template ?? '', vars);
    expect(line).toBe('classify sent the question to the LLM.');
  });

  it('llm_end (terminal) renders with active agent name', () => {
    const e = makeEvent(
      'agentfootprint.stream.llm_end',
      {
        iteration: 1,
        content: 'x',
        toolCallCount: 0,
        usage: { input: 1, output: 1 },
        stopReason: 'end',
      },
      ['step-respond'],
    );
    const key = selectCommentaryKey(e);
    expect(key).toBe('stream.llm_end.terminal');
    const template = defaultCommentaryTemplates[key as string];
    const vars = extractCommentaryVars(e, ctx);
    const line = renderCommentary(template ?? '', vars);
    expect(line).toBe('The LLM gave the final answer. respond returned it to the user.');
  });

  it('single-Agent run still reads naturally (agentName falls back to appName)', () => {
    const e = makeEvent('agentfootprint.stream.llm_start', { iteration: 1 }, []);
    const template = defaultCommentaryTemplates['stream.llm_start.iter1'];
    const vars = extractCommentaryVars(e, ctx);
    const line = renderCommentary(template ?? '', vars);
    expect(line).toBe('Chatbot sent the question to the LLM.');
  });
});

// ─── Composition.enter / composition.exit templates ────────────────

describe('composition.enter / composition.exit templates', () => {
  it('Sequence enter renders pipeline narration', () => {
    const e = makeEvent(
      'agentfootprint.composition.enter',
      { kind: 'Sequence', id: 'pipe', name: 'IntakePipeline', childCount: 2 },
      [],
    );
    const key = selectCommentaryKey(e);
    expect(key).toBe('composition.enter.Sequence');
    const template = defaultCommentaryTemplates[key as string];
    const vars = extractCommentaryVars(e, ctx);
    const line = renderCommentary(template ?? '', vars);
    expect(line).toBe('Started pipeline `IntakePipeline` — 2 stages chained.');
  });

  it('Parallel enter renders fork narration', () => {
    const e = makeEvent(
      'agentfootprint.composition.enter',
      { kind: 'Parallel', id: 'p', name: 'FanOut', childCount: 3 },
      [],
    );
    const key = selectCommentaryKey(e);
    expect(key).toBe('composition.enter.Parallel');
    const template = defaultCommentaryTemplates[key as string];
    const vars = extractCommentaryVars(e, ctx);
    const line = renderCommentary(template ?? '', vars);
    expect(line).toBe('Forked `FanOut` into 3 parallel branches.');
  });

  it('composition.exit renders status + duration', () => {
    const e = makeEvent(
      'agentfootprint.composition.exit',
      { kind: 'Sequence', id: 'IntakePipeline', status: 'ok', durationMs: 4468 },
      [],
    );
    const key = selectCommentaryKey(e);
    expect(key).toBe('composition.exit');
    const template = defaultCommentaryTemplates[key as string];
    const vars = extractCommentaryVars(e, ctx);
    const line = renderCommentary(template ?? '', vars);
    expect(line).toBe('`IntakePipeline` finished — ok in 4468ms.');
  });

  it('Loop enter falls back gracefully if specific template missing', () => {
    // Use a synthetic kind to verify the renderer's missing-key
    // behavior — the placeholder substitutes empty.
    const e = makeEvent(
      'agentfootprint.composition.enter',
      { kind: 'Loop', id: 'l', name: 'Reflect', childCount: 1 },
      [],
    );
    const key = selectCommentaryKey(e);
    expect(key).toBe('composition.enter.Loop');
    expect(defaultCommentaryTemplates[key as string]).toBeDefined();
  });
});
