/**
 * Slice 2: skills that work on every provider. One test per row of the case
 * table (`PR` description): on a model that binds its reasoning, every skill
 * tool is listed from request 1 and a loaded body is its `read_skill` result,
 * so a skill load changes nothing a signed block was written under.
 *
 * Oracle: slice 1's INDEPENDENT prefix comparator over the scripted client's
 * request bodies (`harness.ts` · `prefixDiff`), never the library's own check.
 * The recorded decision is compared with `decisionRecord(evidence)` recomputed
 * from the table.
 *
 * Test type: integration (the real agent loop and adapter, a scripted SDK
 * client) / regression / byte identity.
 */
import { describe, expect, it } from 'vitest';
import { decideFromFacts, decisionRecord, fixedRecord } from 'footprintjs';
import { Agent, defineTool, isPaused, pauseHere } from '../../../src/index.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { ContextChangedError, mock } from '../../../src/providers.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';
import { SKILL_BODY_TABLE, SKILL_TOOL_TABLE } from '../../../src/injection-engine/skillContext.js';
import {
  prefixDiff,
  scriptedClient,
  unchanged,
  type Block,
  type Body,
  type Step,
} from './harness.js';

const BOUND = 'claude-haiku-5-5';
const UNBOUND = 'claude-haiku-4-5';
const BODY = 'SMB TRIAGE: check the share report first, then latency. Never delete a share.';

let executed: string[] = [];
const tool = (name: string, pause = false) =>
  defineTool<{ share?: string }, string>({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: 'object', properties: { share: { type: 'string' } } },
    execute: async () => {
      executed.push(name);
      if (pause && executed.filter((n) => n === name).length === 1)
        pauseHere({ question: 'Which share?' });
      return `${name} ran: ${'x'.repeat(60)}`;
    },
  });

const lookup = tool('lookup');
const smb = (opts: { scoped?: boolean; id?: string; pause?: boolean; body?: string } = {}) =>
  defineSkill({
    id: opts.id ?? 'smb-triage',
    description: 'Diagnose slow SMB shares.',
    body: opts.body ?? BODY,
    tools: [tool(`${opts.id ?? 'smb'}_report`, opts.pause)],
    ...(opts.scoped !== false && { autoActivate: 'currentSkill' as const }),
  });

type Builder = ReturnType<typeof Agent.create>;
interface Run {
  readonly model?: string;
  readonly script: readonly Step[];
  readonly build: (a: Builder) => Builder;
  readonly mode?: 'stream' | 'complete';
  readonly options?: Record<string, unknown>;
  readonly wrap?: (real: LLMProvider) => LLMProvider;
}

async function run(r: Run) {
  executed = [];
  const model = r.model ?? BOUND;
  const bodies: Body[] = [];
  const real = anthropic({ _client: scriptedClient(model, bodies, r.script) as never });
  const plain: LLMProvider =
    r.mode === 'complete' ? (({ stream: _s, ...rest }) => rest)(real) : real;
  const provider = r.wrap ? r.wrap(plain) : plain;
  const agent = r
    .build(
      Agent.create({ provider, model, maxIterations: 6, ...r.options })
        .system('You diagnose file-share problems.')
        .tool(lookup),
    )
    .build();
  const starts: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload as never));
  let answer: unknown;
  let error: unknown;
  try {
    answer = await agent.run({ message: 'Why is the finance share slow?' });
  } catch (e) {
    error = e;
  }
  return { agent, bodies, starts, answer, error };
}

const toolNames = (b: Body | undefined) => (b?.tools ?? []).map((t) => t.name).sort();
const resultOf = (b: Body | undefined, id: string): string | undefined => {
  for (const m of b?.messages ?? []) {
    if (typeof m.content === 'string') continue;
    for (const block of m.content as Block[]) {
      if (block.type === 'tool_result' && block.tool_use_id === id) {
        const c = block.content;
        return typeof c === 'string'
          ? c
          : (c as Block[]).map((x) => (typeof x.text === 'string' ? x.text : '')).join('');
      }
    }
  }
  return undefined;
};
/** Every consecutive pair of requests keeps the earlier one's prefix (system, tools, messages). */
const prefixHeld = (bodies: readonly Body[]) =>
  bodies.slice(1).every((b, i) => unchanged(prefixDiff(bodies[i]!, b)));

const READ: Step = { tool: 'read_skill', input: { id: 'smb-triage' } };
const DONE: Step = { text: 'The finance share is slow because of latency.' };

