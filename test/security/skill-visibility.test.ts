/**
 * Per-role skill-catalog visibility (9.11.0) — the permission checker composed
 * with the skill catalog.
 *
 *   P1 Unit         — `hiddenIds` removes a row from the menu the model reads,
 *                     and NEVER narrows the enum
 *   P2 Boundary     — no checker, or a checker that does not govern
 *                     `'skill_read'`, is byte-identical to today
 *   P3 Scenario     — a role sees a filtered catalog; the other role sees the
 *                     rest; activating a hidden skill is refused with the
 *                     POLICY's own message and the skill never activates
 *   P4 Property     — a hidden skill is never NAMED anywhere in the menu — not
 *                     as reachable, not as refusable, and (9.84.0) not as the
 *                     CURSOR the model is standing in. Driven on both build
 *                     paths: `.skill()` (no cursor) and `.skillGraph()` (a
 *                     cursor, which is the half the property could not reach
 *                     until the graph agents below were added)
 *   P5 Security     — a hidden skill's BODY is never computed (the refusal
 *                     lands before `execute`, which `surfaceMode: 'tool-only'`
 *                     would otherwise return it from); a throwing checker hides
 *   P6 Performance  — n/a (one check per skill per iteration, opt-in only)
 *   P7 ROI          — one policy object drives both halves: the menu and the
 *                     activation, so they cannot disagree
 *
 * Why the enum stays whole: `toolArgValidation` defaults to `'enforce'` and runs
 * BEFORE the gate. Narrowing the enum would turn a policy refusal into a generic
 * schema error, and the model would never read the policy's own message — the
 * same reasoning 8.5.0 recorded for the skill-graph offer.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { buildReadSkillTool, defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { PermissionPolicy } from '../../src/security/PermissionPolicy.js';
import { skillTarget, skillIdFromTarget } from '../../src/security/skillTarget.js';
import {
  hiddenIdsNamed,
  unprovable,
  GRAPH_TOOL_DESCRIPTION,
} from '../helpers/modelFacingClaims.js';
import type { PermissionChecker, PermissionRequest } from '../../src/adapters/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const skill = (id: string, surfaceMode?: 'tool-only') =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id}_BODY`,
    ...(surfaceMode && { surfaceMode }),
  });

const SKILLS = ['refunds', 'payroll', 'lookup'] as const;

/** The role allowlist every agent below uses — tools plus `read_skill`. */
const ROLES = {
  support: ['read_skill', 'noop'],
  hr: ['read_skill', 'noop'],
};

function policyFor(role: 'support' | 'hr'): PermissionPolicy {
  return PermissionPolicy.fromRoles(ROLES, role, {
    skills: { support: ['refunds', 'lookup'], hr: ['payroll'] },
  });
}

/** An agent with three skills and an optional checker. */
function buildAgent(opts: {
  checker?: PermissionChecker;
  script?: { content?: string; toolCalls?: { id: string; name: string; args: unknown }[] }[];
  toolOnly?: boolean;
  onRequest?: (description: string) => void;
}) {
  const noop = defineTool({
    name: 'noop',
    description: 'does nothing',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });
  let i = 0;
  const script = opts.script ?? [{ content: 'done' }];
  const provider = mock({
    respond: (req: { tools?: ReadonlyArray<{ name: string; description: string }> }) => {
      const rs = (req.tools ?? []).find((x) => x.name === 'read_skill');
      opts.onRequest?.(rs?.description ?? '(no read_skill)');
      return (script[i++] ?? { content: 'done' }) as never;
    },
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 4,
    ...(opts.checker && { permissionChecker: opts.checker }),
  }).tool(noop);
  for (const id of SKILLS) builder.skill(skill(id, opts.toolOnly ? 'tool-only' : undefined));
  return builder.build();
}

/** The `read_skill` descriptions the model saw, one per iteration. */
async function menusFor(checker?: PermissionChecker): Promise<string[]> {
  const seen: string[] = [];
  const agent = buildAgent({ ...(checker && { checker }), onRequest: (d) => seen.push(d) });
  await agent.run({ message: 'go' });
  return seen;
}

