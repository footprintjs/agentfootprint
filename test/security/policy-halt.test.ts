/**
 * Policy halt — v2.12 PermissionChecker extensions.
 *
 * Pins the contract for sequence-aware permission checking:
 *   1. Enriched ctx — sequence, history, iteration, identity, signal
 *      land on PermissionRequest
 *   2. 'halt' result — terminates run via PolicyHaltError with full
 *      forensic context (sequence, history, proposed call)
 *   3. tellLLM — synthetic tool_result content is consumer-controlled
 *   4. Strict ordering — synthetic result lands in history BEFORE
 *      the throw so audit trail is complete
 *   5. agentfootprint.permission.halt event fires before throw
 *   6. extractSequence — derived from history, ignores synthetic denies
 *   7. Async checker — Promise return path works
 *   8. No regression — 'allow' / 'deny' / 'gate_open' unchanged
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  mock,
  PolicyHaltError,
  type LLMMessage,
  type LLMToolSchema,
  type PermissionChecker,
  type Tool,
  type ToolCallEntry,
} from '../../src/index.js';
import { extractSequence, SYNTHETIC_DENY_PREFIX } from '../../src/security/extractSequence.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function fakeTool(name: string, body = 'ok'): Tool {
  return defineTool({
    name,
    description: name,
    inputSchema: { type: 'object' },
    execute: async () => `${name}:${body}`,
  });
}

// ─── 1. ENRICHED CTX — what arrives at check() ───────────────────

describe('PermissionChecker — enriched ctx (v2.12)', () => {
  it('check() receives sequence, history, iteration, identity', async () => {
    const seen: Array<{
      target?: string;
      sequenceLength?: number;
      historyLength?: number;
      iteration?: number;
      tenant?: string;
    }> = [];
    const checker: PermissionChecker = {
      name: 'inspector',
      check: ({ target, sequence, history, iteration, identity }) => {
        seen.push({
          target,
          sequenceLength: sequence?.length,
          historyLength: history?.length,
          iteration,
          tenant: identity?.tenant,
        });
        return { result: 'allow' };
      },
    };
    let calls = 0;
    const llm = mock({
      respond: () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'lookupOrder', args: { id: '42' } }],
          };
        }
        if (calls === 2) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-2', name: 'searchKB', args: { q: 'export' } }],
          };
        }
        return { content: 'final', toolCalls: [] };
      },
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      maxIterations: 5,
      permissionChecker: checker || policy,
    })
      .system('s')
      .tools([fakeTool('lookupOrder'), fakeTool('searchKB')])
      /* moved to create */
      .build();
    await agent.run({
      message: 'go',
      identity: { tenant: 'acme', conversationId: 'c1' },
    });
    expect(seen).toHaveLength(2);
    // First check: empty sequence (no calls dispatched yet)
    expect(seen[0]?.target).toBe('lookupOrder');
    expect(seen[0]?.sequenceLength).toBe(0);
    expect(seen[0]?.iteration).toBe(1);
    expect(seen[0]?.tenant).toBe('acme');
    // Second check: sequence has the first call
    expect(seen[1]?.target).toBe('searchKB');
    expect(seen[1]?.sequenceLength).toBe(1);
    expect(seen[1]?.iteration).toBe(2);
  });
});

// ─── 2. HALT RESULT → PolicyHaltError ────────────────────────────

