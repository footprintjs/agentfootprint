/**
 * Under `listed` a body is never lost and never doubled, a graph pick keeps the
 * context, and a hidden skill's tools never run (the review of the first two
 * commits: P1-1, P2-1, P2-3, and the uncaught mutations R1, R5, R9).
 *
 * The rule under test: the system prompt leaves a body out exactly while its
 * `read_skill` result is in the history the request sends; a window never
 * drops that result while its skill is active; with no such result the body
 * is served as under `declared`.
 *
 * Oracle: the scripted client's request bodies, and slice 1's independent
 * prefix comparator (`harness.ts`).
 *
 * Test type: integration / regression.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  pauseHere,
  slidingWindow,
  type WindowStrategy,
} from '../../../src/index.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { ContextChangedError } from '../../../src/providers.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';
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
const ALIAS = 'my-gateway-alias'; // an id the adapter cannot place: `unknown`, so `listed` by default
const BODY = 'SMB TRIAGE: check the share report first. The latency threshold is 4711 ms.';

let executed: string[] = [];
const tool = (name: string, opts: { pause?: boolean; result?: string } = {}) =>
  defineTool<Record<string, unknown>, string>({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      executed.push(name);
      if (opts.pause === true && executed.filter((n) => n === name).length === 1)
        pauseHere({ question: 'Which share?' });
      return opts.result ?? `${name} ran`;
    },
  });
const smb = (opts: { body?: string; pause?: boolean; surfaceMode?: 'tool-only' } = {}) =>
  defineSkill({
    id: 'smb-triage',
    description: 'Diagnose slow SMB shares.',
    body: opts.body ?? BODY,
    tools: [tool('smb_report', { pause: opts.pause === true })],
    autoActivate: 'currentSkill',
    ...(opts.surfaceMode !== undefined && { surfaceMode: opts.surfaceMode }),
  });
const READ: Step = { tool: 'read_skill', input: { id: 'smb-triage' } };
const DONE: Step = { text: 'The finance share is slow.' };
const unsigned = (steps: readonly Step[]) => steps.map((s) => ({ ...s, thinking: false }));

type Builder = ReturnType<typeof Agent.create>;
function agentOn(
  model: string,
  bodies: Body[],
  script: readonly Step[],
  build: (a: Builder) => Builder,
  options: Record<string, unknown> = {},
) {
  const provider = anthropic({ _client: scriptedClient(model, bodies, script) as never });
  return build(
    Agent.create({ provider, model, maxIterations: 9, ...options })
      .system('You diagnose file-share problems.')
      .tool(tool('t1'))
      .tool(tool('t2'))
      .tool(tool('t3')),
  ).build();
}
async function settle(run: Promise<unknown>) {
  try {
    return { answer: await run, error: undefined as unknown };
  } catch (error) {
    return { answer: undefined, error };
  }
}
/** How many times the body's text is in one request: the system prompt and every message. */
const copies = (b: Body) => JSON.stringify(b).split('4711 ms').length - 1;
const resultOf = (b: Body | undefined, id: string): string | undefined => {
  for (const m of b?.messages ?? []) {
    if (typeof m.content === 'string') continue;
    for (const block of m.content as Block[])
      if (block.type === 'tool_result' && block.tool_use_id === id)
        return typeof block.content === 'string'
          ? block.content
          : (block.content as Block[]).map((x) => String(x.text ?? '')).join('');
  }
  return undefined;
};
const prefixHeld = (bodies: readonly Body[]) =>
  bodies.slice(1).every((b, i) => unchanged(prefixDiff(bodies[i]!, b)));

const LONG = [
  READ,
  { tool: 't1', input: {} },
  { tool: 't2', input: {} },
  { tool: 't3', input: {} },
  { tool: 'smb_report', input: {} },
  DONE,
] as const;

