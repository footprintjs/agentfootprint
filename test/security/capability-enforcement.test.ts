/**
 * Capability enforcement — the vocabulary stops being decorative (9.11.0).
 *
 *   P1 Unit         — `checkerGoverns`: absence is NO, `'tool_call'` always yes
 *   P2 Boundary     — the two silences (tool declares / checker declares) each
 *                     leave the run byte-identical
 *   P3 Scenario     — a tool that declares `external_net` is refused by a role
 *                     whose capability rule omits it, and the model reads why
 *   P4 Property     — a policy WITHOUT rules answers every capability exactly
 *                     as it answers `'tool_call'` — no new denials, ever
 *   P5 Security     — a checker that THROWS on a capability check fails closed
 *   P6 Performance  — n/a (one check per declared capability)
 *   P7 ROI          — one event stream reports capability checks in the same
 *                     shape as tool checks
 *
 * ── The state this replaced ─────────────────────────────────────────────────
 * `PermissionRequest.capability` shipped with five values from v2.4. Every
 * construction site in the library passed `'tool_call'`, and `PermissionPolicy`
 * read the field only as a FALLBACK target id (`request.target ?? capability`),
 * which for a tool call is never reached. So four fifths of the vocabulary was
 * defined and dead: a `memory_write` never left the framework, and no policy
 * could have keyed on one.
 *
 * The fix is deliberately NOT "start sending them". The framework cannot know
 * what a tool touches, and a fail-closed allowlist that suddenly receives a
 * capability it has no rule for would deny work it has always permitted. So:
 * a tool DECLARES, a checker DECLARES, and enforcement happens where both
 * speak. Everything else is unchanged, which the boundary tests below pin.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { PermissionPolicy } from '../../src/security/PermissionPolicy.js';
import { checkerGoverns } from '../../src/adapters/types.js';
import type {
  PermissionChecker,
  PermissionDecision,
  PermissionRequest,
} from '../../src/adapters/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

/** Records every request it is asked, and answers from a table. */
function recordingChecker(
  answer: (r: PermissionRequest) => PermissionDecision,
  governs?: PermissionChecker['governs'],
): { checker: PermissionChecker; seen: PermissionRequest[] } {
  const seen: PermissionRequest[] = [];
  return {
    seen,
    checker: {
      name: 'recording',
      ...(governs !== undefined && { governs }),
      check: (r) => {
        seen.push(r);
        return answer(r);
      },
    },
  };
}

function agentWith(checker: PermissionChecker | undefined, capabilities?: readonly string[]) {
  const fetchInvoice = defineTool<Record<string, never>, string>({
    name: 'fetch_invoice',
    description: 'fetches an invoice',
    inputSchema: { type: 'object', properties: {} },
    ...(capabilities !== undefined && { capabilities: capabilities as never }),
    execute: () => 'INVOICE-OK',
  });
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'fetch_invoice', args: {} }] },
        { content: 'done' },
      ],
    }),
    model: 'mock',
    ...(checker && { permissionChecker: checker }),
  })
    .tool(fetchInvoice)
    .build();
}

/** The tool result the model read. */
async function toolResultOf(agent: ReturnType<typeof agentWith>): Promise<string> {
  const results: string[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) => {
    const r = (e.payload as { result: unknown }).result;
    results.push(typeof r === 'string' ? r : JSON.stringify(r));
  });
  await agent.run({ message: 'go' });
  return results.at(-1) ?? '';
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('checkerGoverns', () => {
  const bare: PermissionChecker = { name: 'bare', check: () => ({ result: 'allow' }) };

  it('always says yes to tool_call — it has been enforced since v2.4', () => {
    expect(checkerGoverns(bare, 'tool_call')).toBe(true);
  });

  it('absence is NO for everything else', () => {
    for (const cap of [
      'memory_read',
      'memory_write',
      'external_net',
      'user_data',
      'skill_read',
    ] as const) {
      expect(checkerGoverns(bare, cap)).toBe(false);
    }
  });

  it('says yes only to what was declared', () => {
    const declaring: PermissionChecker = { ...bare, governs: ['external_net'] };
    expect(checkerGoverns(declaring, 'external_net')).toBe(true);
    expect(checkerGoverns(declaring, 'memory_write')).toBe(false);
  });

  it('no checker at all is NO, including for tool_call', () => {
    expect(checkerGoverns(undefined, 'tool_call')).toBe(false);
  });
});

// ─── P2 Boundary — the two silences ──────────────────────────────────