describe('PermissionChecker — halt → PolicyHaltError', () => {
  it("returning { result: 'halt' } throws PolicyHaltError with full context", async () => {
    const checker: PermissionChecker = {
      name: 'security-policy',
      check: ({ target }) => {
        if (target === 'slackDM') {
          return {
            result: 'halt',
            reason: 'security:exfiltration',
            tellLLM: 'This tool combination is restricted. Operation logged.',
          };
        }
        return { result: 'allow' };
      },
    };
    let calls = 0;
    const llm = mock({
      respond: () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'runPython', args: { src: 'shutil.copy()' } }],
          };
        }
        return { content: '', toolCalls: [{ id: 'tc-2', name: 'slackDM', args: { msg: 'leak' } }] };
      },
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      maxIterations: 5,
      permissionChecker: checker || policy,
    })
      .system('s')
      .tools([fakeTool('runPython'), fakeTool('slackDM')])
      /* moved to create */
      .build();

    let caught: PolicyHaltError | undefined;
    try {
      await agent.run({ message: 'go' });
    } catch (e) {
      caught = e as PolicyHaltError;
    }
    expect(caught).toBeInstanceOf(PolicyHaltError);
    const err = caught!;
    expect(err.reason).toBe('security:exfiltration');
    expect(err.tellLLM).toBe('This tool combination is restricted. Operation logged.');
    expect(err.proposed.name).toBe('slackDM');
    expect(err.checkerId).toBe('security-policy');
    expect(err.iteration).toBeGreaterThan(0);
    expect(err.sequence.map((c) => c.name)).toContain('runPython');
    expect(err.sequence.map((c) => c.name)).toContain('slackDM');
    // History must contain the synthetic tool_result for slackDM
    const last = err.history[err.history.length - 1];
    expect(last?.role).toBe('tool');
    expect(last?.content).toContain('restricted');
  });

  it('halt without tellLLM defaults to a generic message (NOT the reason tag)', async () => {
    const checker: PermissionChecker = {
      name: 'p',
      check: () => ({ result: 'halt', reason: 'security:secret-tag-do-not-leak' }),
    };
    const llm = mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'doStuff', args: {} }],
      }),
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      permissionChecker: checker || policy,
    })
      .system('s')
      .tool(fakeTool('doStuff'))
      /* moved to create */
      .build();
    try {
      await agent.run({ message: 'go' });
      expect.fail('expected halt');
    } catch (e) {
      const err = e as PolicyHaltError;
      // Default message should be SAFE — never reveal the telemetry tag
      expect(err.tellLLM).not.toContain('secret-tag-do-not-leak');
      expect(err.tellLLM).toContain('not available');
    }
  });
});

// ─── 3. agentfootprint.permission.halt EVENT ─────────────────────

describe('PermissionChecker — permission.halt event', () => {
  it('emits permission.halt with reason + tellLLM + iteration + sequenceLength', async () => {
    const events: Array<{
      reason: string;
      tellLLM?: string;
      iteration: number;
      sequenceLength: number;
      target: string;
      checkerId?: string;
    }> = [];
    const checker: PermissionChecker = {
      name: 'event-test',
      check: () => ({
        result: 'halt',
        reason: 'cost:runaway',
        tellLLM: 'Try fewer tools.',
      }),
    };
    const llm = mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'expensiveOp', args: {} }],
      }),
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      permissionChecker: checker || policy,
    })
      .system('s')
      .tool(fakeTool('expensiveOp'))
      /* moved to create */
      .build();
    agent.on('agentfootprint.permission.halt', (e) => {
      events.push({
        reason: e.payload.reason,
        ...(e.payload.tellLLM !== undefined && { tellLLM: e.payload.tellLLM }),
        iteration: e.payload.iteration,
        sequenceLength: e.payload.sequenceLength,
        target: e.payload.target,
        ...(e.payload.checkerId !== undefined && { checkerId: e.payload.checkerId }),
      });
    });
    await expect(agent.run({ message: 'go' })).rejects.toThrow(PolicyHaltError);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      reason: 'cost:runaway',
      tellLLM: 'Try fewer tools.',
      iteration: 1,
      sequenceLength: 1, // includes the proposed (denied) call
      target: 'expensiveOp',
      checkerId: 'event-test',
    });
  });
});

// ─── 4. STRICT ORDERING — synthetic before throw ─────────────────

