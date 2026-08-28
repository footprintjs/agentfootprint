/**
 * Grounded numbers — the staged-refs nudge + the revise correction that
 * names the route (`.namesAndNumbersFromEvidence({ nudge })`).
 *
 * The field failure this closes: four tool results carried real numbers, a
 * compute tool with `wants` was on the wire, the app's prompt said to use it
 * — and the model summed the numbers in its head. The gate recorded
 * "appears in no tool result" and the answer shipped anyway.
 *
 * Sections follow Convention 3: Functional (the nudge fires on the declared
 * join; observe stays advisory) · Integration (revise names refs + spender,
 * the retry lands grounded; still-ungrounded delivers with both attempts;
 * rails refuses) · Edge (no refs staged → the clause is omitted, gracefully
 * and byte-identically) · Regression (dial absent / off / unarmed →
 * byte-identical prompts AND records).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  UnsupportedValuesError,
  EVIDENCE_CHECK_FRAME_PREFIX,
} from '../../../src/index.js';
import type { LLMMessage, LLMRequest } from '../../../src/adapters/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const ROWS = JSON.stringify(
  Array.from({ length: 200 }, (_, i) => ({ volume: `vol-${i}`, gb: 18 })),
);

/** The staged data: over the placement threshold, minted as the consumer's
 *  own kind (`resultKind`) so a `wants` spender can take the ticket. */
const exportRows = defineTool({
  name: 'export_rows',
  description: 'export the volume rows',
  resultKind: 'dataset/rows',
  execute: () => ROWS,
});

/** The visible addends — small, inline, grounded. */
const getSizes = defineTool({
  name: 'get_sizes',
  description: 'per-array capacity',
  execute: () => 'capacities: 1200 GB, 840 GB, 1032 GB, 600 GB',
});

/** The spender: declares `wants` over the staged kind — the DECLARED signal
 *  the join matches on, never the tool's name. */
const compute = defineTool<{ dataset: string; op: string }, string>({
  name: 'compute',
  description: 'compute over a staged dataset',
  inputSchema: {
    type: 'object',
    properties: { dataset: { type: 'string' }, op: { type: 'string' } },
  },
  wants: { dataset: 'dataset/rows' },
  execute: () => 'total: 3672 GB',
});

const HEAD_MATH_ANSWER = 'Total capacity is 3,672 GB across the four arrays.';
const SAFE_ANSWER = 'The rows are exported and staged for computation.';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Script = readonly ((req: LLMRequest) => Reply)[];

const callTool =
  (id: string, name: string, args: object = {}) =>
  (): Reply => ({
    content: '',
    toolCalls: [{ id, name, args }],
  });
const answer = (content: string) => (): Reply => ({ content });

/** The ref the placement mint spoke, read off the ticket the model was
 *  handed — a scripted model learns it the same way a real one does. */
const refInRequest = (req: LLMRequest): string => {
  for (const m of req.messages) {
    if (m.role !== 'tool') continue;
    try {
      const parsed = JSON.parse(m.content) as { placed?: boolean; ref?: string };
      if (parsed.placed === true && typeof parsed.ref === 'string') return parsed.ref;
    } catch {
      /* ordinary result */
    }
  }
  throw new Error('no placed ticket in the request');
};