describe.each(['stream', 'complete'] as const)(
  '%s: a bound model, default configuration',
  (mode) => {
    it('1. a skill loaded in the first turn: tools listed from request 1, body is the read_skill result', async () => {
      const r = await run({
        mode,
        script: [{ ...READ, thinking: false }, DONE],
        build: (a) => a.skill(smb()),
      });
      expect(r.error).toBeUndefined();
      expect(toolNames(r.bodies[0])).toEqual(['lookup', 'read_skill', 'smb_report']);
      expect(unchanged(prefixDiff(r.bodies[0]!, r.bodies[1]!))).toBe(true);
      expect(resultOf(r.bodies[1], 'toolu_1')).toBe(BODY);
      expect(JSON.stringify(r.bodies[1]!.system)).not.toContain('SMB TRIAGE');
      const readSkill = r.bodies[0]!.tools!.find((t) => t.name === 'read_skill')!;
      expect(readSkill.description).toMatch(
        /A skill's body is returned as this call's result, unless the skill graph routes to it; its tools run after it loads/,
      );
    });

    it('2. loaded mid-turn after a tool call with signed thinking: no refusal, the prefix holds', async () => {
      const r = await run({
        mode,
        script: [{ tool: 'lookup', input: {} }, READ, { tool: 'smb_report', input: {} }, DONE],
        build: (a) => a.skill(smb()).thinking({ budget: 1500 }),
      });
      expect(r.error).toBeUndefined();
      expect(r.bodies).toHaveLength(4);
      expect(prefixHeld(r.bodies)).toBe(true);
      expect(executed).toEqual(['lookup', 'smb_report']);
      expect(r.starts.some((s) => s.contextChange !== undefined)).toBe(false);
    });
  },
);

