/**
 * The read_skill gate stops refusing skills the graph never routed (8.4.0).
 *
 * A skill graph bounds `read_skill` to `graph.reachableSkills(cursor)` so the model
 * cannot leave the graph mid-run. That gate also rejected every skill the graph does
 * not route — including three the library itself puts there:
 *
 *   • `.selfExplain()`'s debug skill — the flagship "ask the agent why it did that"
 *     feature, silently dead under `.skillGraph()`;
 *   • a `.skill()` / `.skills()` registration beside the graph — offered in
 *     read_skill's own menu, then rejected on every call, its body unreachable;
 *   • a skill listed in `skills[]` and wired to nothing — whose own check-up warning
 *     says "it can only be reached by the model via read_skill".
 *
 * All three are now OPEN: admitted from any cursor, activated through their own
 * `llm-activated` trigger, and never moving the cursor (a skill the graph does not
 * route is not a node, so it cannot be a hop). Two clauses decide openness — the
 * trigger kind, and whether the graph declares an incoming edge — and this file pins
 * both, especially the second: a BARE model edge `.route(a, m)` stays `from`-gated.
 */

import { describe, it, expect } from 'vitest';
import { defineTool, Agent } from '../src/index.js';
import { skillGraph, defineSkill } from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import type { LLMResponse } from '../src/adapters/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

const scoped = (id: string) =>
  defineSkill({
    id,
    description: `use ${id}`,
    body: `${id.toUpperCase()} BODY`,
    tools: [tool(`${id}_tool`)],
    autoActivate: 'currentSkill',
  });

const bare = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });

const call = (id: string, name: string, args: Record<string, unknown> = {}): LLMResponse => ({
  content: 'calling',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use',
});

/** A provider that plays a script, then answers. */
const script = (...steps: LLMResponse[]) => {
  let i = 0;
  return mock({
    respond: () =>
      steps[i++] ?? ({ content: 'done', toolCalls: [], stopReason: 'stop' } as LLMResponse),
  });
};

interface RunLog {
  readonly active: Array<{ iteration: number; ids: readonly string[] }>;
  readonly offered: Array<{ iteration: number; names: readonly string[] }>;
  readonly picks: Array<{ iteration: number; id: string }>;
  readonly rejected: Array<{ iteration: number; id: string; allowed: readonly string[] }>;
  readonly results: string[];
}

function watch(agent: {
  on: (n: string, f: (e: { payload: unknown }) => void) => unknown;
}): RunLog {
  const log: RunLog = { active: [], offered: [], picks: [], rejected: [], results: [] };
  agent.on('agentfootprint.context.evaluated', (e) => {
    const p = e.payload as { iteration: number; activeIds: readonly string[] };
    log.active.push({ iteration: p.iteration, ids: [...p.activeIds] });
  });
  agent.on('agentfootprint.stream.llm_start', (e) => {
    const p = e.payload as { iteration: number; tools?: ReadonlyArray<{ name: string }> };
    log.offered.push({ iteration: p.iteration, names: (p.tools ?? []).map((t) => t.name) });
  });
  agent.on('agentfootprint.stream.tool_start', (e) => {
    const p = e.payload as { toolName: string; args: { id?: unknown } };
    if (p.toolName === 'read_skill' && typeof p.args.id === 'string') {
      log.picks.push({ iteration: log.active.length, id: p.args.id });
    }
  });
  agent.on('agentfootprint.stream.tool_end', (e) => {
    log.results.push(String((e.payload as { result: unknown }).result));
  });
  agent.on('agentfootprint.skill.rejected', (e) => {
    const p = e.payload as { requestedId: string; iteration: number; allowed: readonly string[] };
    log.rejected.push({ iteration: p.iteration, id: p.requestedId, allowed: [...p.allowed] });
  });
  return log;
}

/** THE invariant: an accepted `read_skill` claimed the skill would be active next
 *  iteration — so it must be (8.3.0's rule, extended to open skills). */
function assertToldTheTruth(log: RunLog): void {
  for (const pick of log.picks) {
    if (log.rejected.some((r) => r.id === pick.id && r.iteration === pick.iteration)) continue;
    const next = log.active.find((a) => a.iteration === pick.iteration + 1);
    if (next === undefined) continue;
    expect(
      next.ids.includes(pick.id),
      `read_skill("${pick.id}") answered "activated for the next iteration", but iteration ` +
        `${pick.iteration + 1} was [${next.ids.join(', ')}]`,
    ).toBe(true);
  }
}

