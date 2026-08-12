/**
 * Per-role skill-catalog visibility (9.11.0) — the permission checker composed
 * with the skill catalog.
 *
 *   P1 Unit         — `hiddenIds` removes a row from the menu the model reads,
 *                     and NEVER narrows the enum
 *   P2 Boundary     — no checker, or a checker that does not govern
 *                     `'skill_read'`, is byte-identical to today
 *   P3 Scenario     — a role sees a filtered catalog; the other role sees the
 *                     rest; activating a hidden skill is refused with the
 *                     POLICY's own message and the skill never activates
 *   P4 Property     — a hidden skill is never NAMED anywhere in the menu — not
 *                     as reachable, not as refusable
 *   P5 Security     — a hidden skill's BODY is never computed (the refusal
 *                     lands before `execute`, which `surfaceMode: 'tool-only'`
 *                     would otherwise return it from); a throwing checker hides
 *   P6 Performance  — n/a (one check per skill per iteration, opt-in only)
 *   P7 ROI          — one policy object drives both halves: the menu and the
 *                     activation, so they cannot disagree
 *
 * Why the enum stays whole: `toolArgValidation` defaults to `'enforce'` and runs
 * BEFORE the gate. Narrowing the enum would turn a policy refusal into a generic
 * schema error, and the model would never read the policy's own message — the
 * same reasoning 8.5.0 recorded for the skill-graph offer.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { buildReadSkillTool, defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { PermissionPolicy } from '../../src/security/PermissionPolicy.js';
import { skillTarget, skillIdFromTarget } from '../../src/security/skillTarget.js';
import type { PermissionChecker, PermissionRequest } from '../../src/adapters/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const skill = (id: string, surfaceMode?: 'tool-only') =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id}_BODY`,
    ...(surfaceMode && { surfaceMode }),
  });

const SKILLS = ['refunds', 'payroll', 'lookup'] as const;

/** The role allowlist every agent below uses — tools plus `read_skill`. */
const ROLES = {
  support: ['read_skill', 'noop'],
  hr: ['read_skill', 'noop'],
};

function policyFor(role: 'support' | 'hr'): PermissionPolicy {
  return PermissionPolicy.fromRoles(ROLES, role, {
    skills: { support: ['refunds', 'lookup'], hr: ['payroll'] },
  });
}

/** An agent with three skills and an optional checker. */
function buildAgent(opts: {
  checker?: PermissionChecker;
  script?: { content?: string; toolCalls?: { id: string; name: string; args: unknown }[] }[];
  toolOnly?: boolean;
  onRequest?: (description: string) => void;
}) {
  const noop = defineTool({
    name: 'noop',
    description: 'does nothing',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });
  let i = 0;
  const script = opts.script ?? [{ content: 'done' }];
  const provider = mock({
    respond: (req: { tools?: ReadonlyArray<{ name: string; description: string }> }) => {
      const rs = (req.tools ?? []).find((x) => x.name === 'read_skill');
      opts.onRequest?.(rs?.description ?? '(no read_skill)');
      return (script[i++] ?? { content: 'done' }) as never;
    },
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 4,
    ...(opts.checker && { permissionChecker: opts.checker }),
  }).tool(noop);
  for (const id of SKILLS) builder.skill(skill(id, opts.toolOnly ? 'tool-only' : undefined));
  return builder.build();
}

/** The `read_skill` descriptions the model saw, one per iteration. */
async function menusFor(checker?: PermissionChecker): Promise<string[]> {
  const seen: string[] = [];
  const agent = buildAgent({ ...(checker && { checker }), onRequest: (d) => seen.push(d) });
  await agent.run({ message: 'go' });
  return seen;
}

/** Every skill id named anywhere in a menu. */
function idsIn(description: string): string[] {
  return [...description.matchAll(/^ {2}- ([^:]+):/gm)].map((m) => (m[1] as string).trim());
}

// ─── P1 Unit — the builder ───────────────────────────────────────────

describe('buildReadSkillTool — hiddenIds', () => {
  const skills = SKILLS.map((id) => skill(id));

  it('removes a row from the menu the model reads', () => {
    const d = buildReadSkillTool(skills, { hiddenIds: ['payroll'] })!.schema.description;
    expect(d).toContain('  - refunds:');
    expect(d).toContain('  - lookup:');
    expect(d).not.toContain('payroll');
  });

  it('never narrows the ENUM — a policy refusal must reach the model, not a schema error', () => {
    const tool = buildReadSkillTool(skills, { hiddenIds: ['payroll'] })!;
    const ids = (tool.schema.inputSchema as { properties: { id: { enum?: string[] } } }).properties
      .id.enum;
    expect(ids).toEqual(['refunds', 'payroll', 'lookup']);
  });

  it('says so plainly when a role has nothing left', () => {
    const d = buildReadSkillTool(skills, { hiddenIds: [...SKILLS] })!.schema.description;
    expect(d).toContain('No skills are available to you');
  });

  it('composes with the graph offer — hidden ids appear in NEITHER section', () => {
    const d = buildReadSkillTool(skills, {
      grantable: ['refunds', 'payroll'],
      hiddenIds: ['payroll'],
    })!.schema.description;
    expect(d).toContain('  - refunds:');
    expect(d).toContain('Not reachable from here');
    expect(d).toContain('  - lookup:');
    expect(d).not.toContain('payroll');
  });

  it('an offer that hides nothing and has no graph reads exactly like no offer at all', () => {
    // The filtered path must degrade to the byte-identical original when the
    // filter is empty — otherwise "opt-in" would still change the prompt.
    expect(buildReadSkillTool(skills, {})!.schema.description).toBe(
      buildReadSkillTool(skills)!.schema.description,
    );
  });
});