describe('the case table, request by request (stream)', () => {
  it('3. a graph-activated skill: its body is in the system prompt from request 1; a read_skill load is its result', async () => {
    const t = (id: string) => tool(`${id}_tool`);
    const s = (id: string) =>
      defineSkill({ id, description: `${id} does things`, body: `${id}_BODY`, tools: [t(id)] });
    const g = skillGraph({
      skills: [s('alpha'), s('beta'), s('gamma')],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'off',
    });
    const r = await run({
      script: [{ tool: 'read_skill', input: { id: 'gamma' } }, DONE],
      build: (a) => a.skillGraph(g).thinking({ budget: 1500 }),
    });
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(r.bodies[0]!.system)).toContain('alpha_BODY');
    expect(toolNames(r.bodies[0])).toEqual(
      expect.arrayContaining(['alpha_tool', 'beta_tool', 'gamma_tool', 'read_skill']),
    );
    expect(prefixHeld(r.bodies)).toBe(true);
    expect(resultOf(r.bodies[1], 'toolu_1')).toBe('gamma_BODY');
  });

  it('3b. a graph cursor move mid-turn without read_skill stays the named refusal (not built here)', async () => {
    const s = (id: string) =>
      defineSkill({
        id,
        description: `${id} does things`,
        body: `${id}_BODY`,
        tools: [tool(`${id}_tool`)],
      });
    const g = skillGraph({
      skills: [s('alpha'), s('beta')],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'off',
    });
    const r = await run({
      script: [{ tool: 'alpha_tool', input: {} }, DONE],
      build: (a) => a.skillGraph(g).thinking({ budget: 1500 }),
    });
    expect(r.error).toBeInstanceOf(ContextChangedError);
    expect((r.error as Error).message).toMatch(/skill 'beta'/);
  });

  it('4. two skills: both tool sets listed from request 1, each body arrives as its own result', async () => {
    const r = await run({
      script: [READ, { tool: 'read_skill', input: { id: 'nfs' } }, DONE],
      build: (a) =>
        a
          .skill(smb())
          .skill(smb({ id: 'nfs', body: 'NFS: check the mount first.' }))
          .thinking({ budget: 1500 }),
    });
    expect(r.error).toBeUndefined();
    expect(toolNames(r.bodies[0])).toEqual(['lookup', 'nfs_report', 'read_skill', 'smb_report']);
    expect(prefixHeld(r.bodies)).toBe(true);
    expect(resultOf(r.bodies[2], 'toolu_1')).toBe(BODY);
    expect(resultOf(r.bodies[2], 'toolu_2')).toBe('NFS: check the mount first.');
  });

  it('5. a scoped skill tool called before its skill is loaded is refused with fixed words, then runs after read_skill', async () => {
    const r = await run({
      script: [
        { tool: 'smb_report', input: { share: 'SECRET-ARG' } },
        READ,
        { tool: 'smb_report', input: {} },
        DONE,
      ],
      build: (a) => a.skill(smb()).thinking({ budget: 1500 }),
    });
    expect(r.error).toBeUndefined();
    const refusal = resultOf(r.bodies[1], 'toolu_1');
    expect(refusal).toBe(
      "Tool 'smb_report' did not run: it belongs to skill 'smb-triage', which was not loaded on that " +
        "call; a read_skill call with id 'smb-triage' loads it.",
    );
    expect(refusal).not.toContain('SECRET-ARG');
    expect(executed).toEqual(['smb_report']);
    expect(prefixHeld(r.bodies)).toBe(true);
  });

  it('5b. an unscoped skill tool is listed and runs before read_skill, as today', async () => {
    const r = await run({
      script: [{ tool: 'smb_report', input: {} }, DONE],
      build: (a) => a.skill(smb({ scoped: false })).thinking({ budget: 1500 }),
    });
    expect(executed).toEqual(['smb_report']);
    expect(resultOf(r.bodies[1], 'toolu_1')).toMatch(/^smb_report ran/);
  });

  it('6. pause inside a skill tool, then resume: same system and tools, decided once, recorded once', async () => {
    const r = await run({
      script: [READ, { tool: 'smb_report', input: {} }, DONE],
      build: (a) => a.skill(smb({ pause: true })).thinking({ budget: 1500 }),
    });
    expect(isPaused(r.answer as never)).toBe(true);
    const resumed = await r.agent.resume((r.answer as { checkpoint: never }).checkpoint, 'finance');
    expect(isPaused(resumed as never)).toBe(false);
    expect(r.bodies).toHaveLength(3);
    expect(prefixHeld(r.bodies)).toBe(true);
    expect(r.starts.filter((s) => s.skillContext !== undefined)).toHaveLength(1);
  });

  it('7. a fallback pair with an unbound primary keeps declared (the primary answers): no record, scoped tool held', async () => {
    const r = await run({
      script: [DONE],
      wrap: (bound) => withFallback(mock({ replies: ['done'] }), bound),
      build: (a) => a.skill(smb()),
    });
    expect(r.starts[0]!.skillContext).toBeUndefined();
    expect((r.starts[0]!.tools as { name: string }[]).map((t) => t.name)).not.toContain(
      'smb_report',
    );
  });

  it('7b. a fallback pair with a bound primary is listed', async () => {
    const r = await run({
      script: [DONE],
      wrap: (bound) => withFallback(bound, mock({ replies: ['done'] })),
      build: (a) => a.skill(smb()),
    });
    expect((r.starts[0]!.skillContext as { tools: { strategy: string } }).tools.strategy).toBe(
      'listed',
    );
    expect(toolNames(r.bodies[0])).toContain('smb_report');
  });

  it('9. a bound model with no skill: no decision, no record', async () => {
    const r = await run({ script: [DONE], build: (a) => a });
    expect(r.starts[0]!.skillContext).toBeUndefined();
  });

  it('10. the app states declared on a bound model: today’s requests, recorded as fixed by the app', async () => {
    const r = await run({
      script: [DONE],
      build: (a) => a.skill(smb()),
      options: { skillContext: 'declared' },
    });
    expect(toolNames(r.bodies[0])).toEqual(['lookup', 'read_skill']);
    expect((r.starts[0]!.skillContext as { tools: unknown }).tools).toEqual(
      fixedRecord('declared', undefined, 'app'),
    );
    // The body table took its default, so no measurement chose the channel.
    const body = (r.starts[0]!.skillContext as { body: Record<string, unknown> }).body;
    expect(body.by).toBe('default');
    expect(body.measurement).toBeUndefined();
  });

  it('11. the app states listed on an unbound model: listed, recorded as fixed by the app', async () => {
    const r = await run({
      model: UNBOUND,
      script: [{ ...READ, thinking: false }, DONE],
      build: (a) => a.skill(smb()),
      options: { skillContext: 'listed' },
    });
    expect(toolNames(r.bodies[0])).toContain('smb_report');
    expect(resultOf(r.bodies[1], 'toolu_1')).toBe(BODY);
    expect((r.starts[0]!.skillContext as { tools: unknown }).tools).toEqual(
      fixedRecord('listed', undefined, 'app'),
    );
  });
});

