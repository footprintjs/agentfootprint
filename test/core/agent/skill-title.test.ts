/**
 * A skill's plain name — `defineSkill({ title })` → `skill.graph_declared`
 * `nodes[].title`.
 *
 * The graph draws a skill node with its id as the caption (`label === id` on
 * every skill node of a real recording), so a report that wants to say "the
 * array estate report skill" had nothing to read but an app's own table. The
 * title is declared once, on the skill, and rides the record; the model never
 * reads it.
 *
 * Test types (Convention 3):
 *   - UNIT        — validation at the call site; the frozen skill carries it
 *                   top-level (survives a `{ ...injection }` spread).
 *   - FUNCTIONAL  — `buildSkillGraphDeclared` joins it by id, by presence.
 *   - INTEGRATION — a real run: the event carries it; the model's request
 *                   is byte-identical with and without it.
 *   - BYTE LAW    — no title ⇒ no `title` key anywhere; label untouched.
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { buildSkillGraphDeclared } from '../../../src/core/agent/skillGraphDeclared.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

const inventory = (title?: string) =>
  defineSkill({
    id: 'array-inventory',
    description: 'arrays, volumes and the VMs on them',
    body: 'Array inventory body.',
    ...(title !== undefined && { title }),
  });

describe('UNIT — defineSkill({ title })', () => {
  it('carries a valid title, trimmed, top-level', () => {
    const s = inventory('  array estate report ');
    expect(s.title).toBe('array estate report');
    expect({ ...s }.title).toBe('array estate report');
  });

  it('declaring none adds no key', () => {
    expect('title' in inventory()).toBe(false);
  });

  it.each([
    ['an empty title', '  ', /non-empty/],
    ['a two-line title', 'array\nestate', /one line/],
    ['a title over 60 characters', 'x'.repeat(61), /limit is 60/],
    ['the id itself', 'array-inventory', /the id itself/],
  ])('refuses %s', (_label, title, message) => {
    expect(() => inventory(title)).toThrow(message);
  });
});

describe('FUNCTIONAL — the projection joins it by id', () => {
  it('a titled skill node carries title; the drawn label stays the id', () => {
    const titled = inventory('array estate report');
    const other = defineSkill({ id: 'io-profile', description: 'io', body: 'b' });
    const graph = skillGraph()
      .entry(titled)
      .route(titled, other, { onToolReturn: 'probe' })
      .build();
    const map = buildSkillGraphDeclared(graph, graph.skills)!;
    const node = map.nodes.find((n) => n.id === 'array-inventory')!;
    expect(node.title).toBe('array estate report');
    expect([undefined, 'array-inventory']).toContain(node.label); // never the title
    expect('title' in map.nodes.find((n) => n.id === 'io-profile')!).toBe(false);
  });
});

async function runWith(title?: string) {
  const requests: string[] = [];
  const inner = mock({ replies: [{ content: 'done' }] });
  const provider = {
    name: inner.name,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.stringify(req));
      return inner.complete(req);
    },
  };
  const s = inventory(title);
  const graph = skillGraph().entry(s).build();
  const agent = Agent.create({ provider, model: 'mock' }).skillGraph(graph).build();
  const declared: Record<string, unknown>[] = [];
  agent.on('agentfootprint.skill.graph_declared', (e) =>
    declared.push(e.payload as unknown as Record<string, unknown>),
  );
  await agent.run({ message: 'which arrays?' });
  return { requests, declared };
}

describe('INTEGRATION + BYTE LAW — on the record, never in the request', () => {
  it('the event carries the title; the request is byte-identical to the untitled run', async () => {
    const titled = await runWith('array estate report');
    const plain = await runWith();
    const nodes = (p: Record<string, unknown>) =>
      p.nodes as { id: string; title?: string; label?: string }[];
    expect(nodes(titled.declared[0]!).find((n) => n.id === 'array-inventory')!.title).toBe(
      'array estate report',
    );
    expect(titled.requests).toEqual(plain.requests);
    expect(titled.requests.join('')).not.toContain('array estate report');
  });

  it('an untitled graph records the bytes it always did — no title key on any node', async () => {
    const plain = await runWith();
    expect(JSON.stringify(plain.declared)).not.toContain('"title"');
  });
});
