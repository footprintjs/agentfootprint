/**
 * Skills — 5-pattern tests covering every panel-prescribed case.
 *
 * Tiers:
 *   - unit:     defineSkill + registry CRUD + surface mode resolution
 *   - boundary: empty registry, unknown id, empty description, mock provider
 *   - scenario: full round-trip (list → read → body), duplicate id semantics,
 *               overlapping activeWhen, surfaceMode variants
 *   - property: idempotent registration, every registered skill reachable
 *   - security: `read_skill` unknown id → error not throw, tag-escape in body,
 *               registry isolation
 */
import { describe, expect, it, vi } from 'vitest';
import {
  defineSkill,
  SkillRegistry,
  renderSkillBody,
  resolveSurfaceMode,
  parseAnthropicVersion,
  isClaudeStrongAdherence,
  type Skill,
} from '../../../src/lib/skills';

// ── Unit ────────────────────────────────────────────────────

describe('defineSkill — unit', () => {
  it('returns the skill passthrough with typed TDecision', () => {
    interface MyDecision {
      currentSkill: string | null;
    }
    const s = defineSkill<MyDecision>({
      id: 'x',
      version: '1.0.0',
      title: 'X',
      description: 'X does X',
      activeWhen: (d) => d.currentSkill === 'x',
    });
    expect(s.id).toBe('x');
    expect(s.activeWhen?.({ currentSkill: 'x' })).toBe(true);
    expect(s.activeWhen?.({ currentSkill: null })).toBe(false);
  });

  it('warns when description is empty (dev-mode)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: '  ' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('SkillRegistry — unit', () => {
  it('registers, looks up by id, lists', () => {
    const r = new SkillRegistry();
    const s = defineSkill({ id: 'a', version: '1.0.0', title: 'A', description: 'A' });
    r.register(s);
    expect(r.getById('a')?.id).toBe('a');
    expect(r.list()).toHaveLength(1);
  });

  it('registerAll batch-registers', () => {
    const r = new SkillRegistry();
    r.registerAll([
      defineSkill({ id: 'a', version: '1.0.0', title: 'A', description: 'A' }),
      defineSkill({ id: 'b', version: '1.0.0', title: 'B', description: 'B' }),
    ]);
    expect(r.list()).toHaveLength(2);
  });

  it('search filters by scope + query', () => {
    const r = new SkillRegistry();
    r.registerAll([
      defineSkill({
        id: 'auth-reset',
        version: '1.0.0',
        title: 'Auth reset',
        description: 'Password reset',
        scope: ['auth'],
      }),
      defineSkill({
        id: 'billing-refund',
        version: '1.0.0',
        title: 'Billing refund',
        description: 'Refund a charge',
        scope: ['billing'],
      }),
    ]);
    expect(r.search({ scope: 'auth' }).map((s) => s.id)).toEqual(['auth-reset']);
    expect(r.search({ query: 'refund' }).map((s) => s.id)).toEqual(['billing-refund']);
    expect(r.search({}).length).toBe(2);
  });
});

describe('surfaceMode — unit', () => {
  it('parseAnthropicVersion handles legacy + current formats', () => {
    expect(parseAnthropicVersion('claude-3-5-sonnet-20240620')).toEqual({ major: 3, minor: 5 });
    expect(parseAnthropicVersion('claude-3-opus')).toEqual({ major: 3, minor: 0 });
    expect(parseAnthropicVersion('claude-sonnet-4-5-20250514')).toEqual({ major: 4, minor: 5 });
    expect(parseAnthropicVersion('claude-opus-4-7')).toEqual({ major: 4, minor: 7 });
    expect(parseAnthropicVersion('gpt-4-turbo')).toBeNull();
  });

  it('isClaudeStrongAdherence: ≥ 3.5', () => {
    expect(isClaudeStrongAdherence({ major: 3, minor: 5 })).toBe(true);
    expect(isClaudeStrongAdherence({ major: 3, minor: 4 })).toBe(false);
    expect(isClaudeStrongAdherence({ major: 4, minor: 7 })).toBe(true);
    expect(isClaudeStrongAdherence(null)).toBe(false);
  });

  it('resolveSurfaceMode("auto", anthropic Claude 4) → "both"', () => {
    expect(
      resolveSurfaceMode('auto', { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }),
    ).toBe('both');
  });

  it('resolveSurfaceMode("auto", anthropic Claude 3 opus) → "tool-only"', () => {
    expect(resolveSurfaceMode('auto', { provider: 'anthropic', modelId: 'claude-3-opus' })).toBe(
      'tool-only',
    );
  });

  it('resolveSurfaceMode("auto", openai) → "tool-only"', () => {
    expect(resolveSurfaceMode('auto', { provider: 'openai', modelId: 'gpt-4-turbo' })).toBe(
      'tool-only',
    );
  });

  it('resolveSurfaceMode("auto", no hint) → "tool-only"', () => {
    expect(resolveSurfaceMode('auto')).toBe('tool-only');
  });

  it('explicit mode always wins over auto-resolution', () => {
    expect(resolveSurfaceMode('system-prompt', { provider: 'openai' })).toBe('system-prompt');
    expect(
      resolveSurfaceMode('tool-only', { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }),
    ).toBe('tool-only');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('SkillRegistry — boundary', () => {
  it('empty registry: list() returns [], toInstructions() returns []', () => {
    const r = new SkillRegistry();
    expect(r.list()).toEqual([]);
    expect(r.toInstructions()).toEqual([]);
  });

  it('surfaceMode "system-prompt" + empty registry → prompt fragment is null (no ghost header)', () => {
    const r = new SkillRegistry({ surfaceMode: 'system-prompt' });
    expect(r.toPromptFragment()).toBeNull();
  });

  it('surfaceMode "auto" + mock/unknown provider → tool-only (evals match production)', () => {
    const r = new SkillRegistry({ surfaceMode: 'auto' });
    r.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    // No providerHint = fall back to tool-only
    expect(r.effectiveSurfaceMode()).toBe('tool-only');
    expect(r.toPromptFragment()).toBeNull();
  });

  it('getById unknown → undefined', () => {
    const r = new SkillRegistry();
    expect(r.getById('nope')).toBeUndefined();
  });
});

describe('read_skill tool — boundary', () => {
  it('unknown id → tool result with isError (model can recover, does NOT throw)', async () => {
    const r = new SkillRegistry();
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'nope' });
    expect(result.isError).toBe(true);
    expect((result.content as string).toLowerCase()).toContain('not found');
  });

  it('missing/empty id → isError, not exception', async () => {
    const r = new SkillRegistry();
    const { readSkill } = r.toTools();
    expect((await readSkill.handler({ id: '' })).isError).toBe(true);
    expect((await readSkill.handler({})).isError).toBe(true);
  });

  it('lazy loader throwing → isError (tool result), not agent crash', async () => {
    const r = new SkillRegistry();
    r.register(
      defineSkill({
        id: 'x',
        version: '1.0.0',
        title: 'X',
        description: 'X',
        body: () => {
          throw new Error('disk read failed');
        },
      }),
    );
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content as string).toContain('disk read failed');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('SkillRegistry — scenario', () => {
  it('full round-trip: list_skills → read_skill body surfaces metadata', async () => {
    const r = new SkillRegistry();
    const skill = defineSkill({
      id: 'port-triage',
      version: '1.2.0',
      title: 'Port triage',
      description: 'Investigate CRC errors',
      steps: ['Check metrics', 'Check logs', 'Report'],
    });
    r.register(skill);

    const { listSkills, readSkill } = r.toTools();

    const listResult = await listSkills.handler({});
    const listPayload = JSON.parse(listResult.content as string);
    expect(listPayload.skills).toHaveLength(1);
    expect(listPayload.skills[0].id).toBe('port-triage');
    expect(listPayload.skills[0].version).toBe('1.2.0');

    const readResult = await readSkill.handler({ id: 'port-triage' });
    const body = readResult.content as string;
    expect(body).toContain('You are now following skill: port-triage (v1.2.0)');
    expect(body).toContain('Title: Port triage');
    expect(body).toContain('1. Check metrics');
    expect(body).toContain('2. Check logs');
    expect(body).toContain('3. Report');
  });

  it('same id + same version → idempotent no-op', () => {
    const r = new SkillRegistry();
    const s = defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.register(s);
    r.register(s);
    expect(r.list()).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('same id + different version → replaces + warns', () => {
    const r = new SkillRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    r.register(defineSkill({ id: 'x', version: '2.0.0', title: 'X2', description: 'X2' }));
    expect(r.list()).toHaveLength(1);
    expect(r.getById('x')?.version).toBe('2.0.0');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('two skills with overlapping activeWhen both produce AgentInstructions', () => {
    interface D {
      severity: 'critical' | 'low';
      current: string | null;
    }
    const r = new SkillRegistry<D>();
    r.register(
      defineSkill<D>({
        id: 'a',
        version: '1.0.0',
        title: 'A',
        description: 'A',
        activeWhen: (d) => d.severity === 'critical',
        prompt: 'A-prompt',
      }),
    );
    r.register(
      defineSkill<D>({
        id: 'b',
        version: '1.0.0',
        title: 'B',
        description: 'B',
        activeWhen: (d) => d.current === 'b',
        prompt: 'B-prompt',
      }),
    );
    const instrs = r.toInstructions();
    expect(instrs).toHaveLength(2);
    // Both predicates can match simultaneously — composition is the
    // existing AgentInstruction pipeline's job.
    expect(instrs[0].activeWhen!({ severity: 'critical', current: 'b' })).toBe(true);
    expect(instrs[1].activeWhen!({ severity: 'critical', current: 'b' })).toBe(true);
  });

  it('surfaceMode "system-prompt" with skills → returns fragment', () => {
    const r = new SkillRegistry({ surfaceMode: 'system-prompt' });
    r.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'Does X' }));
    const frag = r.toPromptFragment();
    expect(frag).not.toBeNull();
    expect(frag).toContain('x — X: Does X');
  });

  it('surfaceMode "tool-only" → prompt fragment is null (tools carry everything)', () => {
    const r = new SkillRegistry({ surfaceMode: 'tool-only' });
    r.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    expect(r.toPromptFragment()).toBeNull();
  });
});

// ── Property ────────────────────────────────────────────────

describe('SkillRegistry — property', () => {
  it('idempotent registration: same {id, version} N times produces 1 instruction', () => {
    const r = new SkillRegistry();
    const s = defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' });
    r.register(s);
    r.register(s);
    r.register(s);
    expect(r.toInstructions()).toHaveLength(1);
  });

  it('every registered skill is reachable via both list_skills tool AND toInstructions', async () => {
    const r = new SkillRegistry();
    r.registerAll([
      defineSkill({ id: 'a', version: '1.0.0', title: 'A', description: 'A' }),
      defineSkill({ id: 'b', version: '1.0.0', title: 'B', description: 'B' }),
      defineSkill({ id: 'c', version: '1.0.0', title: 'C', description: 'C' }),
    ]);
    const { listSkills } = r.toTools();
    const listed = JSON.parse((await listSkills.handler({})).content as string).skills;
    expect(listed.map((s: { id: string }) => s.id).sort()).toEqual(['a', 'b', 'c']);
    expect(
      r
        .toInstructions()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  it('surfaceMode "both" → BOTH prompt fragment AND tools are non-empty', async () => {
    const r = new SkillRegistry({ surfaceMode: 'both' });
    r.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    expect(r.toPromptFragment()).not.toBeNull();
    const { listSkills, readSkill } = r.toTools();
    expect(listSkills).toBeDefined();
    expect(readSkill).toBeDefined();
  });
});

// ── Security ────────────────────────────────────────────────

describe('Skills — security', () => {
  it('tag-escape: </memory> </tool_use> </skill> in body are escaped', () => {
    const skill: Skill = {
      id: 'x',
      version: '1.0.0',
      title: 'X </memory> </tool_use> </skill>',
      description: 'Also </memory>',
      steps: ['step </tool_use>'],
      prompt: 'guidance </skill>',
    };
    const body = renderSkillBody(skill);
    expect(body).not.toContain('</memory>');
    expect(body).not.toContain('</tool_use>');
    expect(body).not.toContain('</skill>');
    expect(body).toContain('</m\u200Demory>');
    expect(body).toContain('</m\u200Dool_use>');
    expect(body).toContain('</m\u200Dkill>');
  });

  it('read_skill path-traversal attempt → unknown id error, no filesystem access', async () => {
    const r = new SkillRegistry();
    r.register(defineSkill({ id: 'safe', version: '1.0.0', title: 'S', description: 'S' }));
    const { readSkill } = r.toTools();
    // Ids are registry lookups only — no filesystem. Defense-in-depth test.
    for (const id of ['../etc/passwd', '../../secret', '/absolute/path', 'safe/../other']) {
      const result = await readSkill.handler({ id });
      expect(result.isError).toBe(true);
      expect((result.content as string).toLowerCase()).toContain('not found');
    }
  });

  it('two separate registries do not share state', () => {
    const r1 = new SkillRegistry();
    const r2 = new SkillRegistry();
    r1.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    expect(r2.list()).toEqual([]);
    expect(r2.getById('x')).toBeUndefined();
  });

  it('descriptions are not silently truncated (panel #3 caps ARE a recommendation, not enforcement)', () => {
    const r = new SkillRegistry();
    const long = 'x'.repeat(1000);
    r.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: long }));
    expect(r.getById('x')?.description).toBe(long);
    // Library trusts author — doesn't silently modify descriptions.
  });
});