const cursorOf = (agent: { getLastSnapshot(): { sharedState: unknown } | undefined }) =>
  (agent.getLastSnapshot()?.sharedState as { currentSkillId?: string } | undefined)?.currentSkillId;

// ── the three revived shapes ────────────────────────────────────────────────

describe('read_skill gate — skills the graph never routed are OPEN', () => {
  it('.selfExplain() works under .skillGraph(): the skill loads and unlocks the trace tools', async () => {
    const alpha = scoped('alpha');
    const beta = scoped('beta');
    const graph = skillGraph({
      skills: [alpha, beta],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'throw',
    });
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'self-explain' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .selfExplain()
      .build();
    const log = watch(agent);

    await agent.run({ message: 'why did you do that?' });

    expect(log.results[0]).toBe("Skill 'self-explain' activated for the next iteration.");
    expect(log.rejected).toEqual([]);
    expect(log.active[1]!.ids).toEqual(['alpha', 'self-explain']);
    // The whole point: the trace tools reach the model on the next call.
    expect(log.offered[1]!.names).toEqual(
      expect.arrayContaining([
        'run_overview',
        'trace_node',
        'trace_slice',
        'backtrack',
        'who_wrote',
        'get_value',
      ]),
    );
    expect(log.offered[0]!.names).not.toContain('run_overview'); // only once activated
    expect(cursorOf(agent)).toBe('alpha'); // the graph did not move
    assertToldTheTruth(log);
  });

  it('a .skill() registered beside the graph activates, tools and all, without moving the cursor', async () => {
    const alpha = scoped('alpha');
    const graph = skillGraph({ skills: [alpha], start: 'alpha', check: 'throw' });
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'orphan' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .skill(scoped('orphan'))
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.rejected).toEqual([]);
    expect(log.active[1]!.ids).toEqual(['alpha', 'orphan']);
    expect(log.offered[1]!.names).toContain('orphan_tool');
    expect(cursorOf(agent)).toBe('alpha');
    assertToldTheTruth(log);
  });

  it('a skill listed in skills[] and wired to nothing is reachable — as its check-up says', async () => {
    const alpha = scoped('alpha');
    const beta = scoped('beta');
    const gamma = scoped('gamma'); // in the graph, no edges at all
    const graph = skillGraph({
      skills: [alpha, beta, gamma],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'off',
    });
    // The check-up has always said this; before 8.4.0 the gate made it false. Since
    // 8.7.0 the sentence is told per TRIGGER KIND, and `gamma` — unwired, so it keeps
    // the `llm-activated` default — is the case the old wording described correctly.
    expect(graph.checkup().problems).toEqual([
      {
        kind: 'warning',
        code: 'unreachable-skill',
        message:
          'Skill "gamma" is not reachable from any entry over the graph\'s deterministic edges — ' +
          'the model can still open it by name with read_skill (it is an OPEN skill: the ' +
          "agent's gate admits it from any cursor). Wire an edge to it if the graph is meant " +
          'to route there.',
        skill: 'gamma',
      },
    ]);

    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'gamma' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.rejected).toEqual([]);
    expect(log.active[1]!.ids).toEqual(['alpha', 'gamma']);
    expect(cursorOf(agent)).toBe('alpha');
    assertToldTheTruth(log);
  });
});

// ── what stays bounded ──────────────────────────────────────────────────────

