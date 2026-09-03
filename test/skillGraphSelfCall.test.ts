/**
 * `read_skill` on the skill you are ALREADY IN (9.84.0).
 *
 * A routed turn puts the cursor on X, and the model — with no sentence anywhere
 * telling it so — called `read_skill("X")` to find out where it stood. The gate
 * answered:
 *
 *     read_skill("X") is not reachable from here. Reachable skills: …
 *
 * while X's body was in that call's system prompt and X's tools were in that
 * call's tool list. The cursor is in neither half of `hops ∪ open` by
 * construction: `makeReachableSkills` filters it out of its own successor set
 * and `openSkillIds()` excludes every graph-wired skill. Read as a claim about
 * AVAILABILITY — which is how a model reads "not reachable" — it says the exact
 * opposite of the request it arrived in, and the observed behaviour was to stop
 * and answer that it could not help. Three production failures in one day.
 *
 * Three things had to change together, and the tests below are grouped by them:
 *   (a) the GATE answers a self-call with the truth, naming the tools that were
 *       genuinely on THAT call's wire — never the ones merely declared;
 *   (b) the DESCRIPTION stops listing the current skill under "Not reachable
 *       from here", where it only ever appeared as an artefact of (a)'s filter;
 *   (c) the description NAMES the current skill on every call that has one, so
 *       a decisively-routed turn (which has no menu) is not left guessing.
 *
 * ── WHY THE TEST DESIGN IS PART OF THE FIX ────────────────────────────────
 *
 * Two earlier rounds shipped tests that PASSED while the bug was live, because
 * each drove exactly one configuration — and `maxIterations: 2` is the single
 * budget at which the out-of-budget clause hides the stale one. A tool result
 * is re-read on every later call of the turn, so a single-cell test proves
 * nothing about the cell next to it.
 *
 * So §7 is a MATRIX — every budget from 2 to 5 crossed with every posture —
 * and it asserts over the LAST request each notice appears in, not the first.
 * §8 drives a sibling tool that moves the cursor inside the very batch the
 * notice is composed in, and §10 drives the posture arm that refuses the move
 * the notice used to offer.
 *
 * ── AND WHY THE CHECKER MOVED OUT OF THIS FILE (round 4) ──────────────────
 *
 * Round 3 wrote that checker HERE and pointed it at tool results. It worked:
 * all twelve matrix cells came out clean. Then the identical banned sentence —
 * "read_skill MOVES you to a DIFFERENT skill" — was written forty lines away
 * into the `read_skill` DESCRIPTION, which this file did not check, and
 * shipped. A checker whose scope is decided by which suite imports it is a
 * habit, not a guarantee.
 *
 * So the list is now `test/helpers/modelFacingClaims.ts`, shared with
 * `test/security/skill-visibility.test.ts`, and every model-facing string this
 * release touches goes through it: the notice (§1, §7, §8, §10) AND the
 * description's cursor lead and reachable/unreachable lists (§2, §7, §10).
 * Where a clause is legitimately provable on one surface and not the other —
 * present tense about the cursor is a fact in a per-call description and a
 * forecast in a tool result — the helper states the exemption and its reason;
 * it is not decided by the call site.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../src/index.js';
import { defineSkill, skillGraph, buildReadSkillTool } from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import { PermissionPolicy } from '../src/security/PermissionPolicy.js';
import { selfCallNotice, selfSkillTools } from '../src/core/agent/selfCallNotice.js';
import {
  unprovable as unprovableOn,
  foreignIds,
  TOOL_RESULT,
  GRAPH_TOOL_DESCRIPTION,
} from './helpers/modelFacingClaims.js';

const t = (name: string) =>
  defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

const skill = (id: string, over: Record<string, unknown> = {}) =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id.toUpperCase()}_BODY`,
    tools: [t(`${id}_tool`)],
    ...over,
  } as never);

type Turn = { content: string; toolCalls: Array<{ id: string; name: string; args: unknown }> };

/** The opening words of the notice — the one string every test recognises it by. */
const NOTICE = 'named the skill you were already standing in';

/**
 * The banned-sentence checker, bound to the TOOL-RESULT surface — a channel
 * whose lifetime is `'persistent-history'`, which is the half the rows judge.
 *
 * The list itself lives in `test/helpers/modelFacingClaims.ts`, shared with
 * every other suite that reads a model-facing string, because round 3 kept it
 * here and the sentence it bans simply moved to a surface this file could not
 * see. `unprovableDescription` below is the same list bound to the other
 * surface — same rows, one place, the difference stated in the helper.
 */