/** Every skill id named anywhere in a menu. */
function idsIn(description: string): string[] {
  return [...description.matchAll(/^ {2}- ([^:]+):/gm)].map((m) => (m[1] as string).trim());
}

// ─── P1 Unit — the builder ───────────────────────────────────────────

describe('buildReadSkillTool — hiddenIds', () => {
  const skills = SKILLS.map((id) => skill(id));

  it('removes a row from the menu the model reads', () => {
    const d = buildReadSkillTool(skills, { hiddenIds: ['payroll'] })!.schema.description;
    expect(d).toContain('  - refunds:');
    expect(d).toContain('  - lookup:');
    expect(d).not.toContain('payroll');
  });

  it('never narrows the ENUM — a policy refusal must reach the model, not a schema error', () => {
    const tool = buildReadSkillTool(skills, { hiddenIds: ['payroll'] })!;
    const ids = (tool.schema.inputSchema as { properties: { id: { enum?: string[] } } }).properties
      .id.enum;
    expect(ids).toEqual(['refunds', 'payroll', 'lookup']);
  });

  it('says so plainly when a role has nothing left', () => {
    const d = buildReadSkillTool(skills, { hiddenIds: [...SKILLS] })!.schema.description;
    expect(d).toContain('No skills are available to you');
  });

  it('composes with the graph offer — hidden ids appear in NEITHER section', () => {
    const d = buildReadSkillTool(skills, {
      grantable: ['refunds', 'payroll'],
      hiddenIds: ['payroll'],
    })!.schema.description;
    expect(d).toContain('  - refunds:');
    expect(d).toContain('Not reachable from here');
    expect(d).toContain('  - lookup:');
    expect(d).not.toContain('payroll');
  });

  it('an offer that hides nothing and has no graph reads exactly like no offer at all', () => {
    // The filtered path must degrade to the byte-identical original when the
    // filter is empty — otherwise "opt-in" would still change the prompt.
    expect(buildReadSkillTool(skills, {})!.schema.description).toBe(
      buildReadSkillTool(skills)!.schema.description,
    );
  });
});

// ─── P2 Boundary — opt-in by construction ────────────────────────────

describe('the two silences', () => {
  it('no checker → the full catalog, exactly as before', async () => {
    const menus = await menusFor();
    expect(idsIn(menus[0] ?? '').sort()).toEqual(['lookup', 'payroll', 'refunds']);
  });

  it('a checker that does not govern skill_read → the full catalog, and it is never asked', async () => {
    const asked: PermissionRequest[] = [];
    const checker: PermissionChecker = {
      name: 'tools-only',
      check: (r) => {
        asked.push(r);
        return { result: 'allow' };
      },
    };
    const menus = await menusFor(checker);
    expect(idsIn(menus[0] ?? '').sort()).toEqual(['lookup', 'payroll', 'refunds']);
    expect(asked.some((r) => r.capability === 'skill_read')).toBe(false);
  });

  it('a policy built without skill rules governs nothing new', () => {
    expect(PermissionPolicy.fromRoles(ROLES, 'support').governs).toBeUndefined();
  });
});

// ─── P3 Scenario — two roles, two catalogs ───────────────────────────