// ─── P2 Boundary — opt-in by construction ────────────────────────────

describe('the two silences', () => {
  it('no checker → the full catalog, exactly as before', async () => {
    const menus = await menusFor();
    expect(idsIn(menus[0] ?? '').sort()).toEqual(['lookup', 'payroll', 'refunds']);
  });

  it('a checker that does not govern skill_read → the full catalog, and it is never asked', async () => {
    const asked: PermissionRequest[] = [];
    const checker: PermissionChecker = {
      name: 'tools-only',
      check: (r) => {
        asked.push(r);
        return { result: 'allow' };
      },
    };
    const menus = await menusFor(checker);
    expect(idsIn(menus[0] ?? '').sort()).toEqual(['lookup', 'payroll', 'refunds']);
    expect(asked.some((r) => r.capability === 'skill_read')).toBe(false);
  });

  it('a policy built without skill rules governs nothing new', () => {
    expect(PermissionPolicy.fromRoles(ROLES, 'support').governs).toBeUndefined();
  });
});

// ─── P3 Scenario — two roles, two catalogs ───────────────────────────

describe('a role sees its own catalog', () => {
  it('support sees refunds + lookup; hr sees payroll', async () => {
    expect(idsIn((await menusFor(policyFor('support')))[0] ?? '').sort()).toEqual([
      'lookup',
      'refunds',
    ]);
    expect(idsIn((await menusFor(policyFor('hr')))[0] ?? '')).toEqual(['payroll']);
  });

  it('the policy declares it governs skill_read, which is what turns the filter on', () => {
    expect(policyFor('support').governs).toEqual(['skill_read']);
  });

  it('activating a hidden skill is refused with the POLICY’s own message', async () => {
    const results: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'payroll' } }] },
        { content: 'done' },
      ],
    });
    agent.on('agentfootprint.stream.tool_end', (e) => {
      const r = (e.payload as { result: unknown }).result;
      results.push(typeof r === 'string' ? r : JSON.stringify(r));
    });
    await agent.run({ message: 'go' });
    expect(results.at(-1)).toContain('permission denied');
    expect(results.at(-1)).toContain("Skill 'payroll' is not available to the 'support' role.");
  });

  it('and the hidden skill never activates — its body stays out of the prompt', async () => {
    const prompts: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'payroll' } }] },
        { content: 'done' },
      ],
      onRequest: () => undefined,
    });
    agent.on('agentfootprint.context.injected', (e) => {
      prompts.push(JSON.stringify(e.payload));
    });
    await agent.run({ message: 'go' });
    expect(prompts.join('\n')).not.toContain('payroll_BODY');
  });

  it('a VISIBLE skill still activates normally', async () => {
    const results: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'refunds' } }] },
        { content: 'done' },
      ],
    });
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push(String((e.payload as { result: unknown }).result));
    });
    await agent.run({ message: 'go' });
    expect(results.at(-1)).toContain("Skill 'refunds' activated");
  });
});

// ─── P4 Property — a hidden skill is never named ─────────────────────

describe('property — nothing names a hidden skill', () => {
  it('across every iteration of a multi-turn run', async () => {
    const seen: string[] = [];
    const agent = buildAgent({
      checker: policyFor('hr'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'noop', args: {} }] },
        { toolCalls: [{ id: 'c2', name: 'noop', args: {} }] },
        { content: 'done' },
      ],
      onRequest: (d) => seen.push(d),
    });
    await agent.run({ message: 'go' });
    expect(seen.length).toBeGreaterThan(1);
    for (const menu of seen) {
      expect(menu).not.toContain('refunds');
      expect(menu).not.toContain('lookup');
      expect(menu).toContain('payroll');
    }
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('fail closed, and never leak the body', () => {
  it("a 'tool-only' hidden skill never returns its body — the refusal lands before execute", async () => {
    const results: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      toolOnly: true,
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'payroll' } }] },
        { content: 'done' },
      ],
    });
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push(String((e.payload as { result: unknown }).result));
    });
    await agent.run({ message: 'go' });
    expect(results.at(-1)).not.toContain('payroll_BODY');
  });

  it('a checker that throws hides every skill rather than advertising an unanswered one', async () => {
    const checker: PermissionChecker = {
      name: 'down',
      governs: ['skill_read'],
      check: (r) => {
        if (r.capability === 'skill_read') throw new Error('policy hub unreachable');
        return { result: 'allow' };
      },
    };
    const menus = await menusFor(checker);
    expect(menus[0]).toContain('No skills are available to you');
  });
});

// ─── P7 ROI — the target convention has ONE owner ────────────────────

describe('the skill: target convention', () => {
  it('round-trips, and tolerates a bare id', () => {
    expect(skillTarget('refunds')).toBe('skill:refunds');
    expect(skillIdFromTarget('skill:refunds')).toBe('refunds');
    expect(skillIdFromTarget('refunds')).toBe('refunds');
  });

  it('keeps a skill and a tool of the same name apart', async () => {
    const policy = PermissionPolicy.fromRoles({ r: ['refunds'] }, 'r', {
      skills: { r: [] },
    });
    // The TOOL named `refunds` is allowed…
    expect(
      (await policy.check({ capability: 'tool_call', actor: 'a', target: 'refunds' })).result,
    ).toBe('allow');
    // …and the SKILL named `refunds` is not.
    expect(
      (await policy.check({ capability: 'skill_read', actor: 'a', target: 'skill:refunds' }))
        .result,
    ).toBe('deny');
  });
});