describe('PermissionChecker — strict halt ordering', () => {
  it('synthetic tool_result lands in history BEFORE PolicyHaltError throws', async () => {
    const checker: PermissionChecker = {
      name: 'p',
      check: () => ({
        result: 'halt',
        reason: 'security:test',
        tellLLM: 'BLOCKED-MARKER-XYZ',
      }),
    };
    const llm = mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'doStuff', args: {} }],
      }),
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      permissionChecker: checker || policy,
    })
      .system('s')
      .tool(fakeTool('doStuff'))
      /* moved to create */
      .build();
    try {
      await agent.run({ message: 'go' });
      expect.fail('expected halt');
    } catch (e) {
      const err = e as PolicyHaltError;
      // The marker MUST be in history — proves synthetic landed before throw
      const found = err.history.some(
        (m) => typeof m.content === 'string' && m.content.includes('BLOCKED-MARKER-XYZ'),
      );
      expect(found).toBe(true);
    }
  });
});

// ─── 5. extractSequence — pure helper ────────────────────────────

describe('extractSequence — derive sequence from history', () => {
  it('returns dispatched tool calls in order', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', name: 'lookupOrder', args: { id: '1' } }],
      },
      { role: 'tool', toolCallId: 'a', toolName: 'lookupOrder', content: 'order data' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'b', name: 'searchKB', args: { q: 'x' } }],
      },
      { role: 'tool', toolCallId: 'b', toolName: 'searchKB', content: 'kb result' },
    ];
    const seq = extractSequence(history, 3);
    expect(seq.map((c) => c.name)).toEqual(['lookupOrder', 'searchKB']);
  });

  it('skips calls that produced synthetic deny tool_results', () => {
    const history: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', name: 'good', args: {} }],
      },
      { role: 'tool', toolCallId: 'a', toolName: 'good', content: 'ok' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'b', name: 'denied', args: {} }],
      },
      {
        role: 'tool',
        toolCallId: 'b',
        toolName: 'denied',
        content: `${SYNTHETIC_DENY_PREFIX} policy]`,
      },
    ];
    const seq = extractSequence(history, 2);
    expect(seq.map((c) => c.name)).toEqual(['good']); // 'denied' filtered out
  });

  it('returns empty array for empty history', () => {
    expect(extractSequence([], 1)).toEqual([]);
  });

  it('uses resolveProviderId option when supplied', () => {
    const history: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', name: 'rube.translate', args: {} }],
      },
      { role: 'tool', toolCallId: 'a', toolName: 'rube.translate', content: 'ok' },
    ];
    const seq = extractSequence(history, 1, {
      resolveProviderId: (name) => (name.startsWith('rube.') ? 'rube' : 'local'),
    });
    expect(seq[0]?.providerId).toBe('rube');
  });
});

// ─── 6. ASYNC CHECKER ────────────────────────────────────────────

describe('PermissionChecker — async check() returns Promise', () => {
  it('async check resolving to halt works end-to-end', async () => {
    const checker: PermissionChecker = {
      name: 'async',
      check: async () => {
        await Promise.resolve();
        return { result: 'halt', reason: 'async-halt', tellLLM: 'denied async' };
      },
    };
    const llm = mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'doStuff', args: {} }],
      }),
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      permissionChecker: checker || policy,
    })
      .system('s')
      .tool(fakeTool('doStuff'))
      /* moved to create */
      .build();
    await expect(agent.run({ message: 'go' })).rejects.toThrow(/async-halt/);
  });
});

// ─── 7. NO REGRESSION — allow / deny / gate_open ─────────────────