const unprovable = (notice: string): string[] => unprovableOn(notice, TOOL_RESULT);

/** The same list, bound to the `read_skill` DESCRIPTION composed from an offer
 *  — `'request-ephemeral'`, and the helper carries the evidence for that. */
const unprovableDescription = (description: string): string[] =>
  unprovableOn(description, GRAPH_TOOL_DESCRIPTION);

/** The tool names the notice claims rode the call it is about. */
function namedTools(notice: string): string[] {
  return /tools were on that call's tool list: ([^.]+)\./.exec(notice)?.[1]?.split(', ') ?? [];
}

/** Run an agent over a scripted model, capturing everything the model saw. */
async function drive(
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  script: readonly Turn[],
  opts: { reactMode?: 'classic' | 'dynamic' | 'dynamic-grouped' } = {},
) {
  const toolResults: string[] = [];
  const descriptions: string[] = [];
  const wire: string[][] = [];
  const rejected: Array<Record<string, unknown>> = [];
  let i = 0;
  const provider = mock({
    respond: (req: {
      messages?: ReadonlyArray<{ role: string; content: string }>;
      tools?: ReadonlyArray<{ name: string; description: string }>;
    }) => {
      for (const m of req.messages ?? []) if (m.role === 'tool') toolResults.push(m.content);
      wire.push((req.tools ?? []).map((x) => x.name));
      descriptions.push((req.tools ?? []).find((x) => x.name === 'read_skill')?.description ?? '');
      return script[i++] ?? { content: 'done', toolCalls: [] };
    },
  });
  const agent = build(Agent.create({ provider, model: 'mock', maxIterations: 6, ...opts }))
    .watch({
      id: 'w',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.skill.rejected') rejected.push(e.payload ?? {});
      },
    })
    .build();
  const answer = await agent.run({ message: 'go' });
  return { toolResults, descriptions, wire, rejected, answer };
}

const readSkill = (id: string, callId = 'c1'): Turn => ({
  content: '',
  toolCalls: [{ id: callId, name: 'read_skill', args: { id } }],
});
const callTool = (name: string, callId = 'c2'): Turn => ({
  content: '',
  toolCalls: [{ id: callId, name, args: {} }],
});