describe('P1-1: a loaded body is never lost', () => {
  it('a sliding window keeps the read_skill result of an active skill (unknown id and stated listed)', async () => {
    for (const [model, options] of [
      [ALIAS, {}],
      [UNBOUND, { skillContext: 'listed' }],
    ] as const) {
      executed = [];
      const bodies: Body[] = [];
      const agent = agentOn(
        model,
        bodies,
        unsigned(LONG),
        (a) =>
          (a.skill(smb()) as Builder & { window: (w: unknown) => Builder }).window(
            slidingWindow({ keepRecentTurns: 1 }),
          ),
        options,
      );
      const { error } = await settle(agent.run({ message: 'go' }));
      expect(error, model).toBeUndefined();
      expect(bodies).toHaveLength(6);
      expect(bodies.slice(1).map(copies), model).toEqual([1, 1, 1, 1, 1]);
      // …and it stays the read_skill RESULT: the window kept it, so it never moved to the system prompt.
      for (const body of bodies) expect(JSON.stringify(body.system), model).not.toContain('4711');
      expect(executed).toContain('smb_report');
    }
  });

  it('on a bound model the same window drops OTHER turns inside the signed turn: slice 1 refuses by messages, never by the skill', async () => {
    executed = [];
    const bodies: Body[] = [];
    const agent = agentOn(BOUND, bodies, LONG, (a) =>
      (
        a.skill(smb()).thinking({ budget: 1500 }) as Builder & { window: (w: unknown) => Builder }
      ).window(slidingWindow({ keepRecentTurns: 1 })),
    );
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeInstanceOf(ContextChangedError);
    // Only messages changed: the body, the system prompt and the tool list did not.
    const changes = (error as ContextChangedError).changes;
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.slot === 'messages')).toBe(true);
    // Every request that was sent kept the body, once.
    expect(
      bodies
        .slice(1)
        .map(copies)
        .every((n) => n === 1),
    ).toBe(true);
  });

  it('every request of a long turn carries the body exactly once (no window)', async () => {
    const bodies: Body[] = [];
    const agent = agentOn(BOUND, bodies, LONG, (a) => a.skill(smb()).thinking({ budget: 1500 }));
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeUndefined();
    expect(bodies.map(copies)).toEqual([0, 1, 1, 1, 1, 1]);
    expect(prefixHeld(bodies)).toBe(true);
  });

  it('paused under declared, resumed under listed: the body stays in the system prompt, unchanged', async () => {
    executed = [];
    const bodies: Body[] = [];
    const script = unsigned([
      READ,
      { tool: 'smb_report', input: {} },
      { tool: 't1', input: {} },
      DONE,
    ]);
    const shared = scriptedClient(ALIAS, bodies, script);
    const make = (options: Record<string, unknown>) =>
      Agent.create({
        provider: anthropic({ _client: shared as never }),
        model: ALIAS,
        maxIterations: 8,
        ...options,
      })
        .system('You diagnose file-share problems.')
        .tool(tool('t1'))
        .skill(smb({ pause: true }))
        .build();
    const before = make({ skillContext: 'declared' });
    const first = await before.run({ message: 'go' });
    expect(isPaused(first as never)).toBe(true);
    const paused = bodies.length;
    const after = make({}); // the upgraded agent: `listed` by default on this id
    const { error } = await settle(
      after.resume((first as { checkpoint: never }).checkpoint, 'finance'),
    );
    expect(error).toBeUndefined();
    expect(bodies.length).toBeGreaterThan(paused);
    // The history holds the old confirmation, never the body: it stays in the system prompt.
    for (const body of bodies.slice(1)) expect(copies(body)).toBe(1);
    for (const body of bodies.slice(paused))
      expect(body.system).toEqual(bodies[paused - 1]!.system);
    expect(executed).toContain('t1'); // the resumed turn went on to its next call
  });

  /** A memory or compaction step that REWRITES history: the body result becomes a short note. */
  const rewriting: WindowStrategy = {
    name: 'rewrite-skill-results',
    async plan(input) {
      if (input.iteration !== 3) return undefined;
      const at = input.history.findIndex(
        (m: LLMMessage) => m.role === 'tool' && m.content.includes('4711'),
      );
      if (at < 0) return undefined;
      const folded: LLMMessage = { ...input.history[at]!, content: 'skill loaded' };
      return {
        window: [...input.history.slice(0, at), folded, ...input.history.slice(at + 1)],
        // A one-message fold: the head before it, the new message, the tail after it.
        rebase: { headCount: at, keptTailCount: input.history.length - at - 1, insertedAtMs: 1 },
        record: {
          strategy: 'rewrite-skill-results',
          iteration: input.iteration,
          removedStageIds: [],
          removedMessageCount: 1,
          windowCharsBefore: 0,
          windowCharsAfter: 0,
          refusals: [],
        },
        evictions: [],
      };
    },
  };

  it('a history rewrite that removes the body result: the body is served in the system prompt, as under declared', async () => {
    const bodies: Body[] = [];
    const agent = agentOn(ALIAS, bodies, unsigned(LONG), (a) =>
      (a.skill(smb()) as Builder & { window: (w: unknown) => Builder }).window(rewriting),
    );
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeUndefined();
    expect(bodies.map(copies)).toEqual([0, 1, 1, 1, 1, 1]);
    expect(JSON.stringify(bodies[1]!.system)).not.toContain('4711');
    expect(JSON.stringify(bodies[3]!.system)).toContain('4711');
  });

  it('the same rewrite inside a signed turn on a bound model: refused by name before sending', async () => {
    const bodies: Body[] = [];
    const agent = agentOn(BOUND, bodies, LONG, (a) =>
      (
        a.skill(smb()).thinking({ budget: 1500 }) as Builder & { window: (w: unknown) => Builder }
      ).window(rewriting),
    );
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeInstanceOf(ContextChangedError);
    expect((error as Error).message).toMatch(/skill 'smb-triage' was added to the system prompt/);
    expect(bodies).toHaveLength(2); // the changed request was never sent
  });
});

