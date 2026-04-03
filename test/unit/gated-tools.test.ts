/**
 * Unit + Security tests for gatedTools — permission-based tool filtering.
 */

import { describe, it, expect, vi } from 'vitest';
import { gatedTools } from '../../src/providers/tools/gatedTools';
import { staticTools } from '../../src/providers/tools/staticTools';
import type { ToolContext } from '../../src/core';
import type { ToolDefinition } from '../../src/types/tools';

// ── Helpers ──────────────────────────────────────────────────

function makeTool(id: string): ToolDefinition {
  return {
    id,
    description: `${id} tool`,
    inputSchema: { type: 'object' },
    handler: async () => ({ content: `${id} result` }),
  };
}

const defaultCtx: ToolContext = {
  message: 'test',
  turnNumber: 1,
  loopIteration: 0,
  messages: [],
};

// ── Unit: resolve filtering ──────────────────────────────────

describe('gatedTools: resolve filtering', () => {
  it('filters out tools the user cannot access', async () => {
    const inner = staticTools([makeTool('search'), makeTool('admin'), makeTool('code')]);
    const allowed = new Set(['search', 'code']);
    const gated = gatedTools(inner, (id) => allowed.has(id));

    const resolved = await gated.resolve(defaultCtx);

    expect(resolved.value.map((t) => t.name)).toEqual(['search', 'code']);
  });

  it('returns empty array when no tools are allowed', async () => {
    const inner = staticTools([makeTool('a'), makeTool('b')]);
    const gated = gatedTools(inner, () => false);

    const resolved = await gated.resolve(defaultCtx);

    expect(resolved.value).toEqual([]);
  });

  it('returns all tools when all are allowed', async () => {
    const inner = staticTools([makeTool('a'), makeTool('b')]);
    const gated = gatedTools(inner, () => true);

    const resolved = await gated.resolve(defaultCtx);

    expect(resolved.value).toHaveLength(2);
  });

  it('supports async permission checker', async () => {
    const inner = staticTools([makeTool('search'), makeTool('admin')]);
    const gated = gatedTools(inner, async (id) => {
      await new Promise((r) => setTimeout(r, 1));
      return id === 'search';
    });

    const resolved = await gated.resolve(defaultCtx);

    expect(resolved.value.map((t) => t.name)).toEqual(['search']);
  });

  it('receives ToolContext for per-turn decisions', async () => {
    const inner = staticTools([makeTool('submit')]);
    const checker = vi.fn((id: string, ctx: ToolContext) => ctx.turnNumber > 2);
    const gated = gatedTools(inner, checker);

    // Turn 1: blocked
    const turn1 = await gated.resolve({ ...defaultCtx, turnNumber: 1 });
    expect(turn1.value).toHaveLength(0);

    // Turn 3: allowed
    const turn3 = await gated.resolve({ ...defaultCtx, turnNumber: 3 });
    expect(turn3.value).toHaveLength(1);
    expect(checker).toHaveBeenCalledTimes(2);
  });
});

// ── Unit: execute defense-in-depth ──────────────────────────

describe('gatedTools: execute defense-in-depth', () => {
  it('blocks execution of non-permitted tools', async () => {
    const inner = staticTools([makeTool('search'), makeTool('admin')]);
    const gated = gatedTools(inner, (id) => id === 'search');

    // First resolve to set context
    await gated.resolve(defaultCtx);

    // Try to execute blocked tool
    const result = await gated.execute!({ name: 'admin', arguments: {}, id: 'call-1' });

    expect(result.error).toBe(true);
    expect(result.content).toContain('Permission denied');
    expect(result.content).toContain('admin');
  });

  it('allows execution of permitted tools', async () => {
    const inner = staticTools([makeTool('search')]);
    const gated = gatedTools(inner, () => true);

    await gated.resolve(defaultCtx);
    const result = await gated.execute!({ name: 'search', arguments: {}, id: 'call-1' });

    expect(result.content).toBe('search result');
    expect(result.error).toBeUndefined();
  });

  it('preserves execute as undefined when inner has no execute', async () => {
    // dynamicTools-style provider with no execute
    const inner = { resolve: async () => ({ value: [] as any[], chosen: 'test' }) };
    const gated = gatedTools(inner, () => true);

    expect(gated.execute).toBeUndefined();
  });
});

