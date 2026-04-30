/**
 * Skills runtime per-mode routing — Block C (v2.5).
 *
 * 7-pattern matrix (unit · scenario · integration · property ·
 * security · performance · ROI). Pins:
 *
 *   - 'tool-only'    → body NOT in system slot; read_skill tool result IS the body
 *   - 'system-prompt' → body IN system slot; tool result is confirmation only
 *   - 'both'          → body in BOTH places (belt-and-suspenders)
 *   - 'auto' / unset  → keep v2.4 behavior (body in system slot, tool result is confirmation)
 *   - projectActiveInjection carries `surfaceMode` + `autoActivate` from metadata
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineSkill,
  buildReadSkillTool,
  mock,
  projectActiveInjection,
} from '../../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function makeSkill(id: string, surfaceMode?: 'auto' | 'system-prompt' | 'tool-only' | 'both', body = `body for ${id}`) {
  return defineSkill({
    id,
    description: `${id} skill`,
    body,
    ...(surfaceMode && { surfaceMode }),
  });
}

// ─── 1. UNIT — projectActiveInjection carries metadata ────────────

describe('Block C — projectActiveInjection metadata', () => {
  it("carries surfaceMode='tool-only' through scope projection", () => {
    const skill = makeSkill('billing', 'tool-only');
    const projected = projectActiveInjection(skill);
    expect(projected.surfaceMode).toBe('tool-only');
  });

  it("carries surfaceMode='system-prompt' through scope projection", () => {
    const skill = makeSkill('billing', 'system-prompt');
    const projected = projectActiveInjection(skill);
    expect(projected.surfaceMode).toBe('system-prompt');
  });

  it("default surfaceMode='auto' projects through (preserves v2.4 routing)", () => {
    const skill = makeSkill('billing'); // no surfaceMode → defineSkill defaults to 'auto'
    const projected = projectActiveInjection(skill);
    expect(projected.surfaceMode).toBe('auto');
  });

  it('autoActivate metadata projects through when set', () => {
    const skill = defineSkill({
      id: 'billing',
      description: 'b',
      body: 'b',
      autoActivate: 'currentSkill',
    });
    const projected = projectActiveInjection(skill);
    expect(projected.autoActivate).toBe('currentSkill');
  });
});

// ─── 2. SCENARIO — system slot dispatch (end-to-end via Agent) ────

describe('Block C — system slot dispatch', () => {
  /** Build a tiny agent that reads_skill on iter 1, then finishes on iter 2. */
  async function probeSystemSlot(skill: ReturnType<typeof makeSkill>) {
    let observedSystem = '';
    let calls = 0;
    const provider = mock({
      respond: (req: { systemPrompt?: string }) => {
        // The system prompt on iter 2 is what reflects per-mode dispatch
        if (calls === 1) observedSystem = req.systemPrompt ?? '';
        calls++;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'read_skill', args: { id: skill.id } }],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('BASE_SP')
      .skill(skill)
      .build();
    await agent.run({ message: 'go' });
    return observedSystem;
  }

  it("'tool-only' skill body is SUPPRESSED from system slot on activation iteration", async () => {
    const sysPrompt = await probeSystemSlot(makeSkill('billing', 'tool-only', 'TOOL_ONLY_BODY'));
    expect(sysPrompt).toContain('BASE_SP');
    expect(sysPrompt).not.toContain('TOOL_ONLY_BODY');
  });

  it("'system-prompt' skill body LANDS in system slot on activation iteration", async () => {
    const sysPrompt = await probeSystemSlot(makeSkill('billing', 'system-prompt', 'SP_BODY'));
    expect(sysPrompt).toContain('SP_BODY');
  });

  it("'both' skill body LANDS in system slot (and tool result — see tool tests)", async () => {
    const sysPrompt = await probeSystemSlot(makeSkill('billing', 'both', 'BOTH_BODY'));
    expect(sysPrompt).toContain('BOTH_BODY');
  });

  it("'auto' (default) skill body LANDS in system slot — preserves v2.4 behavior", async () => {
    const sysPrompt = await probeSystemSlot(makeSkill('billing', undefined, 'AUTO_BODY'));
    expect(sysPrompt).toContain('AUTO_BODY');
  });
});

// ─── 3. INTEGRATION — read_skill tool result per mode ─────────────