describe('either side silent ⇒ nothing extra is asked', () => {
  it('a tool that declares nothing is asked about nothing extra', async () => {
    const { checker, seen } = recordingChecker(
      () => ({ result: 'allow' }),
      ['external_net', 'memory_write'],
    );
    await toolResultOf(agentWith(checker));
    expect(seen.map((r) => r.capability)).toEqual(['tool_call']);
  });

  it('a checker that governs nothing is asked about nothing extra', async () => {
    const { checker, seen } = recordingChecker(() => ({ result: 'allow' }));
    await toolResultOf(agentWith(checker, ['external_net', 'user_data']));
    expect(seen.map((r) => r.capability)).toEqual(['tool_call']);
  });

  it('and the tool still runs in both cases', async () => {
    const { checker } = recordingChecker(() => ({ result: 'allow' }));
    expect(await toolResultOf(agentWith(checker, ['external_net']))).toBe('INVOICE-OK');
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('both sides speak', () => {
  it('asks once per declared capability, after the tool_call check', async () => {
    const { checker, seen } = recordingChecker(
      () => ({ result: 'allow' }),
      ['external_net', 'user_data'],
    );
    await toolResultOf(agentWith(checker, ['external_net', 'user_data']));
    expect(seen.map((r) => r.capability)).toEqual(['tool_call', 'external_net', 'user_data']);
    // The subject of a capability check is the TOOL NAME.
    expect(seen.every((r) => r.target === 'fetch_invoice')).toBe(true);
    // The port says `sequence` is empty for non-tool_call capabilities.
    expect(seen.slice(1).every((r) => r.sequence === undefined)).toBe(true);
  });

  it('skips a declared capability the checker does not govern', async () => {
    const { checker, seen } = recordingChecker(() => ({ result: 'allow' }), ['user_data']);
    await toolResultOf(agentWith(checker, ['external_net', 'user_data']));
    expect(seen.map((r) => r.capability)).toEqual(['tool_call', 'user_data']);
  });

  it('a capability denial stops the tool and the model reads why', async () => {
    const { checker } = recordingChecker(
      (r) =>
        r.capability === 'external_net'
          ? { result: 'deny', rationale: 'this role has no network egress' }
          : { result: 'allow' },
      ['external_net'],
    );
    const result = await toolResultOf(agentWith(checker, ['external_net']));
    expect(result).toContain('permission denied');
    expect(result).toContain('this role has no network egress');
    expect(result).not.toContain('INVOICE-OK');
  });

  it('reports the capability check on the typed event stream', async () => {
    const { checker } = recordingChecker(
      (r) => (r.capability === 'external_net' ? { result: 'deny' } : { result: 'allow' }),
      ['external_net'],
    );
    const agent = agentWith(checker, ['external_net']);
    const checks: { capability: string; result: string }[] = [];
    agent.on('agentfootprint.permission.check', (e) => {
      const p = e.payload as { capability: string; result: string };
      checks.push({ capability: p.capability, result: p.result });
    });
    await agent.run({ message: 'go' });
    expect(checks).toEqual([
      { capability: 'tool_call', result: 'allow' },
      { capability: 'external_net', result: 'deny' },
    ]);
  });
});

// ─── P4 Property — an unruled policy never denies more ───────────────

describe('PermissionPolicy without rules', () => {
  const policy = PermissionPolicy.fromRoles({ agent: ['fetch_invoice'] }, 'agent');

  it('declares no `governs`, so the framework asks it nothing new', () => {
    expect(policy.governs).toBeUndefined();
  });

  it('answers every capability exactly as it answers tool_call', async () => {
    for (const capability of [
      'tool_call',
      'memory_read',
      'memory_write',
      'external_net',
      'user_data',
    ] as const) {
      const yes = await policy.check({ capability, actor: 'agent', target: 'fetch_invoice' });
      const no = await policy.check({ capability, actor: 'agent', target: 'delete_everything' });
      expect(yes.result).toBe('allow');
      expect(no.result).toBe('deny');
    }
  });

  it('allows a skill it was never told about — silence is not a refusal', async () => {
    const d = await policy.check({ capability: 'skill_read', actor: 'agent', target: 'skill:x' });
    expect(d.result).toBe('allow');
  });
});

describe('PermissionPolicy with capability rules', () => {
  const policy = PermissionPolicy.fromRoles({ support: ['fetch_invoice'] }, 'support', {
    capabilities: { support: ['memory_read'] },
  });

  it('declares it governs all four, not just the ones a role listed', () => {
    // Governing only what a role listed would let an unlisted capability pass
    // unasked — a fail-open hole in a fail-closed primitive.
    expect(policy.governs).toEqual(['memory_read', 'memory_write', 'external_net', 'user_data']);
  });

  it('allows a listed capability and denies an unlisted one', async () => {
    const allowed = await policy.check({
      capability: 'memory_read',
      actor: 'agent',
      target: 'fetch_invoice',
    });
    const denied = await policy.check({
      capability: 'external_net',
      actor: 'agent',
      target: 'fetch_invoice',
    });
    expect(allowed.result).toBe('allow');
    expect(denied.result).toBe('deny');
    expect(denied.rationale).toContain('external_net');
    expect(denied.rationale).toContain('fetch_invoice');
  });

  it('leaves tool_call judged by the allowlist alone', async () => {
    const d = await policy.check({
      capability: 'tool_call',
      actor: 'agent',
      target: 'fetch_invoice',
    });
    expect(d.result).toBe('allow');
  });

  it('a role with NO capability rule falls through to the allowlist', async () => {
    const other = policy.withActiveRole('support');
    expect(other.governs).toBeDefined(); // rules travel with the role swap
    const wide = PermissionPolicy.fromRoles(
      { support: ['fetch_invoice'], admin: ['fetch_invoice'] },
      'admin',
      { capabilities: { support: ['memory_read'] } },
    );
    const d = await wide.check({
      capability: 'external_net',
      actor: 'agent',
      target: 'fetch_invoice',
    });
    expect(d.result).toBe('allow');
  });
});

// ─── P5 Security — fail closed ───────────────────────────────────────

describe('a checker that throws on a capability check', () => {
  it('fails closed, and the refusal reads as terminal', async () => {
    const checker: PermissionChecker = {
      name: 'flaky',
      governs: ['external_net'],
      check: (r) => {
        if (r.capability === 'external_net') throw new Error('ECONNREFUSED policy-hub:8080');
        return { result: 'allow' };
      },
    };
    const result = await toolResultOf(agentWith(checker, ['external_net']));
    expect(result).toContain('permission denied');
    expect(result).toContain('will not change during this run');
    // The operator's fact stays off the transcript — a model must not be
    // invited to argue with an outage.
    expect(result).not.toContain('ECONNREFUSED');
  });
});