/** alpha → beta, plus a loose gamma the graph wires no edge into. */
const graph = () =>
  skillGraph({
    skills: [skill('alpha'), skill('beta'), skill('gamma')],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

// ─── 1. UNIT — the notice cannot claim a tool it did not see ─────

describe('selfSkillTools — what is provably on this call', () => {
  const active = [
    {
      id: 'alpha',
      flavor: 'skill' as const,
      inject: { tools: [{ schema: { name: 'alpha_tool' }, injectionId: 'alpha' }] },
    },
  ] as never;

  it('intersects the declaration with the WIRE, not with itself', () => {
    expect(selfSkillTools('alpha', active, [{ name: 'alpha_tool' }] as never)).toEqual({
      declared: ['alpha_tool'],
      served: ['alpha_tool'],
    });
  });

  it('a declared tool that is NOT on the wire is declared-but-not-served', () => {
    // What a step hold-out or a park hold-out produces. The distinction is the
    // whole reason `declared` is carried beside `served`.
    expect(selfSkillTools('alpha', active, [{ name: 'read_skill' }] as never)).toEqual({
      declared: ['alpha_tool'],
      served: [],
    });
  });

  it('a skill that declares no tools reports none — not "unknown"', () => {
    const bare = [{ id: 'solo', flavor: 'skill', inject: {} }] as never;
    expect(selfSkillTools('solo', bare, [] as never)).toEqual({ declared: [], served: [] });
  });

  it('is UNDEFINED when the wire is unknown, or the skill is not active', () => {
    // `reactMode: 'classic'` caches the tools slot, a wrap-up withholds the whole
    // list. Undefined is a third answer and the notice must not round it to "none".
    expect(selfSkillTools('alpha', active, undefined)).toBeUndefined();
    expect(selfSkillTools('alpha', undefined, [] as never)).toBeUndefined();
    expect(selfSkillTools('missing', active, [] as never)).toBeUndefined();
  });
});

describe('selfCallNotice — every clause is a finished fact', () => {
  const notice = (
    tools: Parameters<typeof selfCallNotice>[0]['tools'],
    over: Partial<Parameters<typeof selfCallNotice>[0]> = {},
  ) => selfCallNotice({ skillId: 'alpha', tools, ...over });

  it('states where the cursor STOOD and what rode that call — and nothing else', () => {
    const m = notice({ declared: ['a', 'b'], served: ['a', 'b'] });
    expect(m).toContain(
      'read_skill("alpha") named the skill you were already standing in when you made that call',
    );
    expect(m).toContain('the cursor did not move');
    expect(m).toContain("Its instructions were in that call's system prompt.");
    expect(m).toContain("Its own tools were on that call's tool list: a, b.");
    expect(unprovable(m)).toEqual([]);
  });

  it('anchors every clause to ONE named call, never to "the call you just made"', () => {
    // The deixis bug hiding inside the clause the last round called safe. Past
    // tense is not enough: "the call you just made", re-read on call five,
    // denotes call four, and the tools it names rode call one. "That call" is
    // bound by the opening clause and means the same call wherever it is read.
    const m = notice({ declared: ['a'], served: ['a'] });
    expect(m).not.toContain('the call you just made');
    expect((m.match(/that call/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('makes no offer, no exhortation, and no prediction — at every shape', () => {
    // The three rounds of this bug, all in one assertion: whatever the tools
    // are, there is nothing in the string a later call can falsify.
    for (const tools of [
      { declared: [], served: [] },
      { declared: ['a'], served: ['a'] },
      { declared: ['a', 'b'], served: [] },
      undefined,
    ] as const) {
      expect(unprovable(notice(tools))).toEqual([]);
    }
  });

  it('names no skill but the one the call was about', () => {
    // There is no routing map in the signature any more, so there is no id to
    // filter for posture, for budget or for role visibility. This pins that.
    const m = notice({ declared: ['a'], served: ['a'] });
    expect(foreignIds(m, 'alpha', ['alpha', 'beta', 'gamma'])).toEqual([]);
  });

  it('says so plainly when the skill declares no tools', () => {
    // Present tense on purpose and safely: a declaration is fixed when the
    // skill is DEFINED, so this sentence cannot be falsified by a later call.
    const m = notice({ declared: [], served: [] });
    expect(m).toContain('It declares no tools of its own');
    expect(m).not.toContain('tool list:');
  });

  it('never claims a withheld tool was served, and says "was", not "is"', () => {
    // "is withheld" is a claim about a hold-out that ADVANCES — the step tool
    // returning in this very batch moves it on. What happened on that call did
    // not.
    const m = notice({ declared: ['a'], served: [] });
    expect(m).toContain("None of its own tools were on that call's tool list (a was withheld).");
    expect(notice({ declared: ['a', 'b'], served: [] })).toContain('(a, b were withheld)');
  });

  it('claims nothing it cannot see — no tools, and nothing about the prompt', () => {
    // With the wire unknown the skill's presence in the ACTIVE set is unknown
    // too, and that is the only evidence for where its instructions were. The
    // cursor fact survives, because that is what the gate itself compared.
    const m = notice(undefined);
    expect(m).not.toMatch(/tools/);
    expect(m).not.toContain('system prompt');
    expect(m).toContain('named the skill you were already standing in');
    expect(unprovable(m)).toEqual([]);
  });

  it('a body is appended, and the wording changes to match', () => {
    // "repeated below" is present tense and timelessly true: the body is in
    // this very string, so the sentence holds wherever the string is read.
    const m = notice(undefined, { body: 'ALPHA_BODY' });
    expect(m).toContain('Its instructions are repeated below');
    expect(m).not.toContain('system prompt');
    expect(m.endsWith('ALPHA_BODY')).toBe(true);
  });
});

// ─── 2. UNIT — the description: (b) and (c) ──────────────────────

describe('read_skill description — the cursor is named, and not called unreachable', () => {
  const skills = [skill('alpha'), skill('beta')];

  it('names the cursor with NO menu outstanding — the decisively-routed turn', () => {
    const d = buildReadSkillTool(skills, { grantable: ['beta'], cursorId: 'alpha' })!.schema
      .description;
    expect(d).toContain("You are in 'alpha'.");
    // ROUND 5's blocker, pinned as a PROPERTY rather than as a string: outside
    // an outstanding menu, the name is the WHOLE sentence. The clause that used
    // to follow it — " You do not need read_skill to go on using it." — was
    // argued to be a necessity claim immune to posture, budget and hold-out.
    // The PARK falsifies it: a parked map member keeps the cursor, loses its
    // body and its tools, and `read_skill` is then the only door back. This
    // description is composed before the hold-outs run, so it can never know
    // when such a claim would be lying.
    //
    // Asserting "nothing follows the name" rather than "not that one sentence"
    // is deliberate: five rounds died of banning the last false sentence and
    // writing a new one beside it.
    expect(d.split('\n\n')[0]).toBe("You are in 'alpha'.");
  });

  it('predicts NOTHING about what read_skill would do from here', () => {
    // ROUND 4's blocker. The deleted clause — "read_skill MOVES you to a
    // DIFFERENT skill" — is false at compose time under 'rails' (every model
    // hop refused) and under off-menu 'guard'. It is also, word for word, a
    // row in the shared banned list, which is how it was caught: the round
    // that wrote that list pointed it at tool results only.
    for (const offer of [
      { grantable: ['beta'], cursorId: 'alpha' },
      { grantable: ['beta'], cursorId: 'alpha', menu: { candidates: [{ id: 'beta' }] } },
      {
        grantable: ['beta'],
        cursorId: 'alpha',
        menu: { candidates: [{ id: 'beta' }], cursorId: 'alpha', stay: true },
      },
      { grantable: [] as string[], cursorId: 'alpha' },
      { cursorId: 'alpha' },
      { hiddenIds: ['alpha'], cursorId: 'alpha' },
      {},
    ]) {
      const d = buildReadSkillTool(skills, offer)!.schema.description;
      expect(unprovableDescription(d)).toEqual([]);
    }
  });

  it('a role-HIDDEN cursor is not named — the leak this round closed', () => {
    // `hidden` is built first so "nothing below can name one", and the cursor
    // lead read `offer.cursorId` straight past it. A role denied `skill_read`
    // on alpha was told "You are in 'alpha'" — the name of a capability no
    // cursor move will ever grant it.
    const d = buildReadSkillTool([...skills, skill('gamma')], {
      grantable: ['gamma'],
      hiddenIds: ['alpha', 'beta'],
      cursorId: 'alpha',
    })!.schema.description;
    expect(d).not.toContain('alpha');
    expect(d).not.toContain('beta');
    expect(d).toContain('  - gamma:');
    // …and the menu's own cursor slot is filtered by the same line.
    const viaMenu = buildReadSkillTool(skills, {
      grantable: ['beta'],
      hiddenIds: ['alpha'],
      menu: { candidates: [{ id: 'beta' }], cursorId: 'alpha', stay: true },
    })!.schema.description;
    expect(viaMenu).not.toContain('alpha');
  });

  it('keeps the cursor OUT of "Not reachable from here"', () => {
    const d = buildReadSkillTool(skills, { grantable: ['beta'], cursorId: 'alpha' })!.schema
      .description;
    expect(d).not.toContain('Not reachable from here');
  });

  it('a genuinely unreachable skill is STILL listed — only the cursor moved out', () => {
    const three = [...skills, skill('gamma')];
    const d = buildReadSkillTool(three, { grantable: ['beta'], cursorId: 'alpha' })!.schema
      .description;
    const [reach, shut] = d.split('Not reachable from here');
    expect(reach).toContain('- beta:');
    expect(shut).toContain('- gamma:');
    expect(shut).not.toContain('- alpha:');
  });

  it('the menu keeps its own stay wording — one sentence, not two', () => {
    const d = buildReadSkillTool(skills, {
      grantable: ['beta'],
      cursorId: 'alpha',
      menu: { candidates: [{ id: 'beta' }], cursorId: 'alpha', stay: true },
    })!.schema.description;
    expect(d).toContain("You are in 'alpha'. Staying is a first-class option");
    // The stay clause is the ONE thing allowed to follow the name, and only
    // while a menu is outstanding. It survives a park because it claims what
    // the cursor DOES — staying keeps it, and parking never moves it — rather
    // than what the model needs, which is what the park falsified.
    expect(d.match(/You are in 'alpha'\./g)).toHaveLength(1);
  });

  it('no cursor, no sentence — a graph-less agent is byte-identical', () => {
    expect(buildReadSkillTool(skills, {})!.schema.description).toBe(
      buildReadSkillTool(skills)!.schema.description,
    );
    expect(buildReadSkillTool(skills, {})!.schema.description).not.toContain('You are in');
  });
});

// ─── 3. END-TO-END — the production failure, driven ──────────────

describe('a self-call through a real run', () => {
  it('the model is told what it holds, by NAME, and then acts', async () => {
    // The exact shape of the field failure: routed to alpha, model asks for
    // alpha. Before, it read "not reachable" and answered that it could not
    // help; here it is told what rode the call and calls alpha's tool.
    const { toolResults, rejected, answer } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('alpha'), callTool('alpha_tool')],
    );
    const first = toolResults[0]!;
    expect(first).toContain(NOTICE);
    expect(first).not.toContain('not reachable from here');
    // NAMES the tool — the whole point. A claim that tools "exist" would have
    // left the model exactly as stuck.
    expect(first).toContain("Its own tools were on that call's tool list: alpha_tool");
    // ...and it acted, with no sentence telling it to. The facts were enough:
    // that is the argument for deleting the exhortation rather than fixing it.
    expect(toolResults).toContain('alpha_tool:ran');
    expect(answer).toBe('done');
    expect(rejected[0]).toMatchObject({
      requestedId: 'alpha',
      currentSkillId: 'alpha',
      reason: 'self-call',
    });
  });

  it('the description named the skill BEFORE the model had to ask', async () => {
    // (c) — the root cause. Had this sentence been there, the self-call would
    // not have been made at all.
    const { descriptions } = await drive((a) => a.system('s').skillGraph(graph()), []);
    expect(descriptions[0]).toContain("You are in 'alpha'.");
    expect(descriptions[0]).not.toContain('Not reachable from here');
  });

  it('a REACHABLE hop is untouched — it activates and says so', async () => {
    // The other half of the regression guard: only the self case changed.
    const { toolResults, rejected } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('beta')],
    );
    expect(toolResults[0]).toContain('activated for the next iteration');
    expect(toolResults[0]).not.toContain(NOTICE);
    expect(rejected).toEqual([]);
  });

  it('an out-of-reach hop still says "not reachable from here"', async () => {
    const g = skillGraph({
      skills: [skill('alpha'), skill('beta'), skill('delta')],
      start: 'alpha',
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'beta', to: 'delta', onToolReturn: 'beta_tool' },
      ],
      check: 'throw',
    });
    const { toolResults, rejected } = await drive(
      (a) => a.system('s').skillGraph(g),
      [readSkill('delta')],
    );
    expect(toolResults[0]).toBe(
      'read_skill("delta") is not reachable from here. Reachable skills: beta. ' +
        'Pick one of these, or finish.',
    );
    expect(rejected[0]).toMatchObject({ requestedId: 'delta', reason: 'unreachable' });
  });

  it('a skill with NO tools of its own says that, instead of naming none', async () => {
    const g = skillGraph({
      skills: [defineSkill({ id: 'alpha', description: 'a', body: 'A_BODY' }), skill('beta')],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'beta_tool' }],
      check: 'off',
    });
    const { toolResults } = await drive((a) => a.system('s').skillGraph(g), [readSkill('alpha')]);
    expect(toolResults[0]).toContain('It declares no tools of its own');
    expect(toolResults[0]).not.toContain('tool list:');
  });
});

