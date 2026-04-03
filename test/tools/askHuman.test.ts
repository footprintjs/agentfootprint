/**
 * askHuman tool — 5-pattern tests.
 *
 * Tests the built-in ask_human tool that pauses the agent loop for human input.
 */
import { describe, expect, it } from 'vitest';

import { askHuman, ASK_HUMAN_MARKER, isAskHumanResult } from '../../src/tools/askHuman';
import type { ToolResult } from '../../src/types/tools';

// ── Unit ────────────────────────────────────────────────────

describe('askHuman — unit', () => {
  it('creates a tool definition with correct id and schema', () => {
    const tool = askHuman();
    expect(tool.id).toBe('ask_human');
    expect(tool.inputSchema).toBeDefined();
    expect((tool.inputSchema as any).properties.question).toBeDefined();
    expect((tool.inputSchema as any).required).toContain('question');
  });

  it('handler returns AskHumanResult with marker and question', async () => {
    const tool = askHuman();
    const result = await tool.handler({ question: 'What is your order ID?' });

    expect(isAskHumanResult(result)).toBe(true);
    expect((result as any).question).toBe('What is your order ID?');
    expect((result as any)[ASK_HUMAN_MARKER]).toBe(true);
    expect(result.content).toContain('What is your order ID?');
  });

  it('isAskHumanResult returns false for regular ToolResult', () => {
    const regular: ToolResult = { content: 'hello' };
    expect(isAskHumanResult(regular)).toBe(false);
  });

  it('custom description overrides default', () => {
    const tool = askHuman('Ask the user for their email address.');
    expect(tool.description).toBe('Ask the user for their email address.');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('askHuman — boundary', () => {
  it('handler with empty question', async () => {
    const tool = askHuman();
    const result = await tool.handler({ question: '' });

    expect(isAskHumanResult(result)).toBe(true);
    expect((result as any).question).toBe('');
  });

  it('handler with missing question field', async () => {
    const tool = askHuman();
    const result = await tool.handler({});

    expect(isAskHumanResult(result)).toBe(true);
    expect((result as any).question).toBe('');
  });

  it('default description mentions asking human', () => {
    const tool = askHuman();
    expect(tool.description.toLowerCase()).toContain('human');
    expect(tool.description.toLowerCase()).toContain('question');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('askHuman — scenario', () => {
  it('tool result content includes the question for LLM context', async () => {
    const tool = askHuman();
    const result = await tool.handler({ question: 'Approve this refund of $299?' });

    // The content string should mention the question so the LLM knows what was asked
    expect(result.content).toContain('Approve this refund of $299?');
  });
});

// ── Property ────────────────────────────────────────────────

describe('askHuman — property', () => {
  it('every call produces a fresh result (no shared state)', async () => {
    const tool = askHuman();

    const r1 = await tool.handler({ question: 'First?' });
    const r2 = await tool.handler({ question: 'Second?' });

    expect((r1 as any).question).toBe('First?');
    expect((r2 as any).question).toBe('Second?');
    expect(r1).not.toBe(r2);
  });

  it('result has no error flag', async () => {
    const tool = askHuman();
    const result = await tool.handler({ question: 'OK?' });

    expect(result.error).toBeUndefined();
  });
});

// ── Security ────────────────────────────────────────────────

describe('askHuman — security', () => {
  it('question is string-coerced (no injection)', async () => {
    const tool = askHuman();
    const result = await tool.handler({ question: { toString: () => 'safe' } as any });

    expect((result as any).question).toBe('safe');
  });

  it('ASK_HUMAN_MARKER is a Symbol (cannot be forged via JSON)', () => {
    expect(typeof ASK_HUMAN_MARKER).toBe('symbol');

    // JSON.parse cannot produce symbols
    const fake = JSON.parse('{"content":"fake","question":"q"}');
    expect(isAskHumanResult(fake)).toBe(false);
  });
});