describe('read_skill gate — what the graph DOES wire stays bounded', () => {
  it('a cursor-gated route target out of reach is still refused, message unchanged', async () => {
    const alpha = scoped('alpha');
    const beta = scoped('beta');
    const gamma = scoped('gamma'); // reachable only from beta
    const graph = skillGraph({
      skills: [alpha, beta, gamma],
      start: 'alpha',
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'beta', to: 'gamma', onToolReturn: 'beta_tool' },
      ],
      check: 'throw',
    });
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'gamma' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.results[0]).toBe(
      'read_skill("gamma") is not reachable from here. Reachable skills: beta. ' +
        'Pick one of these, or finish.',
    );
    expect(log.rejected).toEqual([{ iteration: 1, id: 'gamma', allowed: ['beta'] }]);
    expect(log.active[1]!.ids).toEqual(['alpha']);
  });

  it('a BARE model edge stays from-gated — declaring it is not declaring it everywhere', async () => {
    // `.route(a, m)` with no predicate says "from a, the model may hop to m". It is
    // drawn as a dashed edge. Opening every such target would silently globalize it,
    // so a wired skill is bounded by its wiring even though its trigger is
    // llm-activated. From the cursor `b`, `m` is NOT reachable.
    const a = scoped('a');
    const b = scoped('b');
    const m = bare('m');
    const graph = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'a_tool' })
      .route(a, m)
      .build({ check: 'off' });
    const agent = Agent.create({
      provider: script(call('c1', 'a_tool'), call('c2', 'read_skill', { id: 'm' })),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(cursorOf(agent)).toBe('b');
    expect(log.rejected).toEqual([{ iteration: 2, id: 'm', allowed: ['a'] }]);
  });

  it('the same bare edge IS reachable from its declared source (unchanged)', async () => {
    const a = scoped('a');
    const b = scoped('b');
    const m = bare('m');
    const graph = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'a_tool' })
      .route(a, m)
      .build({ check: 'off' });
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'm' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.rejected).toEqual([]);
    expect(log.active[1]!.ids).toEqual(expect.arrayContaining(['m']));
    expect(cursorOf(agent)).toBe('m'); // a declared edge — this one IS a hop
  });

  it('a rule-triggered skill is never admitted — read_skill could not activate it', async () => {
    // The open rule reads the TRIGGER, not the registration site: only a skill whose
    // trigger is `llm-activated` is activated by appending to activatedInjectionIds.
    // Admitting a rule-triggered injection would replace one lie with another — the
    // tool would answer "activated" and nothing would activate. It is still in
    // read_skill's catalog (it is a skill), so the gate is what refuses it.
    const alpha = scoped('alpha');
    const graph = skillGraph({ skills: [alpha], start: 'alpha', check: 'throw' });
    const ruleSkill = {
      ...defineSkill({ id: 'ruled', description: 'r', body: 'R BODY' }),
      trigger: { kind: 'rule' as const, activeWhen: () => false },
    };
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'ruled' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .injection(ruleSkill)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.rejected.map((r) => r.id)).toEqual(['ruled']);
    expect(log.active.flatMap((a) => a.ids)).not.toContain('ruled');
  });
});

// ── the allowed set the model is told about ─────────────────────────────────

describe('read_skill gate — the re-prompt names every id the gate accepts', () => {
  it('lists hops AND open skills, in that order, de-duplicated', async () => {
    const alpha = scoped('alpha');
    const beta = scoped('beta');
    const gamma = scoped('gamma');
    const graph = skillGraph({
      skills: [alpha, beta, gamma],
      start: 'alpha',
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'beta', to: 'gamma', onToolReturn: 'beta_tool' },
      ],
      check: 'throw',
    });
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'gamma' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .skill(bare('helper'))
      .selfExplain()
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.results[0]).toBe(
      'read_skill("gamma") is not reachable from here. Reachable skills: beta, helper, ' +
        'self-explain. Pick one of these, or finish.',
    );
    expect(log.rejected[0]!.allowed).toEqual(['beta', 'helper', 'self-explain']);
  });

  it('a graph with no open skills reports exactly the set it always did', async () => {
    const alpha = scoped('alpha');
    const beta = scoped('beta');
    const gamma = scoped('gamma');
    const graph = skillGraph({
      skills: [alpha, beta, gamma],
      start: 'alpha',
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'beta', to: 'gamma', onToolReturn: 'beta_tool' },
      ],
      check: 'throw',
    });
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'gamma' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.rejected[0]!.allowed).toEqual(['beta']);
  });

  it('an agent with no skill graph is untouched — the gate is off', async () => {
    const agent = Agent.create({
      provider: script(call('c1', 'read_skill', { id: 'anything' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skill(bare('anything'))
      .build();
    const log = watch(agent);

    await agent.run({ message: 'hi' });

    expect(log.rejected).toEqual([]);
    expect(log.active[1]!.ids).toEqual(['anything']);
  });
});

// ── the resolver the graph exposes is unchanged ─────────────────────────────

describe('graph.reachableSkills — still graph-only, unchanged by the open rule', () => {
  it('answers successors ∪ entries minus the cursor, knowing nothing about the agent', () => {
    const a = scoped('a');
    const b = scoped('b');
    const m = bare('m');
    const graph = skillGraph().entry(a).route(a, b, { onToolReturn: 'a_tool' }).route(a, m).build({
      check: 'off',
    });
    expect(graph.reachableSkills()).toEqual(['a']);
    expect(graph.reachableSkills('a')).toEqual(['b', 'm']);
    expect(graph.reachableSkills('b')).toEqual(['a']);
  });
});