describe('P2-3: a read_skill pick of a graph target keeps the context', () => {
  const s = (id: string) =>
    defineSkill({
      id,
      description: `${id} does things`,
      body: `${id}_BODY`,
      tools: [tool(`${id}_tool`)],
    });
  for (const form of ['route', 'steps'] as const) {
    it(`${form}: the target's body is the result; the system prompt does not change`, async () => {
      executed = [];
      const a = s('a');
      const b = s('b');
      const graph =
        form === 'route'
          ? skillGraph()
              .entry(a)
              .route(a, b, { onToolReturn: 'a_tool' })
              .build({ check: 'off' } as never)
          : skillGraph({
              skills: [a, b],
              start: 'a',
              steps: [{ from: 'a', to: 'b', onToolReturn: 'a_tool' }],
              check: 'off',
            });
      const bodies: Body[] = [];
      const agent = agentOn(
        BOUND,
        bodies,
        [
          { tool: 't1', input: {} },
          { tool: 'read_skill', input: { id: 'b' } },
          { tool: 'b_tool', input: {} },
          DONE,
        ],
        (x) => x.skillGraph(graph).thinking({ budget: 1500 }),
      );
      const { error } = await settle(agent.run({ message: 'go' }));
      expect(error).toBeUndefined();
      expect(resultOf(bodies[2], 'toolu_2')).toBe('b_BODY');
      expect(JSON.stringify(bodies.map((x) => x.system))).not.toContain('b_BODY');
      expect(prefixHeld(bodies)).toBe(true);
      expect(executed).toContain('b_tool');
    });
  }
});