describe('Block C — read_skill tool-result dispatch', () => {
  it("'tool-only' → tool result IS the body", async () => {
    const skill = makeSkill('billing', 'tool-only', 'TOOL_ONLY_BODY');
    const tool = buildReadSkillTool([skill])!;
    const out = await tool.execute({ id: 'billing' }, {
      toolCallId: 't',
      iteration: 1,
    });
    expect(out).toBe('TOOL_ONLY_BODY');
  });

  it("'both' → tool result IS the body (delivered alongside system slot)", async () => {
    const skill = makeSkill('billing', 'both', 'BOTH_BODY');
    const tool = buildReadSkillTool([skill])!;
    const out = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 1 });
    expect(out).toBe('BOTH_BODY');
  });

  it("'system-prompt' → tool result is confirmation only (body delivered via slot only)", async () => {
    const skill = makeSkill('billing', 'system-prompt', 'SP_BODY');
    const tool = buildReadSkillTool([skill])!;
    const out = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 1 });
    expect(out).not.toBe('SP_BODY');
    expect(out).toContain('billing');
    expect(out).toContain('activated');
  });

  it("'auto' / default → tool result is confirmation only (preserves v2.4 behavior)", async () => {
    const skill = makeSkill('billing'); // surfaceMode defaults to 'auto'
    const tool = buildReadSkillTool([skill])!;
    const out = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 1 });
    expect(out).toContain('activated');
  });

  it('unknown id still returns the existing error string', async () => {
    const tool = buildReadSkillTool([makeSkill('billing', 'tool-only')])!;
    const out = await tool.execute({ id: 'phantom' }, { toolCallId: 't', iteration: 1 });
    expect(out).toContain('Unknown skill');
  });
});

// ─── 4. PROPERTY — invariants ────────────────────────────────────

describe('Block C — properties', () => {
  it('mixed registry: per-skill modes are honored independently', async () => {
    const billing = makeSkill('billing', 'tool-only', 'B_BODY');
    const refund = makeSkill('refund', 'system-prompt', 'R_BODY');
    const tool = buildReadSkillTool([billing, refund])!;

    const billingOut = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 1 });
    const refundOut = await tool.execute({ id: 'refund' }, { toolCallId: 't', iteration: 1 });

    expect(billingOut).toBe('B_BODY');
    expect(refundOut).toContain('activated');
    expect(refundOut).not.toContain('R_BODY');
  });

  it('tool-result deterministic per (id, surfaceMode) — multiple calls return same content', async () => {
    const skill = makeSkill('billing', 'tool-only', 'STABLE_BODY');
    const tool = buildReadSkillTool([skill])!;
    const a = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 1 });
    const b = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 2 });
    expect(a).toBe(b);
    expect(a).toBe('STABLE_BODY');
  });
});

// ─── 5. SECURITY — defensive ─────────────────────────────────────

describe('Block C — security', () => {
  it("'tool-only' skill with empty body falls back to confirmation (no empty result)", async () => {
    // Build a skill whose body is empty after metadata application.
    // defineSkill enforces non-empty body, so build an Injection by hand:
    const skill = {
      id: 'billing',
      description: 'b',
      flavor: 'skill' as const,
      trigger: { kind: 'llm-activated' as const, viaToolName: 'read_skill' },
      inject: { systemPrompt: '' },
      metadata: { surfaceMode: 'tool-only' as const },
    };
    // Use a type-cast since hand-built shape doesn't match Injection's type narrowly
    const tool = buildReadSkillTool([skill as unknown as Parameters<typeof buildReadSkillTool>[0][number]])!;
    const out = await tool.execute({ id: 'billing' }, { toolCallId: 't', iteration: 1 });
    // Empty body → falls back to the activation-confirmation path
    expect(out).toContain('activated');
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('Block C — performance', () => {
  it('1000 read_skill executions over a 50-skill registry under 50ms', async () => {
    const skills = Array.from({ length: 50 }, (_, i) =>
      makeSkill(`s${i}`, i % 4 === 0 ? 'tool-only' : 'system-prompt', `body-${i}`),
    );
    const tool = buildReadSkillTool(skills)!;
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      await tool.execute({ id: `s${i % 50}` }, { toolCallId: 't', iteration: 1 });
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — per-mode is observable end-to-end with an Agent ─────

describe('Block C — ROI: end-to-end via Agent', () => {
  it('full agent run: tool-only skill body shows up in observed system prompt + tool result', async () => {
    const billing = defineSkill({
      id: 'billing',
      description: 'Billing assistance',
      body: 'BILLING_TOOL_ONLY_BODY',
      surfaceMode: 'tool-only',
    });

    let observedSystem = '';
    const observedToolResults: string[] = [];
    let calls = 0;
    const provider = mock({
      respond: (req: { systemPrompt?: string; messages?: ReadonlyArray<{ role: string; content: string }> }) => {
        observedSystem = req.systemPrompt ?? '';
        // Capture the user's view of recent tool results
        for (const m of req.messages ?? []) {
          if (m.role === 'tool') observedToolResults.push(m.content);
        }
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
      .system('You answer.')
      .skill(billing)
      .build();
    await agent.run({ message: 'help with billing' });

    // Block C contract:
    //   - Body did NOT land in the system slot
    expect(observedSystem).not.toContain('BILLING_TOOL_ONLY_BODY');
    //   - Body DID land in the tool result the LLM saw on iter 2
    expect(observedToolResults.some((r) => r.includes('BILLING_TOOL_ONLY_BODY'))).toBe(true);
  });
});