// ── Unit: onBlocked callback ─────────────────────────────────

describe('gatedTools: onBlocked callback', () => {
  it('fires onBlocked for each filtered tool in resolve', async () => {
    const blocked: Array<{ id: string; phase: string }> = [];
    const inner = staticTools([makeTool('a'), makeTool('b'), makeTool('c')]);
    const gated = gatedTools(inner, (id) => id === 'a', {
      onBlocked: (id, phase) => blocked.push({ id, phase }),
    });

    await gated.resolve(defaultCtx);

    expect(blocked).toEqual([
      { id: 'b', phase: 'resolve' },
      { id: 'c', phase: 'resolve' },
    ]);
  });

  it('fires onBlocked when execute rejects a tool', async () => {
    const blocked: Array<{ id: string; phase: string }> = [];
    const inner = staticTools([makeTool('admin')]);
    const gated = gatedTools(inner, () => false, {
      onBlocked: (id, phase) => blocked.push({ id, phase }),
    });

    await gated.resolve(defaultCtx);
    await gated.execute!({ name: 'admin', arguments: {}, id: 'call-1' });

    expect(blocked).toContainEqual({ id: 'admin', phase: 'execute' });
  });
});

// ── Security: LLM cannot see or call blocked tools ───────────

describe('gatedTools: security invariants', () => {
  it('LLM never sees descriptions of blocked tools', async () => {
    const secretTool = makeTool('delete-database');
    const inner = staticTools([makeTool('search'), secretTool]);
    const gated = gatedTools(inner, (id) => id !== 'delete-database');

    const decision = await gated.resolve(defaultCtx);
    const names = decision.value.map((d) => d.name);

    expect(names).not.toContain('delete-database');
    // Also check descriptions don't leak
    const allText = decision.value.map((d) => d.description).join(' ');
    expect(allText).not.toContain('delete-database');
  });

  it('even if LLM hallucinates a blocked tool call, execute rejects it', async () => {
    const inner = staticTools([makeTool('search'), makeTool('admin')]);
    const gated = gatedTools(inner, (id) => id === 'search');

    await gated.resolve(defaultCtx);

    // LLM somehow asks for 'admin' (hallucination or injection)
    const result = await gated.execute!({ name: 'admin', arguments: {}, id: 'call-1' });

    expect(result.error).toBe(true);
    expect(result.content).toContain('Permission denied');
  });

  it('permission denied message goes into conversation history for LLM awareness', async () => {
    const inner = staticTools([makeTool('admin')]);
    const gated = gatedTools(inner, () => false);

    await gated.resolve(defaultCtx);
    const result = await gated.execute!({ name: 'admin', arguments: {}, id: 'call-1' });

    // This content becomes a toolResultMessage in the conversation
    // The LLM reads it and knows not to try again
    expect(result.content).toContain('not available');
    expect(result.error).toBe(true);
  });

  it('permission changes mid-conversation are respected', async () => {
    let canAccess = false;
    const inner = staticTools([makeTool('upgrade')]);
    const gated = gatedTools(inner, () => canAccess);

    // Turn 1: no access
    const turn1 = await gated.resolve(defaultCtx);
    expect(turn1.value).toHaveLength(0);

    // User grants access
    canAccess = true;

    // Turn 2: access granted
    const turn2 = await gated.resolve(defaultCtx);
    expect(turn2.value).toHaveLength(1);
    expect(turn2.value[0].name).toBe('upgrade');
  });
});