// ─── 4. INTEGRATION — the dials that take tools OFF the wire ─────

describe('the notice tracks the wire, not the declaration', () => {
  it('a STEP hold-out: only the step tool is named, not the other two', async () => {
    // `steps` narrows a skill's own tools to the current step's. The
    // declaration still lists three; naming all three would send the model at
    // two tools it could not call on that call.
    const refund = defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'REFUND_BODY',
      tools: [t('lookup'), t('charge'), t('export')],
      steps: [
        { tool: 'lookup', note: 'find the order' },
        { tool: 'charge', note: 'refund it' },
        { tool: 'export', note: 'file the receipt' },
      ],
    } as never);
    const g = skillGraph({
      skills: [refund, skill('beta')],
      start: 'refund',
      steps: [{ from: 'refund', to: 'beta', onToolReturn: 'export' }],
      check: 'off',
    });
    const { toolResults, wire } = await drive(
      (a) => a.system('s').skillGraph(g),
      [readSkill('refund')],
    );
    expect(toolResults[0]).toContain("tools were on that call's tool list: lookup");
    expect(toolResults[0]).not.toContain('charge');
    expect(toolResults[0]).not.toContain('export');
    // ...and that is exactly what the model was handed.
    expect(wire[0]).toContain('lookup');
    expect(wire[0]).not.toContain('charge');
  });

  it("reactMode 'classic' cannot reach this gate at all — it is refused at build", () => {
    // The classic mode caches the tools slot, so `scope.dynamicToolSchemas`
    // could be a turn-1 list describing a later call — the one configuration in
    // which naming tools from it would be a guess. It cannot arise: the gate is
    // armed ONLY by `allowedSkillIds`, which only a skill graph sets, and a
    // graph under classic is refused at build. Pinned here so the day that
    // refusal is relaxed, this test is what says the notice needs re-checking.
    expect(() =>
      Agent.create({ provider: mock({}), model: 'mock', reactMode: 'classic' })
        .system('s')
        .skillGraph(graph()),
    ).toThrow(/reactMode 'classic' cannot honor a skill graph/);
  });
});

