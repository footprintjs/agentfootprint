/**
 * Permission events — 7-pattern tests for Agent tool-call gating.
 *
 * When a `permissionChecker` adapter is provided, Agent calls
 * `checker.check({capability: 'tool_call', actor: 'agent', target: <tool>, context: <args>})`
 * BEFORE every `tool.execute`. Emits `agentfootprint.permission.check`
 * with the decision. On `deny`, the tool is skipped and its result is a
 * synthetic denial string so the LLM sees a coherent tool message. On
 * `allow`/`gate_open`, execution proceeds normally. A throwing checker
 * is treated as deny-by-default with the thrown error surfaced in the
 * denial rationale.
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import type {
  LLMProvider,
  LLMResponse,
  PermissionChecker,
  PermissionDecision,
  PermissionRequest,
} from '../../../src/adapters/types.js';

function scripted(...r: LLMResponse[]): LLMProvider {
  let i = 0;
  return { name: 'mock', complete: async () => r[Math.min(i++, r.length - 1)] };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 100, output: 50 },
    stopReason: toolCalls.length ? 'tool_use' : 'stop',
  };
}

function allowAll(): PermissionChecker {
  return {
    name: 'allow-all',
    check: async (_req: PermissionRequest): Promise<PermissionDecision> => ({
      result: 'allow',
    }),
  };
}

function denyToolNamed(name: string, rationale: string): PermissionChecker {
  return {
    name: 'tool-deny',
    check: async (req: PermissionRequest): Promise<PermissionDecision> =>
      req.target === name ? { result: 'deny', rationale, policyRuleId: 'r1' } : { result: 'allow' },
  };
}

// ── 1. Unit — no checker = no events ────────────────────────────────

describe('permission — unit', () => {
  it('zero permission events when no checker is configured', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'noop', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    let checks = 0;
    agent.on('agentfootprint.permission.check', () => checks++);
    await agent.run({ message: 'go' });
    expect(checks).toBe(0);
  });
});

// ── 2. Scenario — allow/deny decisions ──────────────────────────────

describe('permission — scenario', () => {
  it('allow decision lets tool execute; permission.check event fires with result=allow', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'safe', args: { action: 'read' } }]),
        resp('done'),
      ),
      model: 'mock',
      permissionChecker: allowAll(),
    })
      .system('')
      .tool({
        schema: { name: 'safe', description: '', inputSchema: { type: 'object' } },
        execute: () => 'safe-ran',
      })
      .build();

    const checks: unknown[] = [];
    agent.on('agentfootprint.permission.check', (e) => checks.push(e.payload));
    const out = await agent.run({ message: 'go' });

    expect(checks).toHaveLength(1);
    expect((checks[0] as { result: string }).result).toBe('allow');
    expect((checks[0] as { target: string }).target).toBe('safe');
    expect(out).toBe('done');
  });

  it('deny decision skips tool.execute; permission.check fires with result=deny', async () => {
    const executeSpy = vi.fn(() => 'should-not-run');
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'danger', args: { action: 'drop-table' } }]),
        resp('done'),
      ),
      model: 'mock',
      permissionChecker: denyToolNamed('danger', 'destructive-sql-forbidden'),
    })
      .system('')
      .tool({
        schema: { name: 'danger', description: '', inputSchema: { type: 'object' } },
        execute: executeSpy,
      })
      .build();

    const checks: unknown[] = [];
    const toolEnds: unknown[] = [];
    agent.on('agentfootprint.permission.check', (e) => checks.push(e.payload));
    agent.on('agentfootprint.stream.tool_end', (e) => toolEnds.push(e.payload));

    await agent.run({ message: 'go' });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(checks).toHaveLength(1);
    expect((checks[0] as { result: string }).result).toBe('deny');
    expect((checks[0] as { rationale: string }).rationale).toBe('destructive-sql-forbidden');
    // Tool end still fires — LLM sees the denial string as the tool result.
    expect(toolEnds).toHaveLength(1);
    expect(String((toolEnds[0] as { result: unknown }).result)).toContain('permission denied');
  });
});

// ── 3. Integration — denial flows back to the LLM ───────────────────

describe('permission — integration', () => {
  it('LLM receives the denial string as the tool message and can keep iterating', async () => {
    const seenToolContents: string[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (req) => {
        const toolMsgs = req.messages.filter((m) => m.role === 'tool');
        if (toolMsgs.length > 0) {
          seenToolContents.push(toolMsgs[toolMsgs.length - 1]!.content);
          return resp('handled');
        }
        return resp('', [{ id: 'x', name: 'nuke', args: {} }]);
      },
    };
    const agent = Agent.create({
      provider,
      model: 'mock',
      permissionChecker: denyToolNamed('nuke', 'too-risky'),
    })
      .system('')
      .tool({
        schema: { name: 'nuke', description: '', inputSchema: { type: 'object' } },
        execute: () => 'never',
      })
      .build();

    const out = await agent.run({ message: 'please nuke' });
    expect(out).toBe('handled');
    expect(seenToolContents).toHaveLength(1);
    expect(seenToolContents[0]).toContain('permission denied');
    expect(seenToolContents[0]).toContain('too-risky');
  });
});

// ── 4. Property — one check per tool call invocation ────────────────

describe('permission — property', () => {
  it.each([1, 2, 3])('N tool calls in one iteration → N permission.check events', async (n) => {
    const toolCalls = [];
    for (let i = 0; i < n; i++) toolCalls.push({ id: `t${i}`, name: 'noop', args: {} });
    const agent = Agent.create({
      provider: scripted(resp('', toolCalls), resp('done')),
      model: 'mock',
      permissionChecker: allowAll(),
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    let checks = 0;
    agent.on('agentfootprint.permission.check', () => checks++);
    await agent.run({ message: 'go' });
    expect(checks).toBe(n);
  });

  it('every decision variant (allow / deny / gate_open) round-trips through the event', async () => {
    const decisions: PermissionDecision[] = [
      { result: 'allow' },
      { result: 'deny', rationale: 'r1' },
      { result: 'gate_open', gateId: 'g1', rationale: 'r2' },
    ];
    for (const expected of decisions) {
      const checker: PermissionChecker = {
        name: 'c',
        check: async () => expected,
      };
      const agent = Agent.create({
        provider: scripted(resp('', [{ id: 't', name: 'x', args: {} }]), resp('done')),
        model: 'mock',
        permissionChecker: checker,
      })
        .system('')
        .tool({
          schema: { name: 'x', description: '', inputSchema: { type: 'object' } },
          execute: () => 'ok',
        })
        .build();

      let observed: unknown;
      agent.on('agentfootprint.permission.check', (e) => {
        observed = e.payload;
      });
      await agent.run({ message: 'go' });
      expect((observed as { result: string }).result).toBe(expected.result);
    }
  });
});

// ── 5. Security — throwing checker fails closed (deny) ──────────────

describe('permission — security', () => {
  it('checker that throws is treated as deny (fail-closed)', async () => {
    const executeSpy = vi.fn(() => 'should-not-run');
    const brokenChecker: PermissionChecker = {
      name: 'broken',
      check: async () => {
        throw new Error('policy-adapter-down');
      },
    };
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't', name: 'x', args: {} }]), resp('recovered')),
      model: 'mock',
      permissionChecker: brokenChecker,
    })
      .system('')
      .tool({
        schema: { name: 'x', description: '', inputSchema: { type: 'object' } },
        execute: executeSpy,
      })
      .build();

    const checks: unknown[] = [];
    agent.on('agentfootprint.permission.check', (e) => checks.push(e.payload));

    await agent.run({ message: 'go' });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(checks).toHaveLength(1);
    expect((checks[0] as { result: string }).result).toBe('deny');
    expect((checks[0] as { rationale: string }).rationale).toContain('policy-adapter-down');
  });

  it('non-Error thrown from checker is coerced to a string in the event', async () => {
    const checker: PermissionChecker = {
      name: 'weird',
      check: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { mysterious: 'object' };
      },
    };
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't', name: 'x', args: {} }]), resp('ok')),
      model: 'mock',
      permissionChecker: checker,
    })
      .system('')
      .tool({
        schema: { name: 'x', description: '', inputSchema: { type: 'object' } },
        execute: () => 'nope',
      })
      .build();

    let rationale: string | undefined;
    agent.on('agentfootprint.permission.check', (e) => {
      rationale = e.payload.rationale;
    });
    await agent.run({ message: 'go' });
    expect(typeof rationale).toBe('string');
    expect(rationale).toContain('permission-checker threw');
  });
});

// ── 6. Performance — happy path negligible overhead ─────────────────

describe('permission — performance', () => {
  it('adding permissionChecker adds negligible overhead to a single run', async () => {
    const agent = Agent.create({
      provider: scripted(resp('done')),
      model: 'mock',
      permissionChecker: allowAll(),
    })
      .system('')
      .build();

    const t0 = performance.now();
    for (let i = 0; i < 10; i++) await agent.run({ message: `r${i}` });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
  });
});

// ── 7. ROI — reuse across many runs without state leak ──────────────

describe('permission — ROI', () => {
  it('checker is called fresh per tool call across many runs', async () => {
    const checker = vi.fn(async () => ({ result: 'allow' as const }));
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async (req) => {
          const hadTool = req.messages.some((m) => m.role === 'tool');
          return hadTool ? resp('done') : resp('', [{ id: 't', name: 'noop', args: {} }]);
        },
      },
      model: 'mock',
      permissionChecker: { name: 'spy', check: checker },
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    for (let i = 0; i < 5; i++) await agent.run({ message: `r${i}` });
    expect(checker).toHaveBeenCalledTimes(5);
  });
});
