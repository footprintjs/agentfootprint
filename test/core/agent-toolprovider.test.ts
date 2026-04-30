/**
 * Agent.toolProvider() builder method — Block A5/Neo follow-up (v2.5).
 *
 * 7-pattern matrix-lite (unit · scenario · integration · property ·
 * security · performance · ROI). Pins:
 *
 *   - Builder method is chainable + throws on double-call
 *   - Provider's tools are visible to the LLM each iteration
 *   - Tool dispatch lookup falls through to provider when not in
 *     static registry
 *   - gatedTools predicate-filtering reaches the LLM (visibility = gate)
 *   - Per-iteration ctx propagates (iteration, activeSkillId)
 *   - Static .tool() and .toolProvider() compose (both flow to LLM)
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineSkill,
  defineTool,
  gatedTools,
  mock,
  skillScopedTools,
  staticTools,
  type LLMToolSchema,
  type Tool,
} from '../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function fakeTool(name: string, body: string = 'ok'): Tool {
  return defineTool({
    name,
    description: name,
    inputSchema: { type: 'object' },
    execute: async () => `${name}:${body}`,
  });
}

// ─── 1. UNIT — builder mechanics ──────────────────────────────────

describe('Agent.toolProvider — unit: builder mechanics', () => {
  it('is chainable + builds without error', () => {
    const provider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .toolProvider(staticTools([fakeTool('a')]))
      .build();
    expect(agent).toBeDefined();
  });

  it('throws on second .toolProvider() call', () => {
    const provider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const builder = Agent.create({ provider, model: 'mock' })
      .system('s')
      .toolProvider(staticTools([fakeTool('a')]));
    expect(() => builder.toolProvider(staticTools([fakeTool('b')]))).toThrow(/already set/);
  });
});

// ─── 2. SCENARIO — provider tools reach the LLM ──────────────────

describe('Agent.toolProvider — scenario: visibility', () => {
  it("provider's tools appear in the LLM's tool schemas", async () => {
    let observedToolNames: string[] = [];
    const provider = mock({
      respond: (req: { tools?: readonly LLMToolSchema[] }) => {
        observedToolNames = (req.tools ?? []).map((t) => t.name);
        return { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .toolProvider(staticTools([fakeTool('alpha'), fakeTool('beta')]))
      .build();

    await agent.run({ message: 'go' });

    expect(observedToolNames).toContain('alpha');
    expect(observedToolNames).toContain('beta');
  });

  it('static .tool() and .toolProvider() compose — both flow to the LLM', async () => {
    let observedToolNames: string[] = [];
    const provider = mock({
      respond: (req: { tools?: readonly LLMToolSchema[] }) => {
        observedToolNames = (req.tools ?? []).map((t) => t.name);
        return { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .tool(fakeTool('static-1'))
      .toolProvider(staticTools([fakeTool('provider-1')]))
      .build();

    await agent.run({ message: 'go' });

    expect(observedToolNames).toContain('static-1');
    expect(observedToolNames).toContain('provider-1');
  });
});

// ─── 3. INTEGRATION — gatedTools filtering reaches the LLM ───────

describe('Agent.toolProvider — integration: gatedTools', () => {
  it('gatedTools predicate hides tools at the LLM surface', async () => {
    let observedToolNames: string[] = [];
    const provider = mock({
      respond: (req: { tools?: readonly LLMToolSchema[] }) => {
        observedToolNames = (req.tools ?? []).map((t) => t.name);
        return { content: 'done', toolCalls: [] };
      },
    });

    const allowed = new Set(['alpha']);
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .toolProvider(
        gatedTools(
          staticTools([fakeTool('alpha'), fakeTool('beta'), fakeTool('gamma')]),
          (toolName) => allowed.has(toolName),
        ),
      )
      .build();

    await agent.run({ message: 'go' });

    expect(observedToolNames).toContain('alpha');
    expect(observedToolNames).not.toContain('beta');
    expect(observedToolNames).not.toContain('gamma');
  });

  it('provider-supplied tool dispatches correctly when LLM calls it', async () => {
    let calls = 0;
    const provider = mock({
      respond: () => {
        calls++;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'lookup', args: { q: 'x' } }],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    });

    const lookup = defineTool({
      name: 'lookup',
      description: 'lookup',
      inputSchema: { type: 'object' },
      execute: async () => 'LOOKUP_RESULT',
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .toolProvider(staticTools([lookup]))
      .build();

    const out = await agent.run({ message: 'go' });
    expect(out).toBe('done');
    expect(calls).toBe(2);
  });
});

// ─── 4. PROPERTY — per-iteration ctx propagation ────────────────

describe('Agent.toolProvider — properties: per-iteration ctx', () => {
  it('provider receives current iteration + activeSkillId per call', async () => {
    const ctxLog: { iteration: number; activeSkillId?: string }[] = [];
    // Build a custom ToolProvider that records ctx
    const recordingProvider = {
      id: 'recording',
      list: (ctx: { iteration: number; activeSkillId?: string }) => {
        ctxLog.push({ iteration: ctx.iteration, activeSkillId: ctx.activeSkillId });
        return [];
      },
    };

    const billingSkill = defineSkill({
      id: 'billing',
      description: 'Billing skill',
      body: 'Billing playbook.',
    });

    let calls = 0;
    const provider = mock({
      respond: () => {
        calls++;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'read_skill', args: { id: 'billing' } }],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .skill(billingSkill)
      .toolProvider(recordingProvider)
      .build();
    await agent.run({ message: 'go' });

    // Provider was called multiple times — at least once before
    // skill activation, at least once after. The post-activation
    // call should see activeSkillId === 'billing'.
    expect(ctxLog.length).toBeGreaterThan(1);
    const billingCalls = ctxLog.filter((c) => c.activeSkillId === 'billing');
    expect(billingCalls.length).toBeGreaterThan(0);
  });

  it('skillScopedTools narrows visible-set per active skill', async () => {
    const observedAcrossIterations: string[][] = [];
    const provider = mock({
      respond: ((counter) => (req: { tools?: readonly LLMToolSchema[] }) => {
        observedAcrossIterations.push((req.tools ?? []).map((t) => t.name));
        counter.n++;
        if (counter.n === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'read_skill', args: { id: 'billing' } }],
          };
        }
        return { content: 'done', toolCalls: [] };
      })({ n: 0 }),
    });

    const billingTools = [fakeTool('refund')];
    const billingSkill = defineSkill({
      id: 'billing',
      description: 'Billing skill',
      body: 'Billing playbook.',
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .skill(billingSkill)
      .toolProvider(skillScopedTools('billing', billingTools))
      .build();
    await agent.run({ message: 'go' });

    // Iter 1 (no active skill): refund NOT visible
    expect(observedAcrossIterations[0]).not.toContain('refund');
    // Iter 2 (billing active): refund IS visible
    expect(observedAcrossIterations[1]).toContain('refund');
  });
});

// ─── 5. SECURITY — gate hiding works at dispatch too ─────────────

describe('Agent.toolProvider — security: gate honored on dispatch', () => {
  it('LLM tries to call a gated-out tool → tool dispatch fails (tool not in registry)', async () => {
    let calls = 0;
    let lastResult = '';
    const provider = mock({
      respond: (req: { messages: readonly { role: string; content: string }[] }) => {
        // Capture the most recent tool result (so we see the synthetic
        // "tool not found" error the framework returns)
        for (const m of req.messages) if (m.role === 'tool') lastResult = m.content;
        calls++;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'forbidden_tool', args: {} }],
          };
        }
        return { content: 'final', toolCalls: [] };
      },
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .toolProvider(gatedTools(staticTools([fakeTool('forbidden_tool')]), () => false))
      .build();
    await agent.run({ message: 'go' });

    // The gated tool was invisible; LLM hallucinated a call to it;
    // framework synthesized an error result. Verify it surfaces in
    // the tool message the LLM saw.
    expect(lastResult.toLowerCase()).toMatch(/unknown|not found|missing|denied/);
  });
});
