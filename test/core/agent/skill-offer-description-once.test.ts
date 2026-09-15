/** Native provider-request regression: descriptions are catalog entries keyed
 * by skill ID, not duplicated prose in the outstanding routing menu. Mock
 * choices verify admission and execution, not a real model's routing quality. */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { defineSkill, keywordScorer, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest, PermissionChecker } from '../../../src/adapters/types.js';
import type { MockReply } from '../../../src/adapters/llm/MockProvider.js';

const descriptions = {
  vip: 'DESCRIPTION_VIP_SENTINEL',
  billing: 'DESCRIPTION_BILLING_SENTINEL',
  shipping: 'DESCRIPTION_SHIPPING_SENTINEL',
  other: 'DESCRIPTION_OTHER_SENTINEL',
} as const;
type SkillId = keyof typeof descriptions;
const ids = Object.keys(descriptions) as SkillId[];
const pick = (id: SkillId, callId: string): MockReply => ({
  toolCalls: [{ id: callId, name: 'read_skill', args: { id } }],
});
const work = (id: SkillId, callId: string): MockReply => ({
  toolCalls: [{ id: callId, name: `${id}_lookup`, args: {} }],
});

function fixture(script: readonly MockReply[], permissionChecker?: PermissionChecker) {
  const requests: LLMRequest[] = [];
  const executed: SkillId[] = [];
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  let index = 0;
  const provider = mock({
    respond(request) {
      // The native frame may contain read-only scope proxies; capture its actual
      // serializable provider surface rather than retaining a live proxy.
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      const reply = script[index++];
      if (reply === undefined) throw new Error('Unexpected additional provider call');
      return reply;
    },
  });
  const skill = (id: SkillId) =>
    defineSkill({
      id,
      description: descriptions[id],
      body: `Use the ${id} lookup for this desk.`,
      tools: [
        defineTool({
          name: `${id}_lookup`,
          description: `${id} lookup`,
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          execute: () => {
            executed.push(id);
            return `${id} lookup completed`;
          },
        }),
      ],
    });
  const graph = skillGraph()
    .entry(skill('vip'), { match: { keywords: ['vip'] } })
    .entry(skill('billing'), {
      match: { intent: 'customer wants a refund', examples: ['refund my order'] },
    })
    .entry(skill('shipping'), {
      match: { intent: 'customer asks about delivery', examples: ['track my order delivery'] },
    })
    .entry(skill('other'), {
      match: { intent: 'anything else entirely', examples: ['completely different topic zone'] },
    })
    .classify(keywordScorer())
    .build({ scopeTools: true });
  const agent = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 6,
    ...(permissionChecker && { permissionChecker }),
  })
    .system('Use the appropriate support desk.')
    .skillGraph(graph, { strictness: 'assist', continuity: 'conversation' })
    .watch({
      id: 'offer-description-once',
      onEmit(event: { name: string; payload?: Record<string, unknown> }) {
        events.push({ name: event.name, payload: event.payload ?? {} });
      },
    })
    .build();
  return { agent, requests, executed, events };
}

function assertCatalog(request: LLMRequest, current?: SkillId, hidden: readonly SkillId[] = []) {
  const tool = request.tools?.find((candidate) => candidate.name === 'read_skill');
  expect(tool).toBeDefined();
  const schema = tool!.inputSchema as { properties: { id: { enum: string[] } } };
  // The unchanged full enum lets off-menu IDs reach the native admission gate.
  expect(schema.properties.id.enum).toEqual(ids);
  const allContent = JSON.stringify(request);
  for (const id of ids) {
    // The current cursor already has its body and scoped tools. The existing
    // contract names it separately and omits it from both catalog columns.
    expect(
      allContent.split(descriptions[id]).length - 1,
      `${id} description in provider request`,
    ).toBe(hidden.includes(id) || id === current ? 0 : 1);
  }
  if (current !== undefined) {
    expect(tool!.description).toContain(current);
    expect(request.systemPrompt).toContain(`Use the ${current} lookup for this desk.`);
    expect(request.tools?.map((candidate) => candidate.name)).toContain(`${current}_lookup`);
  }
}

