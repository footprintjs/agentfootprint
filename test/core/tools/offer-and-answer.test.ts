/**
 * THE OFFER AND THE ANSWER — one party per tool name, or the record says so.
 *
 * `docs/design/2026-09-the-offer-and-the-answer.md` (9.92.0) closes recorded-not-built
 * entries 1, 2 and 3, the `claim-swallowed` family under entry 1, and the
 * 9.91.0 tools-slot follow-up. The law it states:
 *
 *   For every tool name on a call, exactly one party owns the OFFER and the
 *   same party owns the ANSWER — or the record names the disagreement.
 *
 * The five reproductions below are the entries' own, driven through the
 * divergence walk's harness (`toolDivergenceWalk.harness.ts`) so they stage the
 * SAME configurations the walk records — every one was RED on 9.91.0:
 *
 *   1. entry 1  — an inactive skill's tool answered a call the model made
 *                 against the provider's contract, and nothing was reported;
 *   2. entry 2  — the shadow report named the provider as the schema's source
 *                 on an epoch whose wire carried the skill's contract;
 *   3. entry 3  — a provider's `skip_step` was on the wire and the framework's
 *                 answered, advancing a procedure on a misread contract;
 *   4. entry 1's `claim-swallowed` bullet — 22 baseline rows where a claimant
 *                 lost the wire AND the dispatch and was never named;
 *   5. the 9.91.0 follow-up — `buildAgentMessageApiChart` handed the model
 *                 `['weather','weather']` on turn 2;
 *   6. the review of the first 9.92.0 tree — the off-wire fallback handed a
 *                 withdrawn provider name, and a fresh-instance resume, to the
 *                 never-activated skill; two skills sharing one `Tool` drew
 *                 events. Each pinned against the walk's own cases.
 *   7. entries 4 + 5, VERIFIED 2026-09-11 against the 9.92.1 dist rather than
 *                 re-fixed: `.selfExplain()`'s `run_overview` against the three
 *                 skill shapes a build-time reservation cannot see. The law
 *                 already held — dispatch followed the offer on every epoch and
 *                 the losing claim was named — so the entries' verbatim
 *                 reproductions are pinned here, measured, not rebuilt.
 *
 * Test types (Convention 3): regression (all five, verbatim) / integration
 * (every case is a real agent run) / property (4: the whole family, derived
 * from the walk's own claimant vocabulary rather than typed per row).
 */

import { describe, expect, it } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { Agent, defineTool } from '../../../src/index.js';
import { defineSkill } from '../../../src/injection-engine.js';
import { SKILL_SCOPED_TOOLS_ID_PREFIX, staticTools } from '../../../src/tool-providers/index.js';
import { SELF_EXPLAIN_SKILL_ID } from '../../../src/lib/trace-toolpack/selfExplain.js';
import { mock } from '../../../src/llm-providers.js';
import { buildAgentMessageApiChart } from '../../../src/core/agent/buildAgentMessageApiChart.js';
import type { LLMRequest, LLMResponse, LLMToolSchema } from '../../../src/adapters/types.js';
import type { Tool } from '../../../src/core/tools.js';
import {
  answeredBy,
  collisionCases,
  contractOf,
  crossEpochCases,
  drive,
  frameworkCases,
  stampOf,
  type Channel,
  type Observation,
  type WalkCase,
} from '../agent/toolDivergenceWalk.harness.js';

// ─── the walk's cases, by id ─────────────────────────────────────────

const ALL_CASES = (): readonly WalkCase[] => [
  ...collisionCases(),
  ...crossEpochCases(),
  ...frameworkCases(),
];

const caseById = (id: string): WalkCase => {
  const found = ALL_CASES().find((c) => c.id === id);
  if (!found) throw new Error(`the walk no longer stages '${id}'`);
  return found;
};

const runWalkCase = async (id: string): Promise<{ c: WalkCase; obs: Observation }> => {
  const c = caseById(id);
  if (c.scenario === undefined) throw new Error(`'${id}' has no scenario to drive`);
  const obs = await drive(c.scenario);
  if (obs.buildRefusal !== undefined) throw new Error(`'${id}' refused: ${obs.buildRefusal}`);
  return { c, obs };
};

