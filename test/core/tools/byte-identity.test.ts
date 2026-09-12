/**
 * BYTE-IDENTITY — a run with NO tool-name collision records exactly what it
 * recorded before 9.92.0.
 *
 * 9.92.0 changed how a tool call is RESOLVED (dispatch follows the offer) and
 * what the tools slot REPORTS (`tools.shadowed` re-subjected, `tools.claim_swallowed`
 * added). Neither may touch a run in which every tool name has one claimant:
 * the commit log and the served view of every epoch must be the bytes they
 * were. The references under `./reference/` were generated on the 9.91.0 tree
 * BEFORE any source edit of that release (the shared-reference pair on a
 * 9.91.0 worktree, after the review that asked for it), by this same file in
 * update mode:
 *
 *   AF_TOOLS_REFERENCE=update npx vitest run test/core/tools/byte-identity.test.ts
 *
 * REGENERATED ON 9.93.0, and the whole delta against the 9.92.1 references is
 * on record here because a regeneration is a chance to lose the law: the
 * 9.92.1 references were re-run on the 9.92.1 tree first (16/16 green), the
 * two sets were diffed field by field, and EVERY moved path is one 9.93.0
 * moved on purpose — the receipt's new `cache.strategy` key (`'*'` on the
 * twelve agent fixtures, `null` on the two message-API ones; `llmcall`'s
 * receipt lives in its subflow log, outside this projection), the
 * `cache-transform` gap's `fields` growing by `cache.strategy`,
 * `tools.forced` and `tools.withheld` on every agent view, and that gap
 * LEAVING the three views whose receipt says no strategy ran
 * (`llmcall`, `message-api-chart`, `agent-message-api-chart-one-turn`).
 * No message, no tool, no other key moved on any fixture.
 *
 * ONE REFERENCE REGENERATED ON 9.94.3 (`agent-shared-tool-reference`), and
 * the delta is one path: `cacheMarkers` at the iteration-4 merge-back,
 * `[]` → the two markers the cache decision computed. The `[]` was a
 * PHANTOM: the parent writes `skillHistory` with `undefined` for "no skill
 * yet", footprintjs < 9.24.0 round-tripped that array through JSON on the
 * scope write (`undefined` → `null`), and `detectSkillChurn` counted the
 * `null` as a third skill and switched caching off. The gate ignores every
 * non-string slot now; the regenerated reference is green on BOTH the
 * lockfile's footprintjs 9.21.1 and 9.24.0 (verified), so what it pins is
 * the gate, not the substrate's byte shape.
 *
 * Every scenario is a real run — the receipt-conformance shapes, each in the
 * configuration that has no name collision — and what is compared is the
 * whole `commitLog` plus `servedAt(k)` for every located epoch, after ONE
 * normalisation: the values that differ between two runs of the same
 * configuration (run ids, salted digests, clocks) are replaced by a marker.
 * Nothing else is dropped, so a new key, a reordered list or a changed verb
 * anywhere in the log fails here by name.
 *
 * Deliberately NOT here: a multi-turn `buildAgentMessageApiChart` run. Its
 * tools slot accumulated across turns until 9.92.0 (`['weather','weather']` on
 * turn 2) and the fix changes those bytes on purpose; the single-turn shape of
 * the same chart IS here, because turn 1 was never affected.
 *
 * Test types (Convention 3): regression (every scenario) / integration (every
 * run is real) / documentation (the reference files are a readable record of
 * what a run commits).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor, type FlowChart } from 'footprintjs';
import {
  Agent,
  defineTool,
  epochLocations,
  LLMCall,
  servedAt,
  type AgentRunResult,
} from '../../../src/index.js';
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import { buildAgentMessageApiChart } from '../../../src/core/agent/buildAgentMessageApiChart.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { skillScopedTools, staticTools } from '../../../src/tool-providers/index.js';
import type { LLMRequest, LLMResponse, LLMToolSchema } from '../../../src/adapters/types.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;

function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'byte-identity-mock',
    carriesForcedToolChoice: true,
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
      i += 1;
      return {
        content: reply.content,
        toolCalls: reply.toolCalls ?? [],
        usage: { input: 0, output: 0 },
      };
    },
  };
}

const answer = (content: string): Reply => ({ content });
const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

const TOOL_THEN_DONE = [call('c1', 'alpha_tool'), answer('done')];

const graphOf = () =>
  skillGraph({
    skills: [
      defineSkill({
        id: 'alpha',
        description: 'alpha does things',
        body: 'ALPHA_BODY',
        tools: [tool('alpha_tool')],
      } as never),
      defineSkill({
        id: 'beta',
        description: 'beta does things',
        body: 'BETA_BODY',
        tools: [tool('beta_tool')],
      } as never),
    ],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

type Build = (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>;

async function agentRun(
  reactMode: 'dynamic' | 'dynamic-grouped',
  script: readonly Reply[],
  build: Build,
  options: { maxIterations?: number } = {},
): Promise<Snapshot> {
  const agent = build(
    Agent.create({
      provider: scripted(script) as never,
      model: 'mock',
      maxIterations: options.maxIterations ?? 6,
      reactMode,
    }),
  ).build();
  const result: AgentRunResult = await agent.run({ message: 'go' });
  void result;
  return agent.getSnapshot()!;
}

async function chartRun(chart: FlowChart, message: string): Promise<Snapshot> {
  const executor = new FlowChartExecutor(chart);
  await executor.run({ input: { message } });
  return executor.getSnapshot() as unknown as Snapshot;
}

const WEATHER: LLMToolSchema = {
  name: 'weather',
  description: 'Get weather for a city',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
};

// ─── the scenarios — every collision-free shape the conformance suite drives ──

const SCENARIOS: Record<string, () => Promise<Snapshot>> = {
  'agent-dynamic-static-tool': () =>
    agentRun('dynamic', TOOL_THEN_DONE, (a) => a.system('you are a bot').tool(tool('alpha_tool'))),
  'agent-grouped-static-tool': () =>
    agentRun('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    ),
  'agent-dynamic-graph-hop': () =>
    agentRun('dynamic', TOOL_THEN_DONE, (a) => a.system('you are a bot').skillGraph(graphOf())),
  'agent-grouped-graph-hop': () =>
    agentRun('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').skillGraph(graphOf()),
    ),
  'agent-stepped-skill': () =>
    agentRun('dynamic', [call('c1', 'lookup'), answer('done'), answer('done')], (a) =>
      a.system('bot').skillGraph(
        skillGraph({
          skills: [
            defineSkill({
              id: 'refund',
              description: 'refunds',
              body: 'REFUND_BODY',
              tools: [tool('lookup'), tool('charge')],
              steps: [
                { tool: 'lookup', note: 'find the order first' },
                { tool: 'charge', note: 'refund the charge' },
              ],
            } as never),
          ],
          start: 'refund',
          steps: [],
          check: 'off',
        }),
      ),
    ),
  'agent-parked-map': () =>
    agentRun('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('bot').skillGraph(graphOf()).maps({ renewalGrace: 1 }),
    ),
  'agent-wrap-up': () =>
    agentRun(
      'dynamic',
      [call('c1', 'alpha_tool'), call('c2', 'alpha_tool'), call('c3', 'alpha_tool')],
      (a) => a.system('bot').tool(tool('alpha_tool')),
      { maxIterations: 2 },
    ),
  'agent-tool-forced': async () => {
    const parse = (value: unknown): { ok: true; value: { ok: boolean } } => ({
      ok: true,
      value: value as { ok: boolean },
    });
    const agent = Agent.create({
      provider: scripted([
        { content: '', toolCalls: [{ id: '1', name: 'respond_with_schema', args: { ok: true } }] },
      ]) as never,
      model: 'mock',
    })
      .system('bot')
      .outputSchema({ safeParse: parse } as never, {
        strategy: 'tool-forced',
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      })
      .build();
    await agent.run({ message: 'go' });
    return agent.getSnapshot()!;
  },
  // A provider beside a static tool and a skill — three sources, no shared name.
  'agent-provider-three-sources': () =>
    agentRun(
      'dynamic',
      [
        call('c1', 'probe'),
        call('c2', 'calc'),
        call('c3', 'read_skill', { id: 'alpha' }),
        answer('done'),
      ],
      (a) =>
        a
          .system('bot')
          .tool(tool('calc'))
          .skillGraph(graphOf())
          .toolProvider(staticTools([tool('probe')])),
    ),
  // The skill-scoped provider: out of the offer, out of dispatch, then in.
  'agent-scoped-provider': () =>
    agentRun(
      'dynamic',
      [
        call('c1', 'refund_tool'),
        call('c2', 'read_skill', { id: 'billing' }),
        call('c3', 'refund_tool'),
        answer('done'),
      ],
      (a) =>
        a
          .system('bot')
          .skill(defineSkill({ id: 'billing', description: 'billing questions', body: 'B' }))
          .toolProvider(skillScopedTools('billing', [tool('refund_tool')])),
    ),
  // Two skills sharing ONE Tool reference (documented-legal): one implementation,
  // two declarations — nothing is contested, nothing may be reported.
  'agent-shared-tool-reference': async () => {
    const shared = tool('shared_tool');
    return agentRun(
      'dynamic',
      [
        call('c1', 'read_skill', { id: 'desk-a' }),
        call('c2', 'shared_tool'),
        call('c3', 'read_skill', { id: 'desk-b' }),
        call('c4', 'shared_tool'),
        answer('done'),
      ],
      (a) =>
        a
          .system('bot')
          .skill(
            defineSkill({
              id: 'desk-a',
              description: 'desk a',
              body: 'A',
              tools: [shared],
            } as never),
          )
          .skill(
            defineSkill({
              id: 'desk-b',
              description: 'desk b',
              body: 'B',
              tools: [shared],
            } as never),
          ),
    );
  },
  // `.toolsFromActiveSkill()` — a scoped tool rides only after activation.
  'agent-from-active-skill': () =>
    agentRun(
      'dynamic',
      [call('c1', 'read_skill', { id: 'desk' }), call('c2', 'desk_tool'), answer('done')],
      (a) =>
        a
          .system('bot')
          .skill(
            defineSkill({
              id: 'desk',
              description: 'a desk',
              body: 'DESK',
              tools: [tool('desk_tool')],
            } as never),
          )
          .toolsFromActiveSkill(),
    ),
  llmcall: async () => {
    const one = LLMCall.create({ provider: scripted([answer('done')]) as never, model: 'mock' })
      .system('you are a probe')
      .build();
    await one.run({ message: 'the one turn that went out' });
    return one.getSnapshot()! as unknown as Snapshot;
  },
  'message-api-chart': () =>
    chartRun(
      buildMessageApiChart({
        provider: scripted([answer('done')]) as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
        tools: [WEATHER],
        getRunId: () => 'run-message-api-reference',
      }),
      'weather in paris?',
    ),
  'agent-message-api-chart-one-turn': () =>
    chartRun(
      buildAgentMessageApiChart({
        provider: scripted([answer('sunny')]) as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
        tools: [WEATHER],
        getRunId: () => 'run-agent-message-api-reference',
      }),
      'weather in paris?',
    ),
};

// ─── normalisation — only what differs between two runs of ONE configuration ──

/** A digest: the receipt's run-salted 16-hex fingerprints, or a full sha256. */
const DIGEST = /^(?:[0-9a-f]{16}|[0-9a-f]{64})$/;
const RUN_ID = /^run_[0-9a-z_-]+$/i;
/** Keys whose values are clocks or run-minted identifiers. */
const VOLATILE_KEYS = new Set(['runId', 'traceId', 'timestamp', 'at', 'conversationId']);
/** …and every clock reading, whatever it is called (`turnStartMs`, `startedAt`). */
const CLOCK_KEY = /(?:Ms|At)$/;