describe('8. byte identity: a model that does not bind its reasoning', () => {
  it('the default is declared: no record, scoped tools held, and the request bytes equal a stated declared run', async () => {
    const script = [{ ...READ, thinking: false }, DONE];
    const absent = await run({ model: UNBOUND, script, build: (a) => a.skill(smb()) });
    const stated = await run({
      model: UNBOUND,
      script,
      build: (a) => a.skill(smb()),
      options: { skillContext: 'declared' },
    });
    expect(absent.bodies).toEqual(stated.bodies);
    expect(absent.starts.every((s) => s.skillContext === undefined)).toBe(true);
    expect(toolNames(absent.bodies[0])).toEqual(['lookup', 'read_skill']);
    expect(toolNames(absent.bodies[1])).toEqual(['lookup', 'read_skill', 'smb_report']);
    expect(JSON.stringify(absent.bodies[1]!.system)).toContain('SMB TRIAGE');
  });

  it('a provider that declares no binding (mock) records nothing', async () => {
    const agent = Agent.create({ provider: mock({ replies: ['done'] }), model: 'mock' })
      .skill(smb())
      .build();
    const starts: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload as never));
    await agent.run({ message: 'hi' });
    expect(starts[0]!.skillContext).toBeUndefined();
  });
});

describe('the recorded decision', () => {
  it('equals decisionRecord(evidence) recomputed from the tables, bound and unknown', async () => {
    for (const [model, binding] of [
      [BOUND, 'bound'],
      ['claude-opus-6', 'unknown'],
    ] as const) {
      const r = await run({ model, script: [DONE], build: (a) => a.skill(smb()) });
      const record = r.starts[0]!.skillContext as Record<string, unknown>;
      const tools = decisionRecord(
        decideFromFacts(SKILL_TOOL_TABLE.rules, { binding }, SKILL_TOOL_TABLE.default).evidence,
      );
      const body = decisionRecord(
        decideFromFacts(SKILL_BODY_TABLE.rules, { tools: 'listed' }, SKILL_BODY_TABLE.default)
          .evidence,
      );
      expect(record.tools).toEqual(tools);
      expect(record.body).toEqual({
        ...body,
        measurement: {
          script: 'skill-body-measure-20261125/measure.mjs',
          run: '2026-11-25T22-14-20-690Z',
        },
      });
      expect(record.binding).toEqual({ binding, by: 'provider', provider: 'anthropic', model });
      expect(r.starts.slice(1).every((s) => s.skillContext === undefined)).toBe(true);
    }
  });

  it('a value other than the two strategies is refused at build', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: ['x'] }),
        model: 'mock',
        skillContext: 'announce' as never,
      })
        .skill(smb())
        .build(),
    ).toThrow(/skillContext must be 'listed' or 'declared'/);
  });
});

describe('the body is the app’s own text', () => {
  it('is exempt from maxToolResultChars; an ordinary tool result is still cut', async () => {
    const r = await run({
      script: [{ tool: 'lookup', input: {} }, READ, DONE],
      build: (a) => a.skill(smb()).thinking({ budget: 1500 }),
      options: { maxToolResultChars: 40 },
    });
    expect(r.error).toBeUndefined();
    expect(resultOf(r.bodies[2], 'toolu_2')).toBe(BODY);
    expect(resultOf(r.bodies[2], 'toolu_1')).not.toBe(`lookup ran: ${'x'.repeat(60)}`);
  });
});