/** A scripted provider that also captures every request verbatim. */
const scripted = (script: Script) => {
  const requests: LLMRequest[] = [];
  let i = 0;
  return {
    requests,
    provider: {
      name: 'scripted-mock',
      complete: async (req: LLMRequest) => {
        // JSON round-trip, not structuredClone: `req.messages` can be a live
        // TypedScope proxy view, which structuredClone refuses.
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const step = script[Math.min(i, script.length - 1)];
        i += 1;
        const reply = step(req);
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
};

type Caught = { name: string; payload: Record<string, unknown> };
const capture = () => {
  const all: Caught[] = [];
  const recorder = {
    id: 'capture-grounded',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
      all.push({ name: e.name, payload: e.payload ?? {} });
    },
  };
  const of = (name: string) => all.filter((e) => e.name === name).map((e) => e.payload);
  return { all, of, recorder };
};

const build = (
  script: Script,
  opts: {
    gate?: { posture?: 'assist' | 'guard' | 'rails'; nudge?: boolean };
    tools?: readonly (typeof exportRows)[];
    placement?: boolean;
  } = {},
) => {
  const caps = capture();
  const { requests, provider } = scripted(script);
  let builder = Agent.create({
    provider: provider as never,
    model: 'mock',
    maxIterations: 8,
    artifacts: {
      store: inMemoryArtifacts(),
      ...(opts.placement !== false && { placement: { maxInlineChars: 2000 } }),
    },
  }).system('You are a storage engineer.');
  for (const tool of opts.tools ?? [exportRows, getSizes, compute]) builder = builder.tool(tool);
  if (opts.gate !== undefined) builder = builder.namesAndNumbersFromEvidence(opts.gate);
  const agent = builder.watch(caps.recorder).build();
  return { agent, requests, ...caps };
};

const historyOf = (agent: Agent): readonly LLMMessage[] =>
  (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;

const NUDGE_OPEN = '[staged data';
const CLAUSE_OPEN = 'This turn staged data you can compute over';

// ─────────────────────────────────────────────────────────────────────────
// Functional — the nudge fires exactly on the declared join
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the staged-refs nudge', () => {
  it('appends ONE late line naming the ref and the spender, while both conditions hold', async () => {
    const { agent, requests, of } = build([callTool('t1', 'export_rows'), answer(SAFE_ANSWER)], {
      gate: { nudge: true },
    });
    await agent.run({ message: 'stage the rows' }, { sessionId: 'nudge-on' });

    // Iteration 1: no staged ref exists yet — no line.
    expect(JSON.stringify(requests[0]!.messages)).not.toContain(NUDGE_OPEN);

    // Iteration 2: the ticket is in context and `compute` is served — the
    // LAST message is the nudge, naming the ref and the spender by its
    // registered name.
    const last = requests[1]!.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content.startsWith(NUDGE_OPEN)).toBe(true);
    expect(last.content).toContain(refInRequest(requests[1]!));
    expect(last.content).toContain('(dataset/rows)');
    expect(last.content).toContain('`compute`');
    expect(last.content).toContain('must come from a tool result');

    // The record: one grounding_nudged per firing, refs + tools as data.
    const nudged = of('agentfootprint.agent.grounding_nudged');
    expect(nudged).toHaveLength(1);
    expect(nudged[0]!.tools).toEqual(['compute']);
    expect((nudged[0]!.refs as { kind: string }[])[0]!.kind).toBe('dataset/rows');

    // Ephemeral by design: the line is request-only, never conversation.
    expect(JSON.stringify(historyOf(agent))).not.toContain(NUDGE_OPEN);
  });

  it('advisory under observe: the nudge fires, the flagged answer still ships', async () => {
    const { agent, of } = build([callTool('t1', 'export_rows'), answer(HEAD_MATH_ANSWER)], {
      gate: { posture: 'assist', nudge: true },
    });
    const out = await agent.run({ message: 'total?' }, { sessionId: 'observe' });

    expect(out).toBe(HEAD_MATH_ANSWER);
    expect(of('agentfootprint.agent.grounding_nudged')).toHaveLength(1);
    const checks = of('agentfootprint.agent.evidence_checked');
    expect(checks.map((c) => c.action)).toEqual(['flagged']);
    expect(checks[0]!.posture).toBe('assist');
  });

  it('does not fire without a served spender — refs alone are not the join', async () => {
    const { agent, requests, of } = build([callTool('t1', 'export_rows'), answer(SAFE_ANSWER)], {
      gate: { nudge: true },
      tools: [exportRows, getSizes],
    });
    await agent.run({ message: 'stage the rows' }, { sessionId: 'no-spender' });

    expect(JSON.stringify(requests.map((r) => r.messages))).not.toContain(NUDGE_OPEN);
    expect(of('agentfootprint.agent.grounding_nudged')).toEqual([]);
  });

  it('does not fire without a staged ref — a spender alone is not the join', async () => {
    const { agent, requests, of } = build([callTool('t1', 'get_sizes'), answer(SAFE_ANSWER)], {
      gate: { nudge: true },
      placement: false,
    });
    await agent.run({ message: 'sizes?' }, { sessionId: 'no-refs' });

    expect(JSON.stringify(requests.map((r) => r.messages))).not.toContain(NUDGE_OPEN);
    expect(of('agentfootprint.agent.grounding_nudged')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — revise: the correction names the route, the retry lands
// ─────────────────────────────────────────────────────────────────────────

describe('integration: revise teaches the compute route', () => {
  const reviseScript: Script = [
    callTool('t1', 'export_rows'),
    callTool('t2', 'get_sizes'),
    answer(HEAD_MATH_ANSWER), // 3672 appears in no tool result — head math
    (req) => ({
      // The scripted model follows the correction: spend the named ref.
      content: '',
      toolCalls: [{ id: 't3', name: 'compute', args: { dataset: refInRequest(req), op: 'sum' } }],
    }),
    answer(HEAD_MATH_ANSWER), // same sentence — now grounded in compute's result
  ];

  it('quotes the value, names the ref and the spender, and the second answer lands clean', async () => {
    const { agent, of } = build(reviseScript, { gate: { posture: 'guard', nudge: true } });
    const out = await agent.run({ message: 'total capacity?' }, { sessionId: 'revise' });

    // Delivered: the SAME sentence, but the number is now read from a tool.
    expect(out).toBe(HEAD_MATH_ANSWER);

    const checks = of('agentfootprint.agent.evidence_checked');
    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'grounded']);
    expect(checks[1]!.afterRevision).toBe(true);

    // The revision-asked record carries what the correction TAUGHT.
    const asked = checks[0]!;
    expect((asked.stagedRefs as { kind: string }[])[0]!.kind).toBe('dataset/rows');
    expect(asked.spenderTools).toEqual(['compute']);

    // The correction itself: the 9.64.0 voice — quote the offending value,
    // state the fact, name the declared route.
    const correction = historyOf(agent).find(
      (m) => m.role === 'user' && m.content.startsWith(EVIDENCE_CHECK_FRAME_PREFIX),
    );
    expect(correction).toBeDefined();
    expect(correction!.content).toContain('3672'); // the quoted value
    expect(correction!.content).toContain('appear in NO tool result');
    expect(correction!.content).toContain(CLAUSE_OPEN);
    expect(correction!.content).toContain('(dataset/rows)');
    expect(correction!.content).toContain('`compute`');
    // The untrusted values still come last — after the authored frame.
    expect(correction!.content.trim().endsWith('(number)')).toBe(true);
  });

  it('still-ungrounded after the one revision: DELIVERED, both attempts on the record', async () => {
    const { agent, of } = build(
      [
        callTool('t1', 'export_rows'),
        answer(HEAD_MATH_ANSWER),
        answer(HEAD_MATH_ANSWER), // ignores the correction — no compute call
      ],
      { gate: { posture: 'guard', nudge: true } },
    );
    const out = await agent.run({ message: 'total?' }, { sessionId: 'stubborn' });

    // Revise is not refuse: the answer ships, with the record showing both
    // attempts and the same values surviving each.
    expect(out).toBe(HEAD_MATH_ANSWER);
    const checks = of('agentfootprint.agent.evidence_checked');
    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'flagged']);
    expect(checks[0]!.afterRevision).toBe(false);
    expect(checks[1]!.afterRevision).toBe(true);
    expect((checks[1]!.unsupported as { value: string }[]).map((v) => v.value)).toContain('3672');
    expect(agent.unsupportedValues()?.revised).toBe(true);
    expect(agent.unsupportedValues()?.refused).toBe(false);
  });

  it('refuse: rails withholds the answer that survived its revision', async () => {
    const { agent, of } = build(
      [callTool('t1', 'export_rows'), answer(HEAD_MATH_ANSWER), answer(HEAD_MATH_ANSWER)],
      { gate: { posture: 'rails', nudge: true } },
    );

    await expect(agent.run({ message: 'total?' }, { sessionId: 'rails' })).rejects.toThrow(
      UnsupportedValuesError,
    );
    expect(of('agentfootprint.agent.evidence_checked').map((c) => c.action)).toEqual([
      'revision-asked',
      'refused',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge — no refs staged: the clause is omitted, gracefully
// ─────────────────────────────────────────────────────────────────────────

describe('edge: the correction without staged refs', () => {
  it('omits the refs clause and keeps the standard frame — nothing dangles', async () => {
    const { agent, of } = build(
      [callTool('t1', 'get_sizes'), answer(HEAD_MATH_ANSWER), answer(SAFE_ANSWER)],
      { gate: { posture: 'guard' }, placement: false },
    );
    await agent.run({ message: 'total?' }, { sessionId: 'no-refs-guard' });

    const correction = historyOf(agent).find(
      (m) => m.role === 'user' && m.content.startsWith(EVIDENCE_CHECK_FRAME_PREFIX),
    );
    expect(correction).toBeDefined();
    expect(correction!.content).not.toContain(CLAUSE_OPEN);
    expect(correction!.content).toContain('call the tool that provides it. If the data');

    const asked = of('agentfootprint.agent.evidence_checked')[0]!;
    expect('stagedRefs' in asked).toBe(false);
    expect('spenderTools' in asked).toBe(false);
  });

  it('a guard agent with NO wants tool writes the exact same correction', async () => {
    // The staged-refs deps are threaded only when a `wants` tool exists —
    // this pins that an agent without one keeps the 9.35.0 bytes.
    const run = async (tools: readonly (typeof getSizes)[]) => {
      const { agent } = build(
        [callTool('t1', 'get_sizes'), answer(HEAD_MATH_ANSWER), answer(SAFE_ANSWER)],
        { gate: { posture: 'guard' }, tools, placement: false },
      );
      await agent.run({ message: 'total?' }, { sessionId: 'twin' });
      return historyOf(agent).find(
        (m) => m.role === 'user' && m.content.startsWith(EVIDENCE_CHECK_FRAME_PREFIX),
      )!.content;
    };
    const withWantsTool = await run([getSizes, compute]);
    const withoutWantsTool = await run([getSizes]);
    expect(withWantsTool).toBe(withoutWantsTool);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — dial absent / off / unarmed → byte-identical
// ─────────────────────────────────────────────────────────────────────────

describe('regression: absent means today, proven on prompts AND records', () => {
  const SCRIPT: Script = [callTool('t1', 'export_rows'), answer(HEAD_MATH_ANSWER)];

  const runWith = async (gate?: { posture?: 'assist'; nudge?: boolean }) => {
    const { agent, requests, all } = build(SCRIPT, gate === undefined ? {} : { gate });
    const out = await agent.run({ message: 'total?' }, { sessionId: 'zero-delta' });
    return { out, requests, all, history: historyOf(agent) };
  };

  it('no gate / gate without nudge / nudge:false — every request byte-identical', async () => {
    const bare = await runWith(undefined);
    const gateOnly = await runWith({});
    const nudgeOff = await runWith({ nudge: false });

    // The PROMPTS: same messages, same system prompt, same tools — the dial
    // in its off positions composes nothing. Minted refs are random per run,
    // so they are normalized before the byte comparison; every other byte
    // must match.
    const stable = (requests: readonly LLMRequest[]) =>
      JSON.stringify(requests).replace(/art_[A-Za-z0-9]+/g, 'art_REF');
    expect(stable(gateOnly.requests)).toBe(stable(bare.requests));
    expect(stable(nudgeOff.requests)).toBe(stable(bare.requests));

    // The RECORDS: no nudge event anywhere, no staged-refs fields, and the
    // conversation the run keeps is the same one.
    for (const r of [bare, gateOnly, nudgeOff]) {
      expect(r.all.some((e) => e.name === 'agentfootprint.agent.grounding_nudged')).toBe(false);
      expect(JSON.stringify(r.history).replace(/art_[A-Za-z0-9]+/g, 'art_REF')).toBe(
        JSON.stringify(bare.history).replace(/art_[A-Za-z0-9]+/g, 'art_REF'),
      );
      expect(r.out).toBe(HEAD_MATH_ANSWER);
    }

    // The gate itself still records under its default posture — the 9.35.0
    // behavior, untouched.
    expect(bare.all.some((e) => e.name.includes('evidence'))).toBe(false);
    expect(
      gateOnly.all
        .filter((e) => e.name === 'agentfootprint.agent.evidence_checked')
        .map((e) => e.payload.action),
    ).toEqual(['flagged']);
  });

  it('refuses a non-boolean nudge where it is written', () => {
    expect(() =>
      Agent.create({
        provider: {
          name: 'm',
          complete: async () => ({ content: '', toolCalls: [], usage: { input: 0, output: 0 } }),
        } as never,
        model: 'm',
      }).namesAndNumbersFromEvidence({ nudge: 'yes' as never }),
    ).toThrow(/nudge must be a boolean/);
  });
});