describe('a role sees its own catalog', () => {
  it('support sees refunds + lookup; hr sees payroll', async () => {
    expect(idsIn((await menusFor(policyFor('support')))[0] ?? '').sort()).toEqual([
      'lookup',
      'refunds',
    ]);
    expect(idsIn((await menusFor(policyFor('hr')))[0] ?? '')).toEqual(['payroll']);
  });

  it('the policy declares it governs skill_read, which is what turns the filter on', () => {
    expect(policyFor('support').governs).toEqual(['skill_read']);
  });

  it('activating a hidden skill is refused with the POLICY’s own message', async () => {
    const results: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'payroll' } }] },
        { content: 'done' },
      ],
    });
    agent.on('agentfootprint.stream.tool_end', (e) => {
      const r = (e.payload as { result: unknown }).result;
      results.push(typeof r === 'string' ? r : JSON.stringify(r));
    });
    await agent.run({ message: 'go' });
    expect(results.at(-1)).toContain('permission denied');
    expect(results.at(-1)).toContain("Skill 'payroll' is not available to the 'support' role.");
  });

  it('and the hidden skill never activates — its body stays out of the prompt', async () => {
    const prompts: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'payroll' } }] },
        { content: 'done' },
      ],
      onRequest: () => undefined,
    });
    agent.on('agentfootprint.context.injected', (e) => {
      prompts.push(JSON.stringify(e.payload));
    });
    await agent.run({ message: 'go' });
    expect(prompts.join('\n')).not.toContain('payroll_BODY');
  });

  it('a VISIBLE skill still activates normally', async () => {
    const results: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'refunds' } }] },
        { content: 'done' },
      ],
    });
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push(String((e.payload as { result: unknown }).result));
    });
    await agent.run({ message: 'go' });
    expect(results.at(-1)).toContain("Skill 'refunds' activated");
  });
});

// ─── P4 Property — a hidden skill is never named ─────────────────────

describe('property — nothing names a hidden skill', () => {
  it('across every iteration of a multi-turn run', async () => {
    const seen: string[] = [];
    const agent = buildAgent({
      checker: policyFor('hr'),
      script: [
        { toolCalls: [{ id: 'c1', name: 'noop', args: {} }] },
        { toolCalls: [{ id: 'c2', name: 'noop', args: {} }] },
        { content: 'done' },
      ],
      onRequest: (d) => seen.push(d),
    });
    await agent.run({ message: 'go' });
    expect(seen.length).toBeGreaterThan(1);
    for (const menu of seen) {
      expect(menu).not.toContain('refunds');
      expect(menu).not.toContain('lookup');
      expect(menu).toContain('payroll');
    }
  });
});

/**
 * The SAME property, driven through `.skillGraph()` (9.84.0).
 *
 * P4 above stayed green through the leak that shipped in this release, and the
 * reason is worth writing down: its agents are built with `.skill()`, which
 * gives the offer no cursor at all. `offer.cursorId` was therefore `undefined`
 * in every one of those runs, and the line that read it raw — past the hidden
 * set built one statement earlier — was never executed. A property test that
 * cannot reach the code path it is a property of proves nothing about it.
 *
 * So this block builds the graph: role `support` may see only `gamma`, and the
 * graph's cursor STARTS on `alpha`. The description used to open with "You are
 * in 'alpha'." — the id of a skill this role may never activate.
 */