describe('PermissionChecker — no regression on existing results', () => {
  it("'allow' lets the tool execute and run completes normally", async () => {
    const checker: PermissionChecker = {
      name: 'allow-all',
      check: () => ({ result: 'allow' }),
    };
    let calls = 0;
    const llm = mock({
      respond: () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'doStuff', args: {} }],
          };
        }
        return { content: 'all good', toolCalls: [] };
      },
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      permissionChecker: checker || policy,
    })
      .system('s')
      .tool(fakeTool('doStuff'))
      /* moved to create */
      .build();
    const out = await agent.run({ message: 'go' });
    expect(typeof out === 'string' ? out : (out as { content: string }).content).toBe('all good');
  });

  it("'deny' yields synthetic tool_result, run continues, no PolicyHaltError thrown", async () => {
    const checker: PermissionChecker = {
      name: 'deny-doStuff',
      check: ({ target }) =>
        target === 'doStuff'
          ? { result: 'deny', tellLLM: 'denied — try other approach' }
          : { result: 'allow' },
    };
    let calls = 0;
    let lastToolMessage = '';
    const llm = mock({
      respond: (req: { messages: readonly { role: string; content: string }[] }) => {
        for (const m of req.messages) if (m.role === 'tool') lastToolMessage = m.content;
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'doStuff', args: {} }],
          };
        }
        return { content: 'recovered', toolCalls: [] };
      },
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      maxIterations: 5,
      permissionChecker: checker || policy,
    })
      .system('s')
      .tool(fakeTool('doStuff'))
      /* moved to create */
      .build();
    const out = await agent.run({ message: 'go' });
    expect(typeof out === 'string' ? out : (out as { content: string }).content).toBe('recovered');
    expect(lastToolMessage).toContain('denied — try other approach');
  });
});

// ─── 8. SEQUENCE-AWARE POLICY (the user-land recipe) ─────────────

describe('PermissionChecker — sequence-aware user-land policy', () => {
  it('forbidden-suffix policy halts when [runPython → slack.*] forms', async () => {
    function suffixMatches(seq: readonly ToolCallEntry[], pattern: readonly string[]): boolean {
      if (seq.length < pattern.length) return false;
      const tail = seq.slice(-pattern.length);
      return pattern.every((p, i) => {
        const call = tail[i]!;
        if (p.endsWith('.*')) return call.name.startsWith(p.slice(0, -1));
        return call.name === p;
      });
    }

    const policy: PermissionChecker = {
      name: 'sequence-governance',
      check: ({ capability, target, context, sequence }) => {
        if (capability !== 'tool_call') return { result: 'allow' };
        const wouldBe: ToolCallEntry[] = [
          ...(sequence ?? []),
          { name: target!, args: context, iteration: 1 },
        ];
        if (suffixMatches(wouldBe, ['runPython', 'slack.*'])) {
          return {
            result: 'halt',
            reason: 'security:exfiltration',
            tellLLM: 'This combination is restricted.',
          };
        }
        return { result: 'allow' };
      },
    };

    let calls = 0;
    const llm = mock({
      respond: (req: { tools?: readonly LLMToolSchema[] }) => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'runPython', args: { src: 'leak' } }],
          };
        }
        return {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'slack.sendDM', args: { to: 'me' } }],
        };
      },
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      maxIterations: 5,
      permissionChecker: policy,
    })
      .system('s')
      .tools([fakeTool('runPython'), fakeTool('slack.sendDM')])
      .build();
    await expect(agent.run({ message: 'attack' })).rejects.toThrow(PolicyHaltError);
  });

  it('frequency-limit policy halts after maxPerSession breach', async () => {
    const counts = new Map<string, number>();
    const policy: PermissionChecker = {
      name: 'limits',
      check: ({ capability, target }) => {
        if (capability !== 'tool_call') return { result: 'allow' };
        const used = counts.get(target!) ?? 0;
        if (target === 'processRefund' && used >= 2) {
          return {
            result: 'halt',
            reason: 'correctness:idempotency',
            tellLLM: `Refund limit (2) reached.`,
          };
        }
        counts.set(target!, used + 1);
        return { result: 'allow' };
      },
    };
    let calls = 0;
    const llm = mock({
      respond: () => {
        calls += 1;
        if (calls <= 3) {
          return {
            content: '',
            toolCalls: [{ id: `tc-${calls}`, name: 'processRefund', args: {} }],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({
      provider: llm,
      model: 'mock',
      maxIterations: 6,
      permissionChecker: policy,
    })
      .system('s')
      .tool(fakeTool('processRefund'))
      .build();
    await expect(agent.run({ message: 'multi-refund' })).rejects.toThrow(/idempotency/);
  });
});
