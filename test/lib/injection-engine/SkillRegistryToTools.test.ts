/**
 * SkillRegistry.toTools() + buildListSkillsTool / buildReadSkillTool
 * — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins:
 *   - Empty registry → both entries `undefined` (filterable).
 *   - Populated registry → both tools materialized; schemas valid.
 *   - `read_skill` description embeds the catalog (today's behavior;
 *     `list_skills` lets the LLM bypass this in large-registry scenarios).
 *   - `read_skill` execute returns confirmation string (bookkeeping is
 *     the Agent's tool-calls subflow's job, not the tool's).
 *   - Composes with `gatedTools` from `agentfootprint/tool-providers`.
 *   - Pure / deterministic over a stable catalog.
 */

import { describe, expect, it } from 'vitest';
import {
  SkillRegistry,
  defineSkill,
  buildListSkillsTool,
  buildReadSkillTool,
  staticTools,
  gatedTools,
  type ToolDispatchContext,
  type Tool,
} from '../../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function makeSkill(id: string, description?: string) {
  return defineSkill({
    id,
    description: description ?? `${id} skill`,
    body: `body for ${id}`,
  });
}

const baseCtx: ToolDispatchContext = {
  iteration: 1,
  identity: { conversationId: 'c1' },
};

// ─── 1. UNIT — toTools shape ──────────────────────────────────────

describe('SkillRegistry.toTools — unit', () => {
  it('returns both entries undefined when registry is empty', () => {
    const registry = new SkillRegistry();
    const { listSkills, readSkill } = registry.toTools();
    expect(listSkills).toBeUndefined();
    expect(readSkill).toBeUndefined();
  });

  it('returns both tools materialized when registry has skills', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing', 'Billing assistance'));
    registry.register(makeSkill('refund', 'Refund processing'));
    const { listSkills, readSkill } = registry.toTools();
    expect(listSkills?.schema.name).toBe('list_skills');
    expect(readSkill?.schema.name).toBe('read_skill');
  });

  it('list_skills has no required input properties (no-arg discovery)', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { listSkills } = registry.toTools();
    const schema = listSkills!.schema.inputSchema as { properties?: object; required?: string[] };
    expect(schema.required ?? []).toEqual([]);
  });

  it('read_skill schema requires `id` and enums the registered skill ids', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    registry.register(makeSkill('refund'));
    const { readSkill } = registry.toTools();
    const schema = readSkill!.schema.inputSchema as {
      properties: { id: { enum: string[] } };
      required: string[];
    };
    expect(schema.required).toEqual(['id']);
    expect(schema.properties.id.enum).toEqual(['billing', 'refund']);
  });
});

// ─── 2. SCENARIO — execute semantics ──────────────────────────────

describe('SkillRegistry.toTools — scenario: execute returns', () => {
  it('list_skills returns JSON-serialized {id, description}[]', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing', 'Billing help'));
    registry.register(makeSkill('refund', 'Refund processing'));
    const { listSkills } = registry.toTools();

    const out = await listSkills!.execute({}, {} as never);
    const parsed = JSON.parse(out as string);
    expect(parsed).toEqual([
      { id: 'billing', description: 'Billing help' },
      { id: 'refund', description: 'Refund processing' },
    ]);
  });

  it('list_skills falls back to "(no description)" when description is missing on a hand-built Injection', async () => {
    // defineSkill enforces description, but the builder defends against
    // hand-rolled Injections that bypass that constraint.
    const handBuilt = {
      id: 'manual',
      flavor: 'skill' as const,
      trigger: { kind: 'llm-activated' as const, activatorIds: ['manual'] },
      slot: 'system' as const,
      inject: { content: 'manual body' },
    };
    const out = await buildListSkillsTool([handBuilt])!.execute({}, {} as never);
    const parsed = JSON.parse(out as string);
    expect(parsed).toEqual([{ id: 'manual', description: '(no description)' }]);
  });

  it('read_skill returns "activated" confirmation for a known id', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { readSkill } = registry.toTools();

    const out = await readSkill!.execute({ id: 'billing' }, {} as never);
    expect(out).toContain('billing');
    expect(out).toContain('activated');
  });

  it('read_skill returns "Unknown skill" for an unrecognized id', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { readSkill } = registry.toTools();

    const out = await readSkill!.execute({ id: 'nonexistent' } as { id: string }, {} as never);
    expect(out).toContain('Unknown skill');
    expect(out).toContain('billing');
  });
});

// ─── 3. INTEGRATION — composes with gatedTools ────────────────────

