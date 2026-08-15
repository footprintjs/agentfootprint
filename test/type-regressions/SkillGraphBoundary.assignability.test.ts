/**
 * Compile-level regression test — the skill-graph boundary contract's
 * structural mirrors really are structural.
 *
 * `test/lib/injection-engine/skill-graph-fence.test.ts` proves the pure core
 * imports no engine and no agent loop. It does that by refusing imports —
 * including the two the boundary used to make: `adapters/types.ts#LLMToolSchema`
 * and `cache/types.ts#CachePolicy`, which `ActiveInjection` named inline. Those
 * are now `SkillToolSchema` and `SkillCachePolicy`, declared in
 * `hostContract.ts` with zero imports.
 *
 * A copied type is only safe while it is still the same type. The fence's own
 * AST check catches a drifted FIELD LIST; this file is the other half — the
 * REAL compiler (`npm run test:types`) checking that values assign in both
 * directions, which is what actually breaks if a variant or an optionality
 * marker moves. If either mirror drifts, one of these lines stops compiling.
 *
 * It also pins the two shapes the fence made narrower:
 *
 *   • `SkillTool` — a real `Tool` must satisfy it (so declaring a skill with
 *     framework tools still typechecks) AND it must be accepted where a `Tool`
 *     is (so a host's own tool object goes in unchanged). That two-way
 *     assignability is the whole reason narrowing `InjectionContent.tools` was
 *     a refactor and not a breaking change.
 *   • `ToolResultStatus` — one declaration, reachable under both names.
 *
 * Lives under its own tsconfig (`npm run test:types`) so the compiler checks
 * the assignments, while the `.test.ts` name lets vitest run the assertions.
 */
import { describe, expect, it } from 'vitest';

import { defineTool, type Tool } from '../../src/index';
import type { LLMToolSchema } from '../../src/adapters/types';
import type { CachePolicy, CachePolicyContext } from '../../src/cache/types';
import type {
  SkillCachePolicy,
  SkillCachePolicyContext,
  SkillGraphHost,
  SkillTool,
  SkillToolDescriptor,
  SkillToolSchema,
} from '../../src/doors/skill-graph';
import { TOOL_RESULT_STATUSES, type ToolResultStatus } from '../../src/doors/skill-graph';
import type { ToolResultStatus as StatusFromLoop } from '../../src/core/agent/toolEffects';
import type { InjectionContent } from '../../src/doors/skill-graph';

describe('SkillToolSchema is LLMToolSchema, spelled without the adapter', () => {
  it('assigns in both directions without a cast', () => {
    const real: LLMToolSchema = {
      name: 'lookup_order',
      description: 'Look an order up by id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    };
    const mirrored: SkillToolSchema = real;
    const back: LLMToolSchema = mirrored;
    expect(back.name).toBe('lookup_order');
  });
});

describe('SkillCachePolicy is CachePolicy, spelled without the cache layer', () => {
  it('carries every variant, both ways', () => {
    const literals: CachePolicy[] = ['always', 'never', 'while-active'];
    const mirrored: SkillCachePolicy[] = literals;
    const back: CachePolicy[] = mirrored;
    expect(back).toHaveLength(3);
  });

  it('carries the predicate variant, both ways', () => {
    const real: CachePolicy = { until: (ctx: CachePolicyContext) => ctx.iteration > 3 };
    const mirrored: SkillCachePolicy = real;
    const back: CachePolicy = mirrored;
    const asMirror: SkillCachePolicy = {
      until: (ctx: SkillCachePolicyContext) => ctx.cumulativeInputTokens > 1000,
    };
    const asReal: CachePolicy = asMirror;
    expect(typeof back).toBe('object');
    expect(typeof asReal).toBe('object');
  });
});

describe('SkillTool is the narrow shape a Tool already satisfies', () => {
  const tool = defineTool<{ id: string }, string>({
    name: 'lookup_order',
    description: 'Look an order up by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: ({ id }) => `order ${id}`,
  });

  it('accepts a framework Tool where a SkillTool is asked for', () => {
    // This is the line that keeps `defineSkill({ tools: [...] })` compiling.
    const narrowed: SkillTool<{ id: string }, string> = tool;
    const content: InjectionContent = { systemPrompt: 'body', tools: [tool] };
    expect(narrowed.schema.name).toBe('lookup_order');
    expect(content.tools).toHaveLength(1);
  });

  it('accepts a SkillTool where a framework Tool is asked for', () => {
    // The reverse direction: everything else on `Tool` is optional, which is
    // why the tools slot and the tool registry still take what a skill carries.
    const hand: SkillTool = {
      schema: { name: 'ping', description: 'ping', inputSchema: { type: 'object' } },
      execute: () => 'pong',
    };
    const asTool: Tool = hand;
    expect(asTool.schema.name).toBe('ping');
  });

  it('a descriptor is plain data a host can wrap in its own tool type', () => {
    const d: SkillToolDescriptor<{ id: string }, string> = {
      name: 'read_skill',
      description: 'Activate a skill.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      execute: ({ id }) => `Skill '${id}' activated for the next iteration.`,
    };
    const wrapped = defineTool<{ id: string }, string>({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
      execute: (args) => d.execute(args),
    });
    expect(wrapped.schema.name).toBe('read_skill');
  });
});

describe('ToolResultStatus is one type under two names', () => {
  it('assigns in both directions', () => {
    const fromGraph: ToolResultStatus = 'denied';
    const fromLoop: StatusFromLoop = fromGraph;
    const back: ToolResultStatus = fromLoop;
    expect(back).toBe('denied');
  });

  it('the exported list is the whole closed vocabulary', () => {
    expect([...TOOL_RESULT_STATUSES].sort()).toEqual([
      // `absent` is the seventh (the `absent()` primitive): "we looked and
      // there was nothing" must not route down the same edge as "the call
      // broke", which is what folding it into `failure` would have done.
      'absent',
      'denied',
      'failure',
      'invalid',
      'partial',
      'pending',
      'success',
    ]);
  });
});

describe('SkillGraphHost is documentation a host can typecheck against', () => {
  it('a minimal host implements every obligation', () => {
    const moves: string[] = [];
    const host: SkillGraphHost = {
      advanceCursor: (ctx) => ctx.pendingSkillPick ?? ctx.currentSkillId,
      acceptSkillPick: (skillId, currentSkillId) =>
        currentSkillId === undefined || skillId !== currentSkillId,
      publishAcceptedPick: (skillId) => void moves.push(skillId ?? '(cleared)'),
      carryCursor: (nextSkillId) => void moves.push(`cursor:${nextSkillId ?? 'none'}`),
      emitSkillEvent: (name) => void moves.push(name),
    };

    // Obligation 3: clear first, then set only what obligation 2 accepted.
    host.publishAcceptedPick(undefined);
    const accepted = host.acceptSkillPick('billing', 'triage');
    if (accepted) host.publishAcceptedPick('billing');

    // Obligation 1 + 4: one advance, off one ctx, carried forward.
    const next = host.advanceCursor({
      iteration: 2,
      userMessage: 'where is my invoice',
      currentSkillId: 'triage',
      pendingSkillPick: 'billing',
    });
    host.carryCursor(next);
    host.emitSkillEvent('agentfootprint.skill.activated', { id: 'billing' });

    expect(next).toBe('billing');
    expect(moves).toEqual([
      '(cleared)',
      'billing',
      'cursor:billing',
      'agentfootprint.skill.activated',
    ]);
  });
});