function normalise(value: unknown, key?: string): unknown {
  if (key !== undefined && (VOLATILE_KEYS.has(key) || CLOCK_KEY.test(key))) return '<volatile>';
  if (typeof value === 'string') {
    if (DIGEST.test(value)) return '<digest>';
    if (RUN_ID.test(value)) return '<run-id>';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = normalise((value as Record<string, unknown>)[k], k);
    }
    return out;
  }
  return value;
}

/** What a scenario is judged by: the whole log, and the served view of every epoch. */
function projection(snapshot: Snapshot): unknown {
  const epochs = epochLocations(snapshot).map((l) => l.epoch);
  return normalise({
    commitLog: JSON.parse(JSON.stringify(snapshot.commitLog)),
    served: epochs.map((epoch) => ({
      epoch,
      view: JSON.parse(JSON.stringify(servedAt(snapshot, epoch) ?? null)),
    })),
  });
}

const REFERENCE_DIR = new URL('./reference/', import.meta.url);
const referencePath = (name: string): URL => new URL(`${name}.json`, REFERENCE_DIR);
const UPDATE = process.env.AF_TOOLS_REFERENCE === 'update';

// ─── the law ─────────────────────────────────────────────────────────

describe('byte-identity — a collision-free run records what it recorded before 9.92.0', () => {
  for (const [name, drive] of Object.entries(SCENARIOS)) {
    it(name, async () => {
      const observed = projection(await drive());
      const text = `${JSON.stringify(observed, null, 2)}\n`;
      if (UPDATE) {
        mkdirSync(REFERENCE_DIR, { recursive: true });
        writeFileSync(referencePath(name), text);
      }
      expect(existsSync(referencePath(name)), `no reference for ${name}`).toBe(true);
      const reference = JSON.parse(readFileSync(referencePath(name), 'utf8')) as unknown;
      expect(observed).toEqual(reference);
    });
  }

  it('the normalisation is stable: two runs of one configuration project identically', async () => {
    // The guard on the guard. If a run-minted value slipped past the
    // normaliser, every reference would fail on the next machine and the
    // failure would look like a behaviour change. Two live runs of the same
    // shape must agree before any reference is trusted.
    const a = projection(await SCENARIOS['agent-provider-three-sources']!());
    const b = projection(await SCENARIOS['agent-provider-three-sources']!());
    expect(a).toEqual(b);
  });
});

// Keep `flowChart` referenced: a chart built inline is the shape both message
// API scenarios exercise through the exported builders.
void flowChart;