describe('SkillRegistry.toTools — integration: composes with gatedTools', () => {
  it('skill tools flow through staticTools + gatedTools intact', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { listSkills, readSkill } = registry.toTools();

    const tools = [listSkills!, readSkill!];
    const provider = staticTools(tools);
    const gated = gatedTools(provider, () => true);

    const visible = gated.list(baseCtx);
    expect(visible.map((t) => t.schema.name).sort()).toEqual(['list_skills', 'read_skill']);
  });

  it('a permission filter can hide list_skills while exposing read_skill', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { listSkills, readSkill } = registry.toTools();
    const provider = gatedTools(staticTools([listSkills!, readSkill!]), (n) => n !== 'list_skills');

    const visible = provider.list(baseCtx);
    expect(visible.map((t) => t.schema.name)).toEqual(['read_skill']);
  });
});

// ─── 4. PROPERTY — pure builders over a snapshot ──────────────────

describe('SkillRegistry.toTools — properties', () => {
  it('toTools is pure: same registry contents → equivalent tool schemas', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('a'));
    registry.register(makeSkill('b'));

    const t1 = registry.toTools();
    const t2 = registry.toTools();
    // New tool instances, but same schema content
    expect(t1.readSkill!.schema.name).toBe(t2.readSkill!.schema.name);
    expect(t1.readSkill!.schema.description).toBe(t2.readSkill!.schema.description);
  });

  it('builders are independent of SkillRegistry — buildListSkillsTool([]) returns undefined', () => {
    expect(buildListSkillsTool([])).toBeUndefined();
    expect(buildReadSkillTool([])).toBeUndefined();
  });

  it('mutating registry AFTER toTools does not retroactively change the tool', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { listSkills } = registry.toTools();

    // Add a skill AFTER toTools snapshot
    registry.register(makeSkill('refund'));

    const out = await listSkills!.execute({}, {} as never);
    const parsed = JSON.parse(out as string);
    expect(parsed.map((s: { id: string }) => s.id)).toEqual(['billing']);
  });
});

// ─── 5. SECURITY — read_skill validates id ────────────────────────

describe('SkillRegistry.toTools — security: id whitelist', () => {
  it('read_skill closes-fail on unknown ids (returns error string, not "activated")', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { readSkill } = registry.toTools();

    const evil = await readSkill!.execute(
      { id: '../../etc/passwd' } as { id: string },
      {} as never,
    );
    expect(evil).toContain('Unknown skill');
    expect(evil).not.toContain('activated');
  });

  it('schema enum reflects exactly the registered skill ids', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    registry.register(makeSkill('refund'));
    const { readSkill } = registry.toTools();
    const enumIds = (readSkill!.schema.inputSchema as { properties: { id: { enum: string[] } } })
      .properties.id.enum;
    expect(enumIds).toEqual(['billing', 'refund']);
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('SkillRegistry.toTools — performance', () => {
  it('toTools over a 100-skill registry runs under 50ms', () => {
    const registry = new SkillRegistry();
    for (let i = 0; i < 100; i++) registry.register(makeSkill(`skill_${i}`, `Skill ${i}`));

    const t0 = Date.now();
    for (let i = 0; i < 50; i++) registry.toTools(); // 5000 builds total
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — what the API unlocks ───────────────────────────────

describe('SkillRegistry.toTools — ROI: explicit composition', () => {
  it('one source of truth — Agent auto-attach AND explicit composition use the SAME builder', () => {
    // Both code paths must agree on schema. If they drift, the LLM
    // sees one tool from auto-attach and a "different" tool when
    // the consumer mounts via toTools(). This test pins the contract.
    const skills = [makeSkill('billing')];
    const direct = buildReadSkillTool(skills)!;

    const registry = new SkillRegistry();
    registry.register(skills[0]);
    const { readSkill: viaRegistry } = registry.toTools();

    expect(direct.schema.name).toBe(viaRegistry!.schema.name);
    expect(direct.schema.description).toBe(viaRegistry!.schema.description);
    expect((direct.schema.inputSchema as { required: string[] }).required).toEqual(
      (viaRegistry!.schema.inputSchema as { required: string[] }).required,
    );
  });

  it('Tool[] from toTools can be merged into a flat tool list with .filter(Boolean)', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('billing'));
    const { listSkills, readSkill } = registry.toTools();

    const otherTool: Tool = {
      schema: { name: 'lookup', description: 'lookup', inputSchema: { type: 'object' } },
      execute: async () => 'ok',
    };
    const tools: Tool[] = [listSkills, readSkill, otherTool].filter(
      (t): t is Tool => t !== undefined,
    );
    expect(tools.map((t) => t.schema.name)).toEqual(['list_skills', 'read_skill', 'lookup']);
  });
});