describe('native skill offer description identity', () => {
  it('describes each candidate once and preserves the active skill across a subject-switch followUp', async () => {
    const f = fixture([
      pick('billing', 'choose-billing'),
      work('billing', 'lookup-billing'),
      'billing done',
      work('shipping', 'lookup-shipping'),
      'shipping done',
    ]);
    await f.agent.run({ message: 'my order' });
    expect(f.agent.checkpoint()?.skillCursor).toBe('billing');
    await f.agent.followUp('now track my parcel delivery');
    expect(f.agent.checkpoint()?.skillCursor).toBe('shipping');
    expect(f.executed).toEqual(['billing', 'shipping']);
    expect(f.requests).toHaveLength(5);
    expect(f.requests[0]!.tools?.map((tool) => tool.name)).toEqual(['read_skill']);
    expect(f.requests[1]!.tools?.map((tool) => tool.name)).toContain('billing_lookup');
    expect(f.requests[3]!.tools?.map((tool) => tool.name)).toContain('shipping_lookup');
    expect(f.requests[3]!.tools?.map((tool) => tool.name)).not.toContain('billing_lookup');
    expect(f.events.filter((event) => event.name === 'agentfootprint.skill.rejected')).toEqual([]);
    expect(
      f.events
        .filter((event) => event.name === 'agentfootprint.skill.turn_routed')
        .map((event) => event.payload),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ by: 'menu' }),
        expect.objectContaining({ by: 'intent', from: 'billing', to: 'shipping' }),
      ]),
    );
    const current = [undefined, 'billing', 'billing', 'shipping', 'shipping'] as const;
    f.requests.forEach((request, index) => assertCatalog(request, current[index]));
  });

  it('retains an off-menu skill and still admits its explicit assist-mode pick', async () => {
    const f = fixture([pick('other', 'choose-other'), work('other', 'lookup-other'), 'done']);
    await f.agent.run({ message: 'my order' });
    const route = f.events.find(
      (event) => event.name === 'agentfootprint.skill.turn_routed',
    )!.payload;
    expect(route.by).toBe('menu');
    expect(route.offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
    expect(route.offered).not.toContain('other');
    expect(
      f.events.some(
        (event) =>
          event.name === 'agentfootprint.context.evaluated' &&
          (event.payload.cursorMove as { to?: string; declinedOffer?: boolean } | undefined)?.to ===
            'other' &&
          (event.payload.cursorMove as { declinedOffer?: boolean }).declinedOffer === true,
      ),
    ).toBe(true);
    expect(f.executed).toEqual(['other']);
    expect(f.events.filter((event) => event.name === 'agentfootprint.skill.rejected')).toEqual([]);
    f.requests.forEach((request, index) =>
      assertCatalog(request, index === 0 ? undefined : 'other'),
    );
  });

  it('omits role-hidden descriptions without shrinking the schema enum or bypassing permission checks', async () => {
    const checked: string[] = [];
    const permissionChecker: PermissionChecker = {
      name: 'hide-shipping',
      governs: ['skill_read'],
      check(request) {
        checked.push(request.target);
        return request.capability === 'skill_read' && request.target === 'skill:shipping'
          ? { result: 'deny', rationale: 'not available to this role' }
          : { result: 'allow' };
      },
    };
    const f = fixture(
      [
        pick('shipping', 'denied-shipping'),
        pick('billing', 'choose-billing'),
        work('billing', 'lookup-billing'),
        'done',
      ],
      permissionChecker,
    );
    await f.agent.run({ message: 'zzz qqq www' });
    expect(checked).toContain('skill:shipping');
    expect(f.executed).toEqual(['billing']);
    expect(f.agent.checkpoint()?.skillCursor).toBe('billing');
    expect(
      f.requests.every(
        (request) => !request.tools?.some((tool) => tool.name === 'shipping_lookup'),
      ),
    ).toBe(true);
    expect(f.events.some((event) => event.name === 'agentfootprint.permission.check')).toBe(true);
    f.requests.forEach((request, index) =>
      assertCatalog(request, index < 2 ? undefined : 'billing', ['shipping']),
    );
  });
});
