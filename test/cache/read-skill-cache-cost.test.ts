/**
 * THE MEASUREMENT: what the per-iteration `read_skill` description costs the
 * prompt cache (R4).
 *
 * ── The finding ──────────────────────────────────────────────────────────
 * `skillToolDescriptors.describeOffer` builds the `read_skill` tool
 * DESCRIPTION from the cursor, every iteration: "Reachable from here:" plus
 * the open set, "Not reachable from here" plus the shut set, and the turn's
 * menu. So the tool DEFINITION changes whenever the cursor moves.
 *
 * The provider rule that makes this expensive: cache prefixes are built in the
 * order TOOLS → SYSTEM → MESSAGES, tools sit at position zero, and modifying
 * tool definitions (names, descriptions, parameters) invalidates the ENTIRE
 * cache — all three tiers, not just the tools block. So every cursor move
 * currently rebuilds the whole prompt cache.
 *
 * On the recorded 29-call turn there were 11 cursor moves, so the cache was
 * being rebuilt about a dozen times per turn INDEPENDENTLY of the meter bug.
 * Fixing the meter without fixing this produces an honest number that is still
 * terrible.
 *
 * ── Why this is a measurement and not a fix ──────────────────────────────
 * See docs/design/2026-08-recorded-not-built.md. In short: making the
 * description STABLE is one function, but the volatile guidance has to land
 * somewhere after the last cache breakpoint, which is the cache layer's
 * business (marker placement, the 4-breakpoint budget, the 20-block lookback).
 * That is a cross-layer change with a model-behaviour risk — the reachability
 * guidance is what stops the model picking ids the gate will refuse — and it
 * wants its own design round with an A/B on routing quality.
 *
 * ── What this test does ──────────────────────────────────────────────────
 * It COUNTS distinct `read_skill` descriptions across a turn and pins the
 * number, so the cost is a fact in the repo rather than an assertion in a
 * report. When R4 is fixed this test FAILS, which is the intended alarm: come
 * back, update the number, and update the design note.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest } from '../../src/adapters/types.js';

const noop = (name: string) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });

/** A five-skill chain, so the cursor has somewhere to walk. */
const chainGraph = () => {
  const a = defineSkill({ id: 'intake', description: 'take the request', body: 'INTAKE' });
  const b = defineSkill({ id: 'lookup', description: 'find the record', body: 'LOOKUP' });
  const c = defineSkill({ id: 'verify', description: 'check the record', body: 'VERIFY' });
  const d = defineSkill({ id: 'resolve', description: 'apply the fix', body: 'RESOLVE' });
  const e = defineSkill({ id: 'report', description: 'write it up', body: 'REPORT' });
  return skillGraph()
    .entry(a, { match: { keywords: ['request'] } })
    .route(a, b)
    .route(b, c)
    .route(c, d)
    .route(d, e)
    .build();
};

const pick = (id: string, callId: string) => ({
  content: '',
  toolCalls: [{ id: callId, name: 'read_skill', args: { id } }],
  stopReason: 'tool_use' as const,
});
const final = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

interface Snap {
  readonly readSkillDescription: string;
  readonly toolBlockBytes: number;
}

describe('R4 measurement: a cursor move rewrites the whole prompt cache', () => {
  it('counts the distinct read_skill descriptions one turn produces', async () => {
    const snaps: Snap[] = [];
    const script: unknown[] = [
      pick('lookup', 'c1'),
      pick('verify', 'c2'),
      pick('resolve', 'c3'),
      pick('report', 'c4'),
      final,
    ];
    let i = 0;

    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest) => {
          const tools = req.tools ?? [];
          const rs = tools.find((t) => t.name === 'read_skill');
          snaps.push({
            readSkillDescription: rs?.description ?? '',
            // What the whole tool block costs on the wire, as a proxy a
            // reader can sanity-check against their own provider bill.
            toolBlockBytes: JSON.stringify(tools).length,
          });
          return (script[i++] ?? final) as never;
        },
      }),
      model: 'mock',
      maxIterations: 10,
    })
      .system('s')
      .tool(noop('screen_open'))
      .skillGraph(chainGraph())
      .build();

    await agent.run('please handle this request');

    const descriptions = snaps.map((s) => s.readSkillDescription);
    const distinct = new Set(descriptions);

    // ── THE NUMBER ────────────────────────────────────────────────────
    // Five calls, four cursor moves, and the description is DIFFERENT on
    // every one of them. Each difference is one full prompt-cache rebuild:
    // tools sit at position zero of the cache prefix, and a changed tool
    // definition invalidates tools, system AND messages together.
    expect(snaps.length).toBe(5);
    expect(
      distinct.size,
      'If this dropped, the read_skill description became stable — R4 was fixed. ' +
        'Update this number and update docs/design/2026-08-recorded-not-built.md.',
    ).toBe(5);

    // Every description really is cursor-derived: it names where the model is
    // and what it can reach, which is exactly the per-iteration state R4 says
    // must move out of the tool DEFINITION.
    expect(descriptions[0]).toContain('Reachable from here');
    expect(descriptions[0]).not.toBe(descriptions[1]);

    // The cost is not hypothetical: the tool block is re-sent in full each
    // time, and it is the biggest single thing in the cached prefix.
    for (const s of snaps) expect(s.toolBlockBytes).toBeGreaterThan(200);
  });

  it('a cursor that does NOT move leaves the description alone (the control)', async () => {
    // The control arm proves the invalidation is caused by the CURSOR, not by
    // iteration count — so the fix is "get cursor state out of the tool
    // definition", not "send fewer tools".
    const seen: string[] = [];
    const script: unknown[] = [
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'screen_open', args: {} }],
        stopReason: 'tool_use',
      },
      {
        content: '',
        toolCalls: [{ id: 'c2', name: 'screen_open', args: {} }],
        stopReason: 'tool_use',
      },
      {
        content: '',
        toolCalls: [{ id: 'c3', name: 'screen_open', args: {} }],
        stopReason: 'tool_use',
      },
      final,
    ];
    let i = 0;
    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest) => {
          seen.push((req.tools ?? []).find((t) => t.name === 'read_skill')?.description ?? '');
          return (script[i++] ?? final) as never;
        },
      }),
      model: 'mock',
      maxIterations: 10,
    })
      .system('s')
      .tool(noop('screen_open'))
      .skillGraph(chainGraph())
      .build();

    await agent.run('please handle this request');

    // The cursor sat still, so the definition sat still — one description,
    // one cached prefix, however many iterations the turn ran.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
  });
});