describe('property — nothing names a hidden skill, on the graph path either', () => {
  const graphSkills = ['alpha', 'beta', 'gamma'] as const;

  /** A three-skill graph starting at `alpha`, with `gamma` wired to nothing. */
  const g = () =>
    skillGraph({
      skills: graphSkills.map((id) =>
        defineSkill({
          id,
          description: `${id} does things`,
          body: `${id}_BODY`,
        }),
      ),
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'noop' }],
      check: 'off',
    });

  /** Every `read_skill` description a graph run showed the model. */
  async function graphMenus(visible: readonly string[]): Promise<string[]> {
    const noop = defineTool({
      name: 'noop',
      description: 'does nothing',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'ok',
    });
    const seen: string[] = [];
    const script = [
      { content: '', toolCalls: [{ id: 'c1', name: 'noop', args: {} }] },
      { content: 'done', toolCalls: [] },
    ];
    let i = 0;
    const provider = mock({
      respond: (req: { tools?: ReadonlyArray<{ name: string; description: string }> }) => {
        const rs = (req.tools ?? []).find((x) => x.name === 'read_skill');
        if (rs) seen.push(rs.description);
        return (script[i++] ?? { content: 'done', toolCalls: [] }) as never;
      },
    });
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 4,
      permissionChecker: PermissionPolicy.fromRoles(
        { support: ['read_skill', 'noop'] },
        'support',
        {
          skills: { support: [...visible] },
        },
      ),
    })
      .system('s')
      .tool(noop)
      .skillGraph(g())
      .build();
    await agent.run({ message: 'go' });
    return seen;
  }

  it('the CURSOR is a hidden skill, and the menu still never names it', async () => {
    // The reproduction, end to end: cursor on `alpha`, role sees only `gamma`.
    const menus = await graphMenus(['gamma']);
    expect(menus.length).toBeGreaterThan(0);
    for (const menu of menus) {
      expect(hiddenIdsNamed(menu, ['alpha', 'beta'])).toEqual([]);
      expect(menu).not.toContain('You are in');
    }
  });

  it('the filter emptied the hop set, and the menu OMITS the clause rather than denying the graph holds one (9.86.0 fix pass)', async () => {
    // Cursor on `alpha`, whose only declared hop is `beta`, and this role sees
    // neither. The description composed its columns from the already-filtered
    // catalog, so it printed "Nothing is reachable from here" over a graph that
    // was holding alpha → beta — the same filtered-to-empty-reported-as-empty
    // shape the refusal composer was repaired for, on the surface the model
    // reads to CHOOSE.
    const menus = await graphMenus(['gamma']);
    expect(menus.length).toBeGreaterThan(0);
    for (const menu of menus) {
      expect(menu).not.toContain('Nothing is reachable from here');
      // Still no leak — omitting the sentence names nothing new.
      expect(hiddenIdsNamed(menu, ['alpha', 'beta'])).toEqual([]);
    }
  });

  it('a VISIBLE cursor is still named — the fix hides, it does not mute', async () => {
    // The other half. Dropping the sentence for everyone would have "fixed" the
    // leak by re-opening the production bug it was added to close.
    const menus = await graphMenus(['alpha', 'gamma']);
    expect(menus[0]).toContain("You are in 'alpha'.");
    expect(hiddenIdsNamed(menus[0] ?? '', ['beta'])).toEqual([]);
  });

  /**
   * THE PROPERTY, WIDENED TO EVERY MODEL-FACING SURFACE (9.86.0).
   *
   * Until now "a hidden skill is never named" was asserted over the read_skill
   * DESCRIPTION and nowhere else, because that was the only composer that had
   * been taught the filter. The gate's refusals and the `skill.rejected`
   * payload read the graph's RAW sets one stage downstream, so a role that
   * could not see `beta` was still told "Reachable skills: beta" the moment it
   * asked for anything unreachable — the same leak, on the surface nobody had
   * pointed the property at. The hidden set is now resolved once by the tools
   * slot and carried on scope, so this block asserts over EVERY tool result and
   * EVERY rejection payload of a real run.
   */
  describe('the same property, over every tool result and every rejection payload', () => {
    const noop = defineTool({
      name: 'noop',
      description: 'does nothing',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'ok',
    });

    /** Run a graph agent that asks for `wanted`, capturing everything the model read. */
    async function graphRun(args: {
      readonly visible: readonly string[];
      readonly wanted: string;
      readonly build?: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>;
    }) {
      const results: string[] = [];
      const rejected: Array<Record<string, unknown>> = [];
      const script = [
        { content: '', toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: args.wanted } }] },
        { content: 'done', toolCalls: [] },
      ];
      let i = 0;
      const provider = mock({
        respond: (req: { messages?: ReadonlyArray<{ role: string; content: unknown }> }) => {
          for (const m of req.messages ?? [])
            if (m.role === 'tool') results.push(String(m.content));
          return (script[i++] ?? { content: 'done', toolCalls: [] }) as never;
        },
      });
      let builder = Agent.create({
        provider,
        model: 'mock',
        maxIterations: 4,
        permissionChecker: PermissionPolicy.fromRoles(
          { support: ['read_skill', 'noop'] },
          'support',
          { skills: { support: [...args.visible] } },
        ),
      })
        .system('s')
        .tool(noop);
      builder = (args.build ?? ((a) => a.skillGraph(g())))(builder);
      const agent = builder
        .watch({
          id: 'w',
          onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
            if (e.name === 'agentfootprint.skill.rejected') rejected.push(e.payload ?? {});
          },
        })
        .build();
      await agent.run({ message: 'go' });
      return { results, rejected };
    }

    it('a refusal never names a hidden HOP — the gate filters the set it names, not the set it admits', async () => {
      // Cursor on alpha; role sees alpha and gamma, never beta. `delta` is
      // registered, visible, and unreachable — so the pick is a genuine
      // reachability refusal and the composer runs.
      const graphWithDelta = () =>
        skillGraph({
          skills: ['alpha', 'beta', 'gamma', 'delta'].map((id) =>
            defineSkill({ id, description: `${id} does things`, body: `${id}_BODY` }),
          ),
          start: 'alpha',
          steps: [
            { from: 'alpha', to: 'beta', onToolReturn: 'noop' },
            { from: 'alpha', to: 'gamma', onToolReturn: 'noop' },
            { from: 'gamma', to: 'delta', onToolReturn: 'noop' },
          ],
          check: 'off',
        });
      const { results, rejected } = await graphRun({
        visible: ['alpha', 'gamma', 'delta'],
        wanted: 'delta',
        build: (a) => a.skillGraph(graphWithDelta()),
      });
      const refusal = results.find((r) => r.includes('was not granted on that call'));
      expect(refusal).toBeDefined();
      // Every tool result of the run, and every payload — not just the one.
      for (const r of results) expect(hiddenIdsNamed(r, ['beta'])).toEqual([]);
      for (const row of rejected) expect(hiddenIdsNamed(JSON.stringify(row), ['beta'])).toEqual([]);
      // …and it is filtered rather than mute: the visible hop is still named,
      // so the model can route in one step.
      expect(refusal).toContain('gamma');
      expect(rejected[0]?.allowed).toEqual(['gamma']);
    });

    it('a POSTURE refusal never names a hidden skill either', async () => {
      // The other composer arm. Under 'guard' with no outstanding menu, a
      // reachable hop is declined — and the sentence may still name open
      // skills, which is the clause the filter has to reach.
      const guarded = () =>
        skillGraph({
          skills: ['alpha', 'beta'].map((id) =>
            defineSkill({ id, description: `${id} does things`, body: `${id}_BODY` }),
          ),
          start: 'alpha',
          steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'noop' }],
          check: 'off',
        });
      const secret = defineSkill({ id: 'secret', description: 'secret', body: 'SECRET_BODY' });
      const { results, rejected } = await graphRun({
        visible: ['alpha', 'beta'],
        wanted: 'beta',
        build: (a) => a.skillGraph(guarded(), { strictness: 'guard' }).skill(secret),
      });
      const refusal = results.find((r) => r.includes('was not granted on that call'));
      expect(refusal).toBeDefined();
      // `secret` is an OPEN skill this role may not see. The posture arm's own
      // open-skill clause is where it would have appeared.
      for (const r of results) expect(hiddenIdsNamed(r, ['secret'])).toEqual([]);
      for (const row of rejected) {
        expect(hiddenIdsNamed(JSON.stringify(row), ['secret'])).toEqual([]);
      }
      expect(refusal).toContain("'guard' posture");
    });

    // ── OMIT, NEVER DENY (9.86.0 fix pass) ────────────────────────────
    // The filter's other half. Not naming a hidden hop is only half the law;
    // the other half is that the sentence left behind must not turn the
    // omission into a claim that nothing was there.

    it('when the filter empties the hop set, the refusal omits the clause — it does NOT say nothing was reachable', async () => {
      // Cursor on `alpha`, whose ONLY declared hop is `beta`, and `beta` is
      // hidden from this role. `delta` is visible and WIRED (so it is a graph
      // member, not an open skill the gate would admit) but unreachable from
      // `alpha`, so asking for it is a genuine reachability refusal.
      const graphWithDelta = () =>
        skillGraph({
          skills: ['alpha', 'beta', 'gamma', 'delta'].map((id) =>
            defineSkill({ id, description: `${id} does things`, body: `${id}_BODY` }),
          ),
          start: 'alpha',
          steps: [
            { from: 'alpha', to: 'beta', onToolReturn: 'noop' },
            { from: 'gamma', to: 'delta', onToolReturn: 'noop' },
          ],
          check: 'off',
        });
      const { results, rejected } = await graphRun({
        visible: ['alpha', 'gamma', 'delta'],
        wanted: 'delta',
        build: (a) => a.skillGraph(graphWithDelta()),
      });
      const refusal = results.find((r) => r.includes('was not granted on that call'));
      expect(refusal).toBeDefined();
      expect(refusal).toContain("'delta' was not reachable from 'alpha'");
      // THE DEFECT: `beta` WAS reachable from `alpha`. Saying otherwise denies
      // what the graph holds, and a model told the map is a dead end stops
      // asking for the door it may not be shown.
      expect(refusal).not.toMatch(/No skill was reachable/);
      // Still no leak, on either channel.
      for (const r of results) expect(hiddenIdsNamed(r, ['beta'])).toEqual([]);
      for (const row of rejected) {
        expect(hiddenIdsNamed(JSON.stringify(row), ['beta'])).toEqual([]);
      }
      // The hop half of the spoken set is empty and the OPEN half is not, so
      // the payload carries exactly what the sentence named: no hop, and the
      // one open skill this role may see.
      expect(rejected[0]?.allowed).toEqual(['gamma']);
      expect(refusal).toContain('Open skills were admitted on that call: gamma.');
    });

    it('a refusal never names a hidden CURSOR — the anchor is the skill, unnamed (9.86.1)', async () => {
      // The description for this very request withholds `alpha` ("ROLE
      // VISIBILITY WINS OVER THE POSITIVE SIGNAL") and the refusal printed it
      // raw in two clauses: "'delta' was not reachable from 'alpha'. Skills
      // reachable from 'alpha' when that call was made: gamma." The one id the
      // description's law says the role must not be taught, on a persistent
      // result. Role sees gamma and delta; cursor alpha and hop beta are hidden.
      const graphWithDelta = () =>
        skillGraph({
          skills: ['alpha', 'beta', 'gamma', 'delta'].map((id) =>
            defineSkill({ id, description: `${id} does things`, body: `${id}_BODY` }),
          ),
          start: 'alpha',
          steps: [
            { from: 'alpha', to: 'beta', onToolReturn: 'noop' },
            { from: 'alpha', to: 'gamma', onToolReturn: 'noop' },
            { from: 'gamma', to: 'delta', onToolReturn: 'noop' },
          ],
          check: 'off',
        });
      for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
        const { results, rejected } = await graphRun({
          visible: ['gamma', 'delta'],
          wanted: 'delta',
          build: (a) => a.skillGraph(graphWithDelta(), { reactMode } as never),
        });
        const refusal = results.find((r) => r.includes('was not granted on that call'));
        expect(refusal, reactMode).toBeDefined();
        // Not the cursor, not the hidden hop — on every tool result of the run.
        for (const r of results)
          expect(hiddenIdsNamed(r, ['alpha', 'beta']), reactMode).toEqual([]);
        // The skill is real and merely unnamed: not "the turn's start", which
        // is the cold-start anchor and would be a false fact about this call.
        expect(refusal, reactMode).toContain(
          "'delta' was not reachable from the skill the cursor stood in.",
        );
        expect(refusal, reactMode).not.toMatch(/the turn's start/);
        // Filtered, not muted: the visible hop is still named.
        expect(refusal, reactMode).toContain('gamma');
        expect(rejected[0]?.allowed, reactMode).toEqual(['gamma']);
        // `skill.rejected.currentSkillId` is the OPERATOR's record of where the
        // cursor stood, on the event channel a recorder reads — not a sentence
        // the model reads — and it stays raw, like every other event payload.
        expect(rejected[0]?.currentSkillId, reactMode).toBe('alpha');
      }
    });

    it('a propose-transition refusal never names a hidden hop or a hidden cursor (9.86.1)', async () => {
      // The tool-effects judge composed its reachability refusal from the raw
      // hop set and the raw cursor, and the refusal is appended to the tool
      // result the model reads — "'delta' is not reachable from 'alpha' per the
      // graph's own law (reachable: beta, gamma)" named both hidden ids. Same
      // filter as the gate's now.
      const results: string[] = [];
      const effectsSeen: Array<Record<string, unknown>> = [];
      const script = [
        { content: '', toolCalls: [{ id: 'c1', name: 'diagnose', args: {} }] },
        { content: 'done', toolCalls: [] },
      ];
      let i = 0;
      const provider = mock({
        respond: (req: { messages?: ReadonlyArray<{ role: string; content: unknown }> }) => {
          for (const m of req.messages ?? [])
            if (m.role === 'tool') results.push(String(m.content));
          return (script[i++] ?? { content: 'done', toolCalls: [] }) as never;
        },
      });
      const diagnose = defineTool({
        name: 'diagnose',
        description: 'judges the data',
        inputSchema: { type: 'object', properties: {} },
        execute: () => ({
          content: 'hm',
          effects: [{ kind: 'propose-transition', targetSkillId: 'delta', reason: 'data' }],
        }),
      });
      const agent = Agent.create({
        provider,
        model: 'mock',
        maxIterations: 4,
        permissionChecker: PermissionPolicy.fromRoles(
          { support: ['read_skill', 'noop', 'diagnose'] },
          'support',
          { skills: { support: ['gamma', 'delta'] } },
        ),
      })
        .system('s')
        .tool(noop)
        .tool(diagnose)
        .skillGraph(
          skillGraph({
            skills: ['alpha', 'beta', 'gamma', 'delta'].map((id) =>
              defineSkill({ id, description: `${id} does things`, body: `${id}_BODY` }),
            ),
            start: 'alpha',
            steps: [
              { from: 'alpha', to: 'beta', onToolReturn: 'noop' },
              { from: 'alpha', to: 'gamma', onToolReturn: 'noop' },
              { from: 'gamma', to: 'delta', onToolReturn: 'noop' },
            ],
            check: 'off',
          }),
        )
        .watch({
          id: 'w',
          onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
            if (e.name === 'agentfootprint.tools.effect') effectsSeen.push(e.payload ?? {});
          },
        })
        .build();
      await agent.run({ message: 'go' });
      const refusal = results.find((r) => r.includes('[tool effect refused:'));
      expect(refusal).toBeDefined();
      expect(refusal).toContain("'delta' is not reachable from the skill the cursor stood in");
      // Named: the visible hop. Not named: the hidden hop and the hidden cursor.
      expect(refusal).toContain('(reachable: gamma)');
      for (const r of results) expect(hiddenIdsNamed(r, ['alpha', 'beta'])).toEqual([]);
      // The event's refusalReason is the same sentence, so it is filtered too;
      // its `targetSkillId` is the tool's own proposal and stays.
      expect(effectsSeen[0]).toMatchObject({ outcome: 'refused', targetSkillId: 'delta' });
      expect(hiddenIdsNamed(String(effectsSeen[0]?.refusalReason), ['alpha', 'beta'])).toEqual([]);
    });

    it('the unknown-tool roster never names a tool a hidden skill brought', async () => {
      // The roster read the dispatch map raw, so it named the tools of a skill
      // this role may not see — the leak the refusals had just closed, one
      // sentence over. `ghost` is allowlisted for the role and registered by
      // nobody, so the call reaches the unknown-tool door.
      const vault = defineTool({
        name: 'vault_open_safe',
        description: 'opens the safe',
        inputSchema: { type: 'object', properties: {} },
        execute: () => 'opened',
      });
      const results: string[] = [];
      const script = [
        { content: '', toolCalls: [{ id: 'c1', name: 'ghost', args: {} }] },
        { content: 'done', toolCalls: [] },
      ];
      let i = 0;
      const provider = mock({
        respond: (req: { messages?: ReadonlyArray<{ role: string; content: unknown }> }) => {
          for (const m of req.messages ?? [])
            if (m.role === 'tool') results.push(String(m.content));
          return (script[i++] ?? { content: 'done', toolCalls: [] }) as never;
        },
      });
      const agent = Agent.create({
        provider,
        model: 'mock',
        maxIterations: 4,
        permissionChecker: PermissionPolicy.fromRoles(
          { support: ['read_skill', 'noop', 'ghost'] },
          'support',
          { skills: { support: ['alpha'] } },
        ),
      })
        .system('s')
        .tool(noop)
        .skillGraph(
          skillGraph({
            skills: [
              defineSkill({ id: 'alpha', description: 'alpha does things', body: 'alpha_BODY' }),
              defineSkill({
                id: 'beta',
                description: 'beta does things',
                body: 'beta_BODY',
                tools: [vault],
              }),
            ],
            start: 'alpha',
            steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'noop' }],
            check: 'off',
          }),
        )
        .build();
      await agent.run({ message: 'go' });
      const unknown = results.find((r) => r.includes('Unknown tool'));
      expect(unknown).toBeDefined();
      expect(unknown).toContain("Unknown tool 'ghost' on that call.");
      // THE DEFECT: `vault_open_safe` belongs to a skill this role may not see
      // and had never appeared on any request's wire.
      expect(unknown).not.toContain('vault_open_safe');
      for (const r of results) expect(hiddenIdsNamed(r, ['beta'])).toEqual([]);
      // Filtered, not muted: what the role may be told about is still named.
      expect(unknown).toContain('read_skill');
      expect(unknown).toContain('noop');
    });
  });

  it('every menu a graph run composes passes the banned-sentence checker', async () => {
    // The description is a model-facing surface and is checked as one — the
    // list is shared with `test/skillGraphSelfCall.test.ts`, so a clause banned
    // there cannot be legal here by nobody having looked.
    for (const visible of [['gamma'], ['alpha', 'gamma'], [...graphSkills]]) {
      for (const menu of await graphMenus(visible)) {
        expect(unprovable(menu, GRAPH_TOOL_DESCRIPTION)).toEqual([]);
      }
    }
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('fail closed, and never leak the body', () => {
  it("a 'tool-only' hidden skill never returns its body — the refusal lands before execute", async () => {
    const results: string[] = [];
    const agent = buildAgent({
      checker: policyFor('support'),
      toolOnly: true,
      script: [
        { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'payroll' } }] },
        { content: 'done' },
      ],
    });
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push(String((e.payload as { result: unknown }).result));
    });
    await agent.run({ message: 'go' });
    expect(results.at(-1)).not.toContain('payroll_BODY');
  });

  it('a checker that throws hides every skill rather than advertising an unanswered one', async () => {
    const checker: PermissionChecker = {
      name: 'down',
      governs: ['skill_read'],
      check: (r) => {
        if (r.capability === 'skill_read') throw new Error('policy hub unreachable');
        return { result: 'allow' };
      },
    };
    const menus = await menusFor(checker);
    expect(menus[0]).toContain('No skills are available to you');
  });
});

// ─── P7 ROI — the target convention has ONE owner ────────────────────

describe('the skill: target convention', () => {
  it('round-trips, and tolerates a bare id', () => {
    expect(skillTarget('refunds')).toBe('skill:refunds');
    expect(skillIdFromTarget('skill:refunds')).toBe('refunds');
    expect(skillIdFromTarget('refunds')).toBe('refunds');
  });

  it('keeps a skill and a tool of the same name apart', async () => {
    const policy = PermissionPolicy.fromRoles({ r: ['refunds'] }, 'r', {
      skills: { r: [] },
    });
    // The TOOL named `refunds` is allowed…
    expect(
      (await policy.check({ capability: 'tool_call', actor: 'a', target: 'refunds' })).result,
    ).toBe('allow');
    // …and the SKILL named `refunds` is not.
    expect(
      (await policy.check({ capability: 'skill_read', actor: 'a', target: 'skill:refunds' }))
        .result,
    ).toBe('deny');
  });
});