// ─── 5. PROPERTY — the notice never names an absent tool ─────────

describe('the notice is bounded by the wire, at every cursor', () => {
  it('every tool it names was on that call — checked against what the model saw', async () => {
    const { toolResults, wire } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('alpha'), callTool('alpha_tool'), readSkill('beta')],
    );
    const notices = toolResults.filter((r) => r.includes(NOTICE));
    expect(notices.length).toBeGreaterThan(0);
    for (const [i, notice] of notices.entries()) {
      // The wire the model was handed on the call that produced this notice.
      for (const name of namedTools(notice)) expect(wire[i]).toContain(name);
    }
  });
});

// ─── 6. SECURITY — a self-call is still not an activation ────────

describe('a self-call has no side effects it did not already have', () => {
  it('does not move the cursor and does not leak another skill body', async () => {
    const { toolResults } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('alpha'), callTool('alpha_tool')],
    );
    // alpha's own body is not repeated (its surface mode is 'auto' — the system
    // slot carries it), and no OTHER skill's body appears in a tool result.
    expect(toolResults[0]).not.toContain('BETA_BODY');
    expect(toolResults[0]).not.toContain('GAMMA_BODY');
    expect(toolResults[0]).not.toContain('ALPHA_BODY');
  });

  it('is still recorded as a rejection — a self-call LOOP must stay visible', async () => {
    const { rejected } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('alpha', 'c1'), readSkill('alpha', 'c2'), readSkill('alpha', 'c3')],
    );
    expect(rejected).toHaveLength(3);
    expect(rejected.every((r) => r.reason === 'self-call')).toBe(true);
  });
});