/** The wire's contract for `name` on `epoch` (1-based), as the walk reads it. */
const wireContract = (obs: Observation, epoch: number, name: string): string | undefined => {
  const offered = (obs.offers[epoch - 1] ?? []).find((t) => t.name === name);
  return offered === undefined ? undefined : contractOf(offered.description);
};

const answerImpl = (obs: Observation, callId: string): string | undefined =>
  stampOf(obs.answers.get(callId) ?? '', 'impl');

// ═════════════════════════════════════════════════════════════════════════
// 1. entry 1 — an inactive skill's tool shadows in silence
// ═════════════════════════════════════════════════════════════════════════

describe('1. an inactive skill never answers a call the model made against the provider’s contract', () => {
  it('the provider answers, `tools.shadowed` fires 0×, and the inactive skill’s execute is never called', async () => {
    // Verbatim entry 1: a ToolProvider and a skill both claim `shared_tool`;
    // the agent is `.toolsFromActiveSkill()` and the skill is never activated.
    const skillCalls: string[] = [];
    const inactiveSkillTool = defineTool<Record<string, never>, string>({
      name: 'shared_tool',
      description: 'shared_tool tool [contract:skill-inactive]',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        skillCalls.push('shared_tool');
        return 'shared_tool ran [impl:skill-inactive]';
      },
    }) as unknown as Tool;
    const providerTool = defineTool<Record<string, never>, string>({
      name: 'shared_tool',
      description: 'shared_tool tool [contract:provider]',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'shared_tool ran [impl:provider]',
    }) as unknown as Tool;

    const obs = await drive({
      mount: (b) =>
        b
          .toolProvider(staticTools([providerTool]))
          .skill(
            defineSkill({
              id: 'desk-idle',
              description: 'a desk the model never activates',
              body: 'IDLE DESK',
              tools: [inactiveSkillTool] as never,
            }),
          )
          .toolsFromActiveSkill(),
      plan: [() => [{ name: 'shared_tool' }], () => [{ name: 'shared_tool' }]],
    });

    // The wire carried the provider's contract on every epoch…
    expect(wireContract(obs, 1, 'shared_tool')).toBe('provider');
    expect(wireContract(obs, 2, 'shared_tool')).toBe('provider');
    // …and the provider's implementation is what answered, both times.
    expect(answerImpl(obs, 'e1:shared_tool')).toBe('provider');
    expect(answerImpl(obs, 'e2:shared_tool')).toBe('provider');
    // A tool offered on no epoch of the run ran on no epoch of the run.
    expect(skillCalls).toEqual([]);
    // No two contracts competed for the wire — nothing was shadowed.
    expect(obs.shadowed).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. entry 2 — the shadow report names the wrong source
// ═════════════════════════════════════════════════════════════════════════

describe('2. the shadow report’s `schemaFrom` and `dispatchTo` agree with the wire on every epoch', () => {
  it('a stepped skill and a provider both claim `shared_tool`: the skill’s contract rides, the skill answers, and no report says otherwise', async () => {
    const { obs } = await runWalkCase('collision/provider-then-step-skill');

    // The stepped skill's tools are always visible, so its contract is the
    // wire's on every epoch, and it is the skill that answers.
    for (const epoch of [1, 2, 3]) {
      expect(wireContract(obs, epoch, 'shared_tool'), `epoch ${epoch}`).toBe('step-skill');
    }
    expect(answerImpl(obs, 'e2:shared_tool')).toBe('step-skill');

    // The report, whenever it fires, names the party the wire carried — and
    // that same party as the one that answers. On 9.91.0 every event here
    // said `schemaFrom: 'provider'`.
    const reports = obs.shadowed.filter((e) => e.toolName === 'shared_tool');
    expect(reports.length).toBeGreaterThan(0);
    for (const e of reports) {
      const channel: Channel = 'skill';
      expect(e.schemaFrom, `epoch ${e.iteration}`).toBe(channel);
      expect(e.schemaFromId, `epoch ${e.iteration}`).toBe('desk-stepped');
      expect(e.dispatchTo, `epoch ${e.iteration}`).toBe(channel);
      expect(e.dispatchToId, `epoch ${e.iteration}`).toBe('desk-stepped');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. entry 3 — `skip_step` is shadowable
// ═════════════════════════════════════════════════════════════════════════

describe('3. a provider’s `skip_step` on the wire is the provider’s to answer — the procedure does not advance', () => {
  it('the provider answers, the tenure still stands on step 1, and one report per epoch names the collision', async () => {
    const { obs } = await runWalkCase('framework/skip_step-vs-provider');

    // The provider's contract was on the wire (it merges ahead of the
    // framework's step schema)…
    expect(wireContract(obs, 2, 'skip_step')).toBe('provider');
    // …so the provider's implementation answered. On 9.91.0 the framework's
    // `skip_step` answered here and closed the procedure.
    expect(answerImpl(obs, 'e2:skip_step')).toBe('provider');
    expect(obs.answers.get('e2:skip_step')).not.toContain('skipped');

    // The procedure did NOT advance: epoch 3 still narrows to step 1 — the
    // banner is on the step's tool and `skip_step` is still offered.
    const epoch3 = obs.offers[2] ?? [];
    expect(epoch3.map((t) => t.name)).toContain('skip_step');
    expect(epoch3.find((t) => t.name === 'do_step_one')?.description).toContain('[Step 1 of 1');

    // Reported: the framework's step tool competed for the wire on every
    // epoch the tenure was open and lost it to the provider.
    const reports = obs.shadowed.filter((e) => e.toolName === 'skip_step');
    expect(reports.length).toBeGreaterThan(0);
    for (const e of reports) {
      expect(e.schemaFrom).toBe('provider');
      expect(e.dispatchTo).toBe('provider');
    }
    // One per epoch, never two.
    expect(new Set(reports.map((e) => e.iteration)).size).toBe(reports.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. the `claim-swallowed` family — 22 baseline rows, each now named
// ═════════════════════════════════════════════════════════════════════════

/**
 * The 22 rows the walk's 9.91.0 baseline recorded as `claim-swallowed`, by
 * case id and dead claimant — copied from `toolDivergenceWalk.baseline.json`
 * as it stood before this release, so a re-record cannot move the goalposts.
 */
const SWALLOWED_ROWS: ReadonlyArray<readonly [caseId: string, claimant: string]> = [
  ['collision/mcp-then-skill-static', 'mcp'],
  ['collision/mcp-then-static', 'mcp'],
  ['collision/mcp-then-step-skill', 'mcp'],
  ['collision/provider-then-skill-static', 'provider'],
  ['collision/provider-then-static', 'provider'],
  ['collision/provider-then-step-skill', 'provider'],
  ['collision/skill-static-then-mcp', 'mcp'],
  ['collision/skill-static-then-provider', 'provider'],
  ['collision/static-then-mcp', 'mcp'],
  ['collision/static-then-provider', 'provider'],
  ['collision/step-skill-then-mcp', 'mcp'],
  ['collision/step-skill-then-provider', 'provider'],
  ['framework/present-vs-mcp', 'mcp'],
  ['framework/present-vs-provider', 'provider'],
  ['framework/read_skill-vs-mcp', 'mcp'],
  ['framework/read_skill-vs-provider', 'provider'],
  ['framework/read_skill-vs-skill-active', 'skill-active'],
  ['framework/read_skill-vs-skill-inactive', 'skill-inactive'],
  ['framework/run_overview-vs-mcp', 'framework'],
  ['framework/run_overview-vs-provider', 'framework'],
  ['framework/run_overview-vs-skill-static', 'framework'],
  ['framework/run_overview-vs-step-skill', 'framework'],
];

describe('4. a dead claim is reported — every `claim-swallowed` baseline row names its loser and its winner', () => {
  it('has the 22 rows the design counts', () => {
    expect(SWALLOWED_ROWS).toHaveLength(22);
  });

  for (const [caseId, claimant] of SWALLOWED_ROWS) {
    it(`${caseId} — '${claimant}' is named as the loser`, async () => {
      const { c, obs } = await runWalkCase(caseId);
      const lostChannel = c.claims.get(claimant);
      expect(lostChannel, `the case does not claim '${claimant}'`).toBeDefined();

      const about = obs.swallowed.filter((e) => e.toolName === c.name);
      expect(about.length, 'no claim_swallowed event for the contested name').toBeGreaterThan(0);
      // The loser is named by the channel it claimed the name through — the
      // same vocabulary `tools.shadowed` speaks — and the winner is named
      // beside it. Both halves are what a reader acts on.
      const named = about.filter((e) => e.lostBy === lostChannel);
      expect(
        named.length,
        `no event names '${claimant}' (${lostChannel}) as the loser`,
      ).toBeGreaterThan(0);
      for (const e of named) {
        expect(typeof e.wonBy).toBe('string');
        expect(e.wonBy.length).toBeGreaterThan(0);
        expect(e.iteration).toBeGreaterThanOrEqual(1);
        // A loser and a winner on the same channel with the same id would be
        // one party reported against itself — allowed only for a composed
        // provider that served one name twice.
        if (e.wonBy === e.lostBy && e.wonById === e.lostById) {
          expect(e.wonBy).toBe('provider');
        }
      }
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 5. the 9.91.0 follow-up — the tools slot accumulates across loop turns
// ═════════════════════════════════════════════════════════════════════════

describe('5. buildAgentMessageApiChart hands the model the declared tool set on every turn', () => {
  it('turns 1..3 each serve exactly the declared tools — never `["weather","weather"]`', async () => {
    const WEATHER: LLMToolSchema = {
      name: 'weather',
      description: 'Get weather for a city',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    };
    const served: string[][] = [];
    const provider = mock({
      respond: (req: LLMRequest): LLMResponse => {
        served.push((req.tools ?? []).map((t) => t.name));
        if (served.length < 3) {
          return {
            content: '',
            toolCalls: [{ id: `c${served.length}`, name: 'weather', args: { city: 'paris' } }],
            stopReason: 'tool_use',
          } as LLMResponse;
        }
        return { content: 'sunny', toolCalls: [], stopReason: 'stop' } as LLMResponse;
      },
    });
    const chart = buildAgentMessageApiChart({
      provider: provider as never,
      model: 'mock',
      systemPrompt: 'you are a tutor',
      tools: [WEATHER],
      getRunId: () => 'run-accumulate-follow-up',
    });
    await new FlowChartExecutor(chart).run({ input: { message: 'weather in paris?' } });

    expect(served).toHaveLength(3);
    for (const [turn, names] of served.entries()) {
      expect(names, `turn ${turn + 1}`).toEqual(['weather']);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6. the review of 9.92.0 — the fallback must not reopen what 1–3 closed
// ═════════════════════════════════════════════════════════════════════════

describe('6. a name off the wire is never handed to a party the model was not shown under it', () => {
  it('withdraw-then-call: the provider withdrew the name; the never-activated skill does NOT answer — a recorded refusal does', async () => {
    const { obs } = await runWalkCase('cross-epoch/withdraw-then-call-inactive-skill-holds');
    expect(wireContract(obs, 1, 'shared_tool')).toBe('provider');
    expect(answerImpl(obs, 'e1:shared_tool')).toBe('provider');
    // Epoch 2: off the wire. On the tree the review saw, `[impl:skill-inactive]`
    // answered here with nothing on the record.
    expect(wireContract(obs, 2, 'shared_tool')).toBeUndefined();
    expect(answerImpl(obs, 'e2:shared_tool')).toBeUndefined();
    expect(obs.answers.get('e2:shared_tool')).toContain(
      "Tool 'shared_tool' did not run on that call",
    );
    expect(obs.offWire).toEqual([]);
  });

  it('fresh-instance resume: the served party rides the checkpoint, so an empty closure cannot fall back to the inactive skill', async () => {
    const { obs } = await runWalkCase(
      'cross-epoch/fresh-instance-resume-provider-vs-inactive-skill',
    );
    expect(wireContract(obs, 1, 'shared_tool')).toBe('provider');
    // The provider's list is not resolved on the fresh instance, so the party
    // the model read cannot answer — and nobody else may. On the tree the
    // review saw, `[impl:skill-inactive]` answered here.
    expect(answerImpl(obs, 'e1:shared_tool')).toBeUndefined();
    expect(obs.answers.get('e1:shared_tool')).toContain('did not run on that call');
    expect(obs.offWire).toEqual([]);
  });

  it('a held-out registry tool still dispatches — and `tools.answered_off_wire` now says so, once per call', async () => {
    // The two walk-B shapes that SERVE a name and then take it off the wire:
    // a parked map and an open step tenure.
    for (const [id, name, party] of [
      ['cross-epoch/parked-map', 'get_zone_info', 'zone-audit'],
      ['cross-epoch/step-hold-out', 'export_receipt', 'refund'],
    ] as const) {
      const { obs } = await runWalkCase(id);
      const calls = [...obs.answers.keys()].filter((k) => k.endsWith(`:${name}`));
      const last = calls.at(-1)!;
      const epoch = Number(/^e(\d+):/.exec(last)![1]);
      expect(wireContract(obs, epoch, name), id).toBeUndefined();
      expect(answerImpl(obs, last), id).toBe('skill');
      const said = obs.offWire.filter((e) => e.toolName === name);
      expect(said, id).toHaveLength(1);
      expect(said[0]).toMatchObject({
        toolCallId: last,
        iteration: epoch,
        answeredBy: 'skill',
        answeredById: party,
      });
    }
  });

  it('two skills sharing ONE Tool reference draw nothing — one implementation, nothing swallowed', async () => {
    const shared = defineTool<Record<string, never>, string>({
      name: 'shared_tool',
      description: 'shared_tool tool [contract:shared-ref]',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'shared_tool ran [impl:shared-ref]',
    }) as unknown as Tool;
    const obs = await drive({
      mount: (b) =>
        b
          .skill(defineSkill({ id: 'A', description: 'a', body: 'A', tools: [shared] as never }))
          .skill(defineSkill({ id: 'B', description: 'b', body: 'B', tools: [shared] as never })),
      plan: [
        () => [{ name: 'read_skill', args: { id: 'A' } }],
        () => [{ name: 'shared_tool' }],
        () => [{ name: 'read_skill', args: { id: 'B' } }],
        () => [{ name: 'shared_tool' }],
      ],
    });
    expect(answerImpl(obs, 'e2:shared_tool')).toBe('shared-ref');
    expect(answerImpl(obs, 'e4:shared_tool')).toBe('shared-ref');
    expect(obs.shadowed).toEqual([]);
    expect(obs.swallowed).toEqual([]);
    expect(obs.offWire).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 7. entries 4 + 5 — `.selfExplain()`'s `run_overview` against a skill
// ═════════════════════════════════════════════════════════════════════════

/**
 * MEASURED 2026-09-11 on the 9.92.1 dist, the entries' three cells verbatim
 * (`framework/run_overview-vs-skill-static`, `-vs-skill-inactive`,
 * `-vs-step-skill`), before anything in this packet was edited:
 *
 *   skill-static   e1..e3 wire = [contract:skill-static]; e2 answer = [impl:skill-static]
 *                  shadowed 2× {schemaFrom:skill/desk-static, dispatchTo:skill/desk-static}
 *                  claim_swallowed 2× {lostBy:provider/skill-scoped:self-explain, wonBy:skill/desk-static}
 *   skill-inactive e1 wire = ABSENT; e2..e3 wire = the framework's own contract
 *                  e2 answer = the framework's trace tool (no [impl:] stamp)
 *                  shadowed 0×; claim_swallowed 2× {lostBy:skill/desk-idle, wonBy:provider/skill-scoped:self-explain}
 *   step-skill     e1..e4 wire = [contract:step-skill]; e3 answer = [impl:step-skill]
 *                  shadowed 2× {schemaFrom:skill/desk-stepped, dispatchTo:skill/desk-stepped}
 *                  claim_swallowed 2× {lostBy:provider/skill-scoped:self-explain, wonBy:skill/desk-stepped}
 *
 * Entry 4's worse half — a skill offered on no epoch answering the framework's
 * own contract — and entry 5 — a shadow report naming
 * `provider(skill-scoped:self-explain)` as the schema's source on an epoch whose
 * wire carried the skill's — are both closed by the 9.92.0 law with no
 * mechanism of their own. What is DELIBERATELY still true: `.selfExplain()`'s
 * reservation still reads `this.registry` only, so all three configurations
 * build; the self-explain body still tells the model to start with
 * `run_overview` in the two cells where the skill holds the name; and the
 * framework's pack is named by its implementation id
 * (`skill-scoped:self-explain`) on the PROVIDER channel it rides, not by the
 * word `framework` — the walk's `claims` map declares exactly that.
 */
describe('7. `.selfExplain()`’s `run_overview` against a skill — the offer decides, and the loser is named (entries 4 + 5)', () => {
  const SELF_EXPLAIN_PACK_ID = `${SKILL_SCOPED_TOOLS_ID_PREFIX}${SELF_EXPLAIN_SKILL_ID}`;

  it('always-visible skill: the skill’s contract rides every epoch, the skill answers, and the framework’s pack is the named loser', async () => {
    const { obs } = await runWalkCase('framework/run_overview-vs-skill-static');
    for (const epoch of [1, 2, 3]) {
      expect(wireContract(obs, epoch, 'run_overview'), `epoch ${epoch}`).toBe('skill-static');
    }
    expect(answerImpl(obs, 'e2:run_overview')).toBe('skill-static');
    // The report's subject is the wire: the skill's contract, the skill's answer.
    const reports = obs.shadowed.filter((e) => e.toolName === 'run_overview');
    expect(reports.length).toBeGreaterThan(0);
    for (const e of reports) {
      expect(e).toMatchObject({
        schemaFrom: 'skill',
        schemaFromId: 'desk-static',
        dispatchTo: 'skill',
        dispatchToId: 'desk-static',
      });
    }
    // The dead claim is the framework's own trace pack, named by its
    // implementation id, once per epoch it lost.
    const dead = obs.swallowed.filter((e) => e.toolName === 'run_overview');
    expect(dead.length).toBeGreaterThan(0);
    for (const e of dead) {
      expect(e).toMatchObject({
        lostBy: 'provider',
        lostById: SELF_EXPLAIN_PACK_ID,
        wonBy: 'skill',
        wonById: 'desk-static',
      });
    }
    expect(new Set(dead.map((e) => e.iteration)).size).toBe(dead.length);
  });

  it('never-activated scoped skill: the framework’s own contract rides once self-explain is active, and the framework — never the idle skill — answers it', async () => {
    const { obs } = await runWalkCase('framework/run_overview-vs-skill-inactive');
    // Epoch 1: nobody offers it. Epoch 2: the trace pack's own, unstamped contract.
    expect(wireContract(obs, 1, 'run_overview')).toBeUndefined();
    expect(wireContract(obs, 2, 'run_overview')).toBe('framework');
    // On 9.91.0 this read `[impl:skill-inactive]` — entry 4's worst cell.
    expect(answerImpl(obs, 'e2:run_overview')).toBeUndefined();
    expect(answeredBy(obs.answers.get('e2:run_overview') ?? '')).toBe('framework');
    // The idle skill's contract competed on no epoch, so nothing was shadowed…
    expect(obs.shadowed.filter((e) => e.toolName === 'run_overview')).toEqual([]);
    // …and its reserved claim is reported dead, by name, with the winner beside it.
    const dead = obs.swallowed.filter((e) => e.toolName === 'run_overview');
    expect(dead.length).toBeGreaterThan(0);
    for (const e of dead) {
      expect(e).toMatchObject({
        lostBy: 'skill',
        lostById: 'desk-idle',
        wonBy: 'provider',
        wonById: SELF_EXPLAIN_PACK_ID,
      });
    }
    expect(obs.offWire).toEqual([]);
  });

  it('stepped skill: the report names the wire’s party on every epoch — never `provider(skill-scoped:self-explain)` (entry 5)', async () => {
    const { obs } = await runWalkCase('framework/run_overview-vs-step-skill');
    for (const epoch of [1, 2, 3, 4]) {
      expect(wireContract(obs, epoch, 'run_overview'), `epoch ${epoch}`).toBe('step-skill');
    }
    expect(answerImpl(obs, 'e3:run_overview')).toBe('step-skill');
    const reports = obs.shadowed.filter((e) => e.toolName === 'run_overview');
    expect(reports.length).toBeGreaterThan(0);
    for (const e of reports) {
      expect(e).toMatchObject({
        schemaFrom: 'skill',
        schemaFromId: 'desk-stepped',
        dispatchTo: 'skill',
        dispatchToId: 'desk-stepped',
      });
      expect(e.schemaFromId).not.toBe(SELF_EXPLAIN_PACK_ID);
    }
    const dead = obs.swallowed.filter((e) => e.toolName === 'run_overview');
    expect(dead.length).toBeGreaterThan(0);
    for (const e of dead) {
      expect(e).toMatchObject({ lostBy: 'provider', lostById: SELF_EXPLAIN_PACK_ID });
      expect(e).toMatchObject({ wonBy: 'skill', wonById: 'desk-stepped' });
    }
  });
});

// Keep the agent import live for the reader: every run above is a real one.
void Agent;