describe('P2-1: a tool every declaring skill of which is hidden never runs under listed', () => {
  const hideVault = {
    name: 'role-checker',
    governs: ['skill_read' as const],
    check: (request: { capability: string; target?: string }) => ({
      result:
        request.capability === 'skill_read' && request.target === 'skill:vault'
          ? ('deny' as const)
          : ('allow' as const),
    }),
  };
  const vault = () =>
    defineSkill({
      id: 'vault',
      description: 'Vault operations.',
      body: 'VAULT PROCEDURE.',
      tools: [tool('wipe_all')],
    });

  it('an UNSCOPED tool of a hidden skill, called by name: refused, not run, the skill named nowhere', async () => {
    executed = [];
    const bodies: Body[] = [];
    const agent = agentOn(
      BOUND,
      bodies,
      [{ tool: 'wipe_all', input: {} }, DONE],
      (a) => a.skill(smb()).skill(vault()),
      {
        permissionChecker: hideVault,
      },
    );
    const events: unknown[] = [];
    agent.on('*' as never, (e: { payload: unknown }) => events.push(e.payload));
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeUndefined();
    expect(executed).toEqual([]);
    expect(resultOf(bodies[1], 'toolu_1')).toMatch(/^Unknown tool 'wipe_all' on that call\./);
    expect(JSON.stringify(bodies).toLowerCase()).not.toContain('vault');
    expect(JSON.stringify(events).toLowerCase()).not.toContain('vault');
  });

  it('under declared, a hidden skill’s unscoped tool is omitted from the request', async () => {
    const bodies: Body[] = [];
    const agent = agentOn(BOUND, bodies, [DONE], (a) => a.skill(smb()).skill(vault()), {
      permissionChecker: hideVault,
      skillContext: 'declared',
    });
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeUndefined();
    expect(bodies).toHaveLength(1);
    expect((bodies[0]!.tools ?? []).map((t) => t.name)).not.toContain('wipe_all');
    expect(JSON.stringify(bodies[0]).toLowerCase()).not.toContain('vault');
  });
});

describe('the review’s uncaught mutations', () => {
  it('R1: a tool scoped in one skill and unscoped in another runs before either is loaded', async () => {
    executed = [];
    const shared = tool('share_lookup');
    const scoped = defineSkill({
      id: 'a',
      description: 'A.',
      body: 'A body.',
      tools: [shared],
      autoActivate: 'currentSkill',
    });
    const open = defineSkill({ id: 'b', description: 'B.', body: 'B body.', tools: [shared] });
    const bodies: Body[] = [];
    const agent = agentOn(BOUND, bodies, [{ tool: 'share_lookup', input: {} }, DONE], (a) =>
      a.skill(scoped).skill(open),
    );
    await settle(agent.run({ message: 'go' }));
    expect(executed).toEqual(['share_lookup']);
  });

  it('R5: under listed a body is never placed by reference; under declared a tool-only body is', async () => {
    const big = `${'B'.repeat(3000)} 4711 ms`;
    const placedUnder = async (mode: 'listed' | 'declared') => {
      const bodies: Body[] = [];
      const agent = agentOn(
        UNBOUND,
        bodies,
        unsigned([READ, DONE]),
        (a) =>
          a.skill(
            smb({ body: big, ...(mode === 'declared' && { surfaceMode: 'tool-only' as const }) }),
          ),
        {
          skillContext: mode,
          artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 500 } },
        },
      );
      await settle(agent.run({ message: 'go' }));
      return resultOf(bodies[1], 'toolu_1') ?? '';
    };
    expect(await placedUnder('listed')).toBe(big);
    expect(await placedUnder('declared')).not.toBe(big);
  });
});