// ─── 7. MATRIX — every budget × every posture, asserted on the LAST read ──

/** Every request the provider was handed: its tool list and its messages. */
async function requests(
  maxIterations: number,
  script: readonly Turn[],
  strictness?: 'guard' | 'rails',
) {
  const calls: Array<{
    tools: string[];
    messages: Array<{ role: string; content: string }>;
    readSkillDescription: string;
  }> = [];
  let i = 0;
  const provider = mock({
    respond: (req: {
      messages?: ReadonlyArray<{ role: string; content: unknown }>;
      tools?: ReadonlyArray<{ name: string; description?: string }>;
    }) => {
      calls.push({
        tools: (req.tools ?? []).map((x) => x.name),
        messages: (req.messages ?? []).map((m) => ({
          role: m.role,
          content: String(m.content),
        })),
        readSkillDescription:
          (req.tools ?? []).find((x) => x.name === 'read_skill')?.description ?? '',
      });
      return script[i++] ?? { content: 'done', toolCalls: [] };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', maxIterations })
    .system('s')
    .skillGraph(graph(), strictness === undefined ? undefined : { strictness })
    .build();
  const answer = await agent.run({ message: 'go' });
  return { calls, answer };
}

/**
 * A tool result is written on iteration N, read on call N+1, and re-read on
 * every call after that. The two earlier rounds tested the FIRST request the
 * notice appears in; the bug lives in the LAST one, which at some budgets is
 * the tool-less wrap-up. This matrix asserts over the last one in every cell.
 */
describe('the notice, in the last request that carries it', () => {
  const budgets = [2, 3, 4, 5];
  const postures: Array<'guard' | 'rails' | undefined> = [undefined, 'guard', 'rails'];

  for (const maxIterations of budgets) {
    for (const strictness of postures) {
      const cell = `maxIterations ${maxIterations} × strictness ${strictness ?? 'default'}`;

      it(`${cell}: every clause survives to the last call it is read on`, async () => {
        // Self-call on the FIRST iteration, then filler tool turns until the
        // budget runs out — so the notice is carried through every remaining
        // call, wrap-up included.
        const filler = callTool('alpha_tool', 'f');
        const script = [readSkill('alpha'), ...Array.from({ length: 8 }, () => filler)];
        const { calls } = await requests(maxIterations, script, strictness);

        const carrying = calls.filter((c) => c.messages.some((m) => m.content.includes(NOTICE)));
        expect(carrying.length).toBeGreaterThan(0);
        const last = carrying[carrying.length - 1]!;
        const notice = last.messages.find((m) => m.content.includes(NOTICE))!.content;

        // (1) No clause a later call can falsify — the checker IS the bug list.
        expect(unprovable(notice)).toEqual([]);

        // (2) No skill id but the cursor's, so no posture and no hidden-id
        //     filter can make the notice wrong, and no sibling refusal in any
        //     posture has anything to disagree with.
        expect(foreignIds(notice, 'alpha', ['alpha', 'beta', 'gamma'])).toEqual([]);

        // (3) Every tool it names really rode the call it says it rode — call 1,
        //     the one the read_skill was issued from, not "the last call".
        const named = namedTools(notice);
        expect(named).toEqual(['alpha_tool']);
        for (const name of named) expect(calls[0]!.tools).toContain(name);

        // (3b) THE DESCRIPTION IS A MODEL-FACING SURFACE TOO. Round 3 checked
        //      only tool results, and the banned clause reappeared here. Every
        //      request in the cell, not just the ones carrying a notice.
        for (const call of calls) {
          if (call.readSkillDescription === '') continue;
          expect(unprovableDescription(call.readSkillDescription)).toEqual([]);
        }

        // (4) If that last request is the tool-less wrap-up, the notice must
        //     not fight the instruction sitting beside it.
        if (last.tools.length === 0) {
          expect(
            last.messages.some((m) =>
              m.content.startsWith('Your action budget for this turn is exhausted'),
            ),
          ).toBe(true);
          expect(notice).not.toMatch(/Go ahead|MOVES you|These activate/);
        }
      });
    }
  }

  it('at least one cell really does end on a tool-less wrap-up', async () => {
    // Guards the matrix itself: if no cell ever reached the wrap-up, (4) above
    // would be vacuous and the matrix would pass while proving nothing — the
    // failure mode of the two previous rounds, in a different shape.
    const filler = callTool('alpha_tool', 'f');
    const reached: number[] = [];
    for (const maxIterations of [2, 3, 4, 5]) {
      const { calls } = await requests(maxIterations, [
        readSkill('alpha'),
        ...Array.from({ length: 8 }, () => filler),
      ]);
      const carrying = calls.filter((c) => c.messages.some((m) => m.content.includes(NOTICE)));
      if (carrying[carrying.length - 1]!.tools.length === 0) reached.push(maxIterations);
    }
    expect(reached).toEqual([2, 3, 4, 5]);
  });
});

// ─── 8. IN-BATCH CURSOR MOVE — the two owners of the cursor sentence ──

describe('a sibling tool that moves the cursor in the SAME batch', () => {
  it('the notice and the read_skill description in that request cannot disagree', async () => {
    // `alpha_tool` fires the alpha→beta step edge, and `read_skill('alpha')`
    // rides the same batch. On the next call the description — recomposed —
    // says "You are in 'beta'." The notice used to say "You are already in
    // 'alpha'." in that same request. Both cannot be true, and the notice is
    // the one with no right to the present tense: it is a record of a finished
    // call, not a report of the current state.
    const batch: Turn = {
      content: '',
      toolCalls: [
        { id: 'a', name: 'alpha_tool', args: {} },
        { id: 'b', name: 'read_skill', args: { id: 'alpha' } },
      ],
    };
    const { calls } = await requests(6, [batch]);
    const carrying = calls.find((c) => c.messages.some((m) => m.content.includes(NOTICE)))!;
    expect(carrying).toBeDefined();
    const notice = carrying.messages.find((m) => m.content.includes(NOTICE))!.content;

    // The cursor DID move inside that batch — the premise of the test.
    expect(carrying.readSkillDescription).toContain("You are in 'beta'.");

    // Exactly one sentence in this request speaks in the present about where
    // the model is, and it is the description's.
    const present = /You are (already )?in '([a-z]+)'/.exec(notice);
    expect(present).toBeNull();

    // What the notice says instead is a fact about the call it answers, and it
    // stays true however far the cursor has since travelled.
    expect(notice).toContain(
      'read_skill("alpha") named the skill you were already standing in when you made that call',
    );
    expect(unprovable(notice)).toEqual([]);
  });
});

// ─── 9. INTEGRATION — role visibility is not something the notice can leak ──

describe('per-role skill visibility', () => {
  it('the notice names no skill at all, so there is nothing to hide from it', async () => {
    // `hiddenSkillIds` filters the read_skill DESCRIPTION but never the gate's
    // admission set. The previous round pushed the notice's own ids through
    // that filter; this round removed the ids, which closes the leak and the
    // two staleness paths (posture, budget) the filter never touched.
    const g = skillGraph({
      skills: [skill('alpha'), skill('beta'), skill('gamma')],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'off',
    });
    let i = 0;
    const script: Turn[] = [readSkill('alpha')];
    const seen: string[] = [];
    const provider = mock({
      respond: (req: { messages?: ReadonlyArray<{ role: string; content: unknown }> }) => {
        for (const m of req.messages ?? []) if (m.role === 'tool') seen.push(String(m.content));
        return script[i++] ?? { content: 'done', toolCalls: [] };
      },
    });
    const policy = PermissionPolicy.fromRoles(
      { support: ['read_skill', 'alpha_tool', 'beta_tool', 'gamma_tool'] },
      'support',
      { skills: { support: ['alpha', 'gamma'] } },
    );
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 6,
      permissionChecker: policy,
    })
      .system('s')
      .skillGraph(g)
      .build();
    await agent.run({ message: 'go' });
    const notice = seen.find((r) => r.includes(NOTICE))!;
    expect(notice).toBeDefined();
    // beta is hidden from this role; gamma is visible and open. Neither is
    // named, because the notice names no destination at all.
    expect(foreignIds(notice, 'alpha', ['alpha', 'beta', 'gamma'])).toEqual([]);
  });
});

// ─── 10. POSTURE — the notice and the sibling refusal, side by side ──

describe('the notice cannot contradict the posture arm', () => {
  for (const strictness of ['guard', 'rails'] as const) {
    it(`under '${strictness}', the notice offers no move the posture would refuse`, async () => {
      // The live bug: the self-call arm offered "read_skill MOVES you somewhere
      // else — from here that would be: beta", the model took it, and the
      // POSTURE arm forty lines below refused it with "read_skill here reaches
      // only the open skills: gamma" — a direct contradiction, and one that
      // spent a refusal from the escalation budget to discover.
      const { calls } = await requests(
        6,
        [readSkill('alpha'), readSkill('beta', 'c2')],
        strictness,
      );
      const notice = calls
        .flatMap((c) => c.messages)
        .find((m) => m.content.includes(NOTICE))!.content;
      const refusal = calls
        .flatMap((c) => c.messages)
        .find((m) => m.content.includes('was declined'))!.content;
      expect(notice).toBeDefined();
      expect(refusal).toBeDefined();

      // The refusal names what read_skill can still reach here. The notice
      // names nothing, so the two cannot disagree — under any posture, and
      // whatever the refusal's own list turns out to be.
      expect(refusal).toContain('read_skill here reaches only the open skills: gamma');
      expect(foreignIds(notice, 'alpha', ['alpha', 'beta', 'gamma'])).toEqual([]);
      expect(unprovable(notice)).toEqual([]);

      // ROUND 4: and neither does the DESCRIPTION. Under this posture
      // `read_skill` moves nobody, so the description must not say it does —
      // it did, on the very release that made the notice clean, because the
      // checker above was pointed at tool results only.
      const descriptions = calls.map((c) => c.readSkillDescription).filter((d) => d !== '');
      expect(descriptions.length).toBeGreaterThan(0);
      for (const d of descriptions) {
        expect(unprovableDescription(d)).toEqual([]);
        expect(d).toContain("You are in 'alpha'.");
      }
    });
  }
});

// ─── 11. INTEGRATION — a self-call is evidence, even though it is not a refusal ──

describe('the self-call counts toward the escalation budget', () => {
  it('a self-call LOOP escalates, exactly as a refusal loop does', async () => {
    // The two comments this pins used to disagree: `selfCallNotice` says the
    // self-call is NOT a refusal, `noteSkillRefusal` counts it as the evidence
    // that escalates the run. Both are true, and this is the behaviour that
    // makes them true together — a model asking the graph where it stands over
    // and over is the stuck run the budget exists to escalate, whatever the
    // sentence it gets back reads like.
    const escalated: Array<Record<string, unknown>> = [];
    let i = 0;
    const script: Turn[] = [readSkill('alpha', 'c1'), readSkill('alpha', 'c2')];
    const provider = mock({
      respond: () => script[i++] ?? { content: 'done', toolCalls: [] },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 6 })
      .system('s')
      .skillGraph(graph(), {
        escalation: {
          provider: mock({ respond: () => ({ content: 'escalated', toolCalls: [] }) }),
          model: 'esc-model',
          afterRefusals: 2,
        },
      })
      .watch({
        id: 'esc',
        onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.skill.escalated') escalated.push(e.payload ?? {});
        },
      })
      .build();
    const answer = await agent.run({ message: 'go' });
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({ afterRefusals: 2, refusals: 2 });
    expect(answer).toBe('escalated');
  });
});
