import { describe, it, expect, vi } from 'vitest';
import { agentLoop, mock, staticPrompt, defineTool } from '../../src/test-barrel';
import type { AgentLoopConfig, AgentRecorder } from '../../src/test-barrel';
import { fullHistory, staticTools, noTools } from '../../src/providers';
import { TurnRecorder, TokenRecorder } from '../../src/recorders';

// ── Helpers ─────────────────────────────────────────────────

function config(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    promptProvider: staticPrompt('You are helpful.'),
    messageStrategy: fullHistory(),
    toolProvider: noTools(),
    llmProvider: mock([{ content: 'Hello!' }]),
    maxIterations: 10,
    recorders: [],
    name: 'test-agent',
    ...overrides,
  };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Found: ${input.q}` }),
});

// ── Basic Loop ──────────────────────────────────────────────

describe('agentLoop', () => {
  it('executes a simple text response', async () => {
    const result = await agentLoop(config(), 'Hello');

    expect(result.content).toBe('Hello!');
    expect(result.loopIterations).toBe(1);
    expect(result.messages.length).toBeGreaterThanOrEqual(2); // user + assistant
  });

  it('includes user message in history', async () => {
    const result = await agentLoop(config(), 'Hi there');

    const userMsgs = result.messages.filter((m) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].content).toBe('Hi there');
  });

  // ── Tool Loop ──────────────────────────────────────────────

  it('executes tool calls and loops', async () => {
    const cfg = config({
      llmProvider: mock([
        {
          content: 'Searching.',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'AI' } }],
        },
        { content: 'Found results about AI.' },
      ]),
      toolProvider: staticTools([searchTool]),
    });

    const result = await agentLoop(cfg, 'Search for AI');

    expect(result.content).toBe('Found results about AI.');
    expect(result.loopIterations).toBe(2); // 1 tool call + 1 final
  });

  it('adds tool result messages to history', async () => {
    const cfg = config({
      llmProvider: mock([
        {
          content: 'Searching.',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }],
        },
        { content: 'Done.' },
      ]),
      toolProvider: staticTools([searchTool]),
    });

    const result = await agentLoop(cfg, 'test');

    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].content).toBe('Found: test');
  });

  // ── Recorders ──────────────────────────────────────────────

  it('dispatches events to recorders', async () => {
    const turnRecorder = new TurnRecorder();
    const tokenRecorder = new TokenRecorder();

    const cfg = config({
      recorders: [turnRecorder, tokenRecorder],
    });

    await agentLoop(cfg, 'Hello');

    expect(turnRecorder.getCompletedCount()).toBe(1);
    expect(tokenRecorder.getStats().totalCalls).toBe(1);
  });

  it('dispatches error events on failure', async () => {
    const turnRecorder = new TurnRecorder();

    const cfg = config({
      llmProvider: {
        chat: async () => {
          throw new Error('LLM down');
        },
      },
      recorders: [turnRecorder],
    });

    await expect(agentLoop(cfg, 'Hello')).rejects.toThrow('LLM down');
    expect(turnRecorder.getErrorCount()).toBe(1);
  });

  // ── Abort Signal ──────────────────────────────────────────

  it('respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const cfg = config();
    await expect(agentLoop(cfg, 'Hello', { signal: controller.signal })).rejects.toThrow();
  });

  // ── Multi-turn ────────────────────────────────────────────

  it('continues from existing history', async () => {
    const cfg = config({
      llmProvider: mock([{ content: 'First response.' }, { content: 'Second response.' }]),
    });

    const turn1 = await agentLoop(cfg, 'Hello');
    const turn2 = await agentLoop(cfg, 'Follow up', {
      history: turn1.messages,
      turnNumber: 1,
    });

    expect(turn2.content).toBe('Second response.');
    expect(turn2.messages.length).toBe(4); // user1 + asst1 + user2 + asst2
  });

  // ── Max Iterations ────────────────────────────────────────

  it('stops after max iterations', async () => {
    // LLM always returns tool calls
    const infiniteToolCalls = {
      chat: vi.fn(async () => ({
        content: 'calling tool',
        toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'x' } }],
        finishReason: 'tool_use' as const,
      })),
    };

    const cfg = config({
      llmProvider: infiniteToolCalls,
      toolProvider: staticTools([searchTool]),
      maxIterations: 3,
    });

    const result = await agentLoop(cfg, 'test');
    // Should stop after 3 iterations with empty content (never got final response)
    expect(result.loopIterations).toBe(3);
  });
});