describe('12. role-hidden skills under listed (security)', () => {
  // `vault` is hidden from the guest role; `share_lookup` is shared by `vault` and the visible `smb-triage`.
  const shared = tool('share_lookup');
  let revoked = false;
  const revoke = defineTool<Record<string, never>, string>({
    name: 'revoke',
    description: 'Revoke a role.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      revoked = true;
      return 'revoked';
    },
  });
  const roles = (hiddenFor: (principal: string | undefined, iteration?: number) => boolean) => ({
    name: 'role-checker',
    governs: ['skill_read' as const],
    check: (request: {
      capability: string;
      target?: string;
      identity?: { principal?: string };
      iteration?: number;
    }) => ({
      result:
        request.capability === 'skill_read' &&
        request.target === 'skill:vault' &&
        hiddenFor(request.identity?.principal, request.iteration)
          ? ('deny' as const)
          : ('allow' as const),
    }),
  });
  const vault = () =>
    defineSkill({
      id: 'vault',
      description: 'Vault operations.',
      body: 'VAULT PROCEDURE.',
      tools: [tool('vault_wipe'), shared],
      autoActivate: 'currentSkill',
    });
  const triage = () =>
    defineSkill({
      id: 'smb-triage',
      description: 'Diagnose slow SMB shares.',
      body: BODY,
      tools: [tool('smb_report'), shared],
      autoActivate: 'currentSkill',
    });

  function agentFor(
    bodies: Body[],
    script: readonly Step[],
    checker: ReturnType<typeof roles>,
    skillContext?: 'declared',
  ) {
    const provider = anthropic({ _client: scriptedClient(BOUND, bodies, script) as never });
    const agent = Agent.create({
      provider,
      model: BOUND,
      maxIterations: 6,
      permissionChecker: checker as never,
      ...(skillContext !== undefined && { skillContext }),
    })
      .system('You diagnose file-share problems.')
      .tool(revoke)
      .skill(triage())
      .skill(vault())
      .thinking({ budget: 1500 })
      .build();
    const starts: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload as never));
    const ask = (principal: string) =>
      agent
        .run({
          message: 'Why is the finance share slow?',
          identity: { principal, conversationId: principal },
        })
        .catch((e: unknown) => e);
    return { agent, starts, ask };
  }

  it('a hidden skill: its tools and its name are absent from every request; a shared tool stays, saying nothing of it', async () => {
    executed = [];
    const bodies: Body[] = [];
    const { starts, ask } = agentFor(
      bodies,
      [READ, DONE],
      roles((p) => p === 'guest'),
    );
    const answer = await ask('guest');
    expect(answer).not.toBeInstanceOf(Error);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(toolNames(body)).toEqual(['read_skill', 'revoke', 'share_lookup', 'smb_report']);
      expect(JSON.stringify(body).toLowerCase()).not.toContain('vault');
    }
    expect(bodies[0]!.tools!.find((t) => t.name === 'share_lookup')!.description).toBe(
      'The share_lookup tool.',
    );
    expect(JSON.stringify(starts).toLowerCase()).not.toContain('vault');
    expect(prefixHeld(bodies)).toBe(true);
  });

  it('a direct call to the hidden skill’s tool: refused, the tool does not run, the skill is not named', async () => {
    const results: Record<string, { result?: string; ran: string[] }> = {};
    for (const mode of ['listed', 'declared'] as const) {
      executed = [];
      const bodies: Body[] = [];
      const { ask } = agentFor(
        bodies,
        [{ tool: 'vault_wipe', input: {} }, DONE],
        roles((p) => p === 'guest'),
        mode === 'declared' ? 'declared' : undefined,
      );
      await ask('guest');
      results[mode] = { result: resultOf(bodies[1], 'toolu_1'), ran: [...executed] };
    }
    expect(results.listed!.ran).toEqual([]);
    expect(results.listed!.result).toBe(
      "Tool 'vault_wipe' did not run: the skill it belongs to was not loaded on that call.",
    );
    expect(results.listed!.result!.toLowerCase()).not.toContain("'vault'");
    expect(results.declared).toEqual(results.listed);
  });

  it('two roles on one agent: each run lists what its own role may see', async () => {
    const bodies: Body[] = [];
    const { ask } = agentFor(
      bodies,
      [DONE],
      roles((p) => p === 'guest'),
    );
    await ask('admin');
    await ask('guest');
    expect(toolNames(bodies[0])).toContain('vault_wipe');
    expect(toolNames(bodies[1])).not.toContain('vault_wipe');
    expect(JSON.stringify(bodies[1]).toLowerCase()).not.toContain('vault');
  });

  it('a role change between turns re-lists on the next turn; inside a signed turn it is the named refusal', async () => {
    revoked = false;
    const bodies: Body[] = [];
    const { ask } = agentFor(
      bodies,
      [DONE],
      roles(() => revoked),
    );
    await ask('admin');
    revoked = true;
    await ask('admin');
    expect(toolNames(bodies[0])).toContain('vault_wipe');
    expect(toolNames(bodies[1])).not.toContain('vault_wipe');

    // Revoked between request 1 and request 2 of ONE signed tool turn (by the `revoke` tool): the list
    // would change under the signed reasoning, so slice 1's check refuses it by name.
    revoked = false;
    const inTurn: Body[] = [];
    const flip = agentFor(
      inTurn,
      [{ tool: 'revoke', input: {} }, DONE],
      roles(() => revoked),
    );
    const error = await flip.ask('admin');
    expect(error).toBeInstanceOf(ContextChangedError);
    expect((error as Error).message).toMatch(/tool 'vault_wipe' was removed/);
    expect(inTurn).toHaveLength(1);
  });
});