describe('P1-2: a re-read never adds a copy, and the window keeps only the newest', () => {
  const windowed = (a: Builder) =>
    (a as Builder & { window: (w: unknown) => Builder }).window(
      slidingWindow({ keepRecentTurns: 1 }),
    );
  const rereads = (n: number, id = 'smb-triage') => {
    const steps: Step[] = [];
    for (let i = 0; i < n; i++)
      steps.push({ tool: 'read_skill', input: { id } }, { tool: 't1', input: {} });
    return [...steps, DONE];
  };
  const results = (b: Body) =>
    b.messages.flatMap((m) =>
      typeof m.content === 'string'
        ? []
        : (m.content as Block[])
            .filter((x) => x.type === 'tool_result')
            .map((x) => JSON.stringify(x.content)),
    );

  it('ten re-reads in one turn under a window: bounded requests, the body once in each (as written)', async () => {
    const bodies: Body[] = [];
    const agent = agentOn(ALIAS, bodies, unsigned(rereads(10)), (a) => windowed(a.skill(smb())), {
      maxIterations: 30,
    });
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeUndefined();
    expect(bodies).toHaveLength(21);
    // "each request carries the body once"
    expect(bodies.slice(1).every((b) => copies(b) === 1)).toBe(true);
    // Bounded: the window keeps dropping old turns. One turn more than on main (6), the pinned
    // read that carries the body where main's system prompt does; the size stops growing.
    const sizes = bodies.map((b) => b.messages.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(7);
    expect(new Set(sizes.slice(6)).size).toBe(1);
    // Every re-read after the first answered the confirmation.
    const last = results(bodies.at(-1)!).join(' ');
    expect(last).toContain("Skill 'smb-triage' activated for the next iteration.");
  });

  it('on a bound model ten re-reads in a signed turn change no context: one body, the prefix holds', async () => {
    const bodies: Body[] = [];
    const agent = agentOn(
      BOUND,
      bodies,
      rereads(10),
      (a) => a.skill(smb()).thinking({ budget: 1500 }),
      {
        maxIterations: 30,
      },
    );
    const { error } = await settle(agent.run({ message: 'go' }));
    expect(error).toBeUndefined();
    expect(bodies.slice(1).every((b) => copies(b) === 1)).toBe(true);
    expect(prefixHeld(bodies)).toBe(true);
  });

  it('two skills re-read alternately: each body once in each request', async () => {
    const nfs = defineSkill({
      id: 'nfs',
      description: 'NFS.',
      body: 'NFS PROCEDURE 9090 ms.',
      tools: [tool('nfs_report')],
      autoActivate: 'currentSkill',
    });
    const script: Step[] = [];
    for (let i = 0; i < 3; i++)
      script.push(
        { tool: 'read_skill', input: { id: 'smb-triage' } },
        { tool: 'read_skill', input: { id: 'nfs' } },
      );
    script.push(DONE);
    for (const [model, build, steps] of [
      [ALIAS, (a: Builder) => windowed(a.skill(smb()).skill(nfs)), unsigned(script)],
      [BOUND, (a: Builder) => a.skill(smb()).skill(nfs).thinking({ budget: 1500 }), script],
    ] as const) {
      const bodies: Body[] = [];
      const agent = agentOn(model, bodies, steps, build);
      const { error } = await settle(agent.run({ message: 'go' }));
      expect(error, model).toBeUndefined();
      for (const b of bodies.slice(2)) {
        expect(copies(b), model).toBe(1);
        expect(JSON.stringify(b).split('9090 ms').length - 1, model).toBe(1);
      }
      if (model === BOUND) expect(prefixHeld(bodies)).toBe(true);
    }
  });

  it('a re-read on the next turn, after the window dropped the old result: the body comes back once, as the result', async () => {
    const bodies: Body[] = [];
    const script = unsigned([
      READ,
      { tool: 't1', input: {} },
      DONE,
      READ,
      { tool: 't1', input: {} },
      DONE,
    ]);
    const agent = agentOn(ALIAS, bodies, script, (a) => windowed(a.skill(smb())));
    await settle(agent.run({ message: 'first question' }));
    const { error } = await settle(
      (agent as unknown as { followUp: (m: string) => Promise<unknown> }).followUp(
        'second question',
      ),
    );
    expect(error).toBeUndefined();
    const second = bodies.slice(3);
    expect(second.length).toBeGreaterThan(1);
    // The old copy left with its turn (the skill was not active yet on this turn), so the
    // re-read is the body again, and every later request carries it once.
    expect(resultOf(second[1], 'toolu_4')).toBe(BODY);
    for (const b of second.slice(1)) expect(copies(b)).toBe(1);
  });
});
