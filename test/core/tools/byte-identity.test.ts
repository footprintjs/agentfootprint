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
 * REGENERATED FOR REQUEST MEASUREMENT against commit 46ed56a: 14 of 15
 * fixtures gained 35 `receipt.requestMeasurement` values and four matching
 * `receipt\u001frequestMeasurement` set-trace rows in grouped commits. A
 * structural comparison against the committed originals found no other delta
 * after removing ONLY those additions from a transient audit copy. No message,
 * tool, cursor, gap or normalizer changed. The running comparison below keeps
 * all new values and traces, so later measurement drift still fails the test.
 *
 * ALL FIFTEEN REGENERATED ON 9.98.1, delta on record: the final branch's
 * MOUNT (`SUBFLOW_IDS.FINAL`) became a milestone, so its bundle on the parent
 * log gained `tags: ['milestone:decision', 'milestone-label:Answer']`. The
 * old and new sets were diffed line by line: on every fixture the only lines
 * that moved are tag lines (zero non-tag differences). No message, no tool,
 * no receipt key moved.
 *
 * 9.101.0: one new reference `agent-findings` (decorated
 * `dynamicToolSchemas[].inputSchema.properties._findings`, the `findingsLedger`
 * key, the `findings-ledger` system piece); none of the 15 moved. The 15 were
 * run on the 9.101.0 tree BEFORE the scenario existed (16/16 green, the
 * reference directory untouched by git), the one scenario was generated
 * alone (`-t agent-findings` under `AF_TOOLS_REFERENCE=update`, the 15 files
 * copied aside first and byte-compared after), and the new reference was
 * diffed path by path against its UNARMED twin — the same script with the
 * `_findings` keys removed, no `.findings()` — 104 moved paths, every one in
 * one of these families: the reserved property on every served schema
 * (`dynamicToolSchemas`, the served view's `tools.schemas`); the
 * `findingsLedger` key with its trace rows (`set` on the first write, the
 * engine's `append` encoding when a fresh array extends the previous one —
 * basis, then standing + basis, then the answer's standing; no conflict);
 * the `findings-ledger` piece everywhere a piece is recorded
 * (`activeInjections`, `activeByslot`, `systemPromptInjections`, the
 * receipt's `system.pieces` / `system.chars`, the served view's system text);
 * the EMISSION itself — the assistant turns' `toolCalls[].args` in `history`
 * / `llmLatestToolCalls` / the served `messages.asSent` carry `_findings`
 * verbatim, and the answer is raw in `call-llm`'s `llmLatestContent` and
 * peeled in the route's; and the receipt's `requestMeasurement` sizes, which
 * grow with the decorated tools slot, the piece and the args. No other key
 * moved. The scenario also pins the peel: its output-schema parser refuses
 * every key it does not know, so the run passes only because `_findings`
 * came off before the judge.
 *
 * `agent-findings` REGENERATED ALONE for step 3 (the answer turn served from
 * the ledger — `findings/serve.ts`, joined by `callLLM · buildCallLLMStage`
 * and recomposed by `servedView · viewOf`); none of the 15 moved (run on the
 * step-3 tree first: 16/16 green, then the one scenario under
 * `AF_TOOLS_REFERENCE=update -t agent-findings` with the 15 copied aside and
 * `cmp`-equal after). The delta against the step-2 reference is 14 paths in
 * exactly three families: (1) the run constant `findingsServe:
 * 'ledger-and-facts'` on seed's commit (`commitLog[0].overwrite`) with its
 * one `set` trace row (the four "moved" trace paths after it are that row's
 * insertion shifting the rest); (2) the findings PIECE on the epoch-3 call —
 * the first call after a standing was declared — `receipt.system.pieces`
 * 3 → 4 (the new row `source: 'findings'`), `receipt.system.chars`/`hash`,
 * the served view's `system.text`, and the four `requestMeasurement` sizes
 * that grow with it; (3) nothing else: no `messages.entries`, no `asSent`,
 * no tool, no gap, no other key. NO ENTRY COLLAPSED in this reference,
 * because the scenario's only judged-noise standing (`c2`) is declared on
 * the ANSWER — after the last wire — and `c1` is a fact, served verbatim
 * under the default mode; the collapse is pinned by
 * `test/core/agent/findings-served.test.ts` and the receipt law for a
 * collapsed entry by `test/lib/time-travel/receipt-conformance.test.ts`.
 *
 * `agent-findings` REGENERATED ALONE once more in step 3's second review
 * (the 15 copied aside and `cmp`-equal after): the piece's header lost its
 * per-iteration anchor ("composed for iteration N" → a constant — the piece
 * joins the ONE system block the cache marker covers, so an unchanged
 * ledger must serve unchanged bytes; `findings/serve.ts` · "The cache").
 * The moved set against the step-2 reference is the SAME 14 paths listed
 * above — only the values inside them moved: the header text at its two
 * sites (the epoch-3 receipt's findings piece and the served `system.text`),
 * that piece's `chars`/`hash`, `receipt.system.chars`/`hash`, and the four
 * `requestMeasurement` sizes. No new path.
 *
 * 9.102.0: one new reference `agent-findings-window` (the findings ledger
 * under `slidingWindow({ keepRecentTurns: 2 })` — eight calls, `c1` and `c3`
 * declared facts, `c2` noise, `c4` ruled-out); none of the 16 moved. The 16
 * were run on the step-4 tree first (16/16 green, the reference directory
 * untouched by git), then the one scenario was generated alone
 * (`-t agent-findings-window` under `AF_TOOLS_REFERENCE=update`, the 16
 * copied aside first and `cmp`-equal after). What the new reference holds —
 * read back from its bytes, not from the script: seven `compactions` records
 * on the compact stage's commits. Iteration 3 removes nothing and names no
 * pin (`c1` is inside the keep window, so the hold is free); iteration 4
 * names `'ledger-fact'` for `c1`'s turn and files `ledgerFacts { pinned:
 * [alpha_tool@1], yielded: 0, limit: 4 }`; iteration 5 drops `c2` and files
 * `droppedStandings: [{ c2, noise }]` beside `droppedObservations`;
 * iteration 6 holds `c1` and `c3` (two `'ledger-fact'` rows) and removes
 * nothing; iterations 7–9 drop `c4` (`ruled-out`), `c5` and `c6` (undeclared
 * — `standing` absent, never defaulted). No `standDown` anywhere (every
 * blocked boundary is followed by progress) and no `observations` block (the
 * recency pin's latest `alpha_tool` result is always inside the keep window
 * and spends no slot). The wire at the last epoch carries `user · c1 · c3 ·
 * c7 · c8`: both facts held past the keep window by the model's claim; the
 * noise and ruled-out results were collapsed to tickets on the epochs that
 * served them (two tickets in the served views) and then left. The
 * `'ledger-fact'` refusal, the `ledgerFacts` block and `droppedStandings`
 * are the ONLY record vocabulary this scenario adds over `agent-findings`;
 * the ledger rows, the piece and the decorated schemas are that scenario's
 * families.
 *
 * 9.102.0 (findings ledger packet 6 — the OFFER): the two ARMED references
 * `agent-findings` and `agent-findings-window` REGENERATED, each ALONE (the
 * other 17 files copied aside first and `cmp`-equal after each run; the 16
 * unarmed references pass untouched on the wired tree, 16/16 before the
 * regeneration). The delta against the 9.102.0 pair, path by path: (1) the
 * offer itself — `dynamicToolSchemas[].inputSchema.properties._findings
 * .properties.previous.items.properties.toolCallId` gains `enum: <the served
 * results with no standing yet, newest first>` and the "one of the ids
 * listed" description on EVERY epoch after the first (2 enum entries over
 * epochs 2–3 in `agent-findings`: `['c1']`, `['c2']`; 11 over epochs 2–9 in
 * the window scenario, each epoch listing exactly the undeclared ids the
 * window left on the wire), in the committed `dynamicToolSchemas` and the
 * served view's `tools.schemas` alike; (2) BECAUSE the offer moves per call,
 * the Tools mount's merge-back now WRITES `dynamicToolSchemas` on those
 * epochs — an `overwrite.dynamicToolSchemas` entry plus one `set` trace row
 * per epoch where 9.102.0 recorded an EMPTY commit (an unchanged decorated
 * list was a no-op merge-back); the seed's epoch-1 list is still the base
 * decoration and still the only write at epoch 1; (3) the findings-module
 * stage's shape: the `proposition` / `predicts` properties on every served
 * `_findings`, one clause on its top description, and the instruction's two
 * new lines at every site that records it (`activeInjections`,
 * `systemPromptInjections` with its `contentHash`, the served `system.text`
 * and `pieces[].text`); (4) the sizes that follow — `receipt.system.chars`
 * and the four `requestMeasurement` numbers on every call-llm commit. No
 * message, no ticket, no ledger row, no window record, no gap and no other
 * key moved on either reference.
 *
 * `agent-findings` and `agent-findings-window` REGENERATED ONCE MORE, each
 * ALONE, in packet 6's second review (the 15 other files copied aside and
 * `cmp`-equal after; the 16 unarmed references green before). The offer now
 * keeps a result the model can still read — a declared FACT or OPEN result
 * stays listed so a later call can revise it; only `noise` and `ruled-out`
 * leave (`findings/offer.ts · offeredResultIds`, `RETIRING_STANDINGS`) — and
 * the instruction's ninth line asks the model to name a result again only
 * to change its standing. The delta, path by path, in FIVE families and no
 * other: (1) the enum — `agent-findings` gains `c1` at epoch 3 (`['c2',
 * 'c1']`, the committed `dynamicToolSchemas` and the served view's
 * `tools.schemas` alike: 2 paths); the window scenario's enum keeps `c1`
 * from epoch 3 on and `c3` from epoch 5 on, so `['c2', 'c1']`, then
 * `['c3', 'c1']` after c2's noise, then `['c4', 'c3', 'c1']`, then
 * `['c5', 'c3', 'c1']` after c4's ruled-out, and so on while the window
 * holds both facts (24 paths); (2) the instruction's revised line at every
 * site that records it (`activeInjections`, `systemPromptInjections` with
 * its `contentHash`, the served `system.text` and `pieces[].text`); (3)
 * `receipt.system.chars` / `hash`; (4) the four `requestMeasurement` numbers
 * on every call-llm commit; (5) nothing else — 28 moved paths on
 * `agent-findings`, 104 on the window scenario, every one in families 1–4.
 * No message, no ticket, no ledger row, no window record and no gap moved:
 * the scenarios' models never named a fact twice, so the record's rows are
 * the rows they were.
 *
 * 9.104.0: one new reference `agent-findings-judge` (the `agent-findings`
 * script with a declared proposition on `c1` and a scripted classifier
 * judging both results — `.findings({ judge })`); none of the 17 moved (the
 * 17 run first on the 9.104.0 tree, copied aside, the one scenario generated
 * alone with `-t agent-findings-judge` under `AF_TOOLS_REFERENCE=update`,
 * `cmp`-equal after). Its delta against `agent-findings`, read by path: 46
 * added, 15 moved, 0 removed. Added: the two `JudgmentRow`s on
 * `findingsLedger` (kind · toolCallId · toolName · source · judge.name ·
 * judge.model · against · standing · the four `probabilities` · confidence ·
 * testsSubject · usage.inputTokens · usage.outputTokens · latencyMs ·
 * iteration — 17 paths each), and the `proposition` / `predicts` the script
 * declares, where the emission lives (`history`, `llmLatestToolCalls`, the
 * served `messages.asSent`) and on the basis row. Moved: the model's own
 * rows shift one index each behind the judgment filed before them, and the
 * commits that carry them. NOT added: a single path under `served.*` for
 * the judge — the piece, the collapse and the wire are `agent-findings`'
 * bytes, which is policy A on the record.
 *
 * 9.105.0: one new reference `agent-tool-choice` (`.toolChoice({ serve: {
 * top: 2 } })` over four tools and a skill; three narrowed calls, one miss);
 * none of the 18 moved (the 18 run first on the 9.105.0 tree — 19/19 green,
 * the reference directory untouched by git — copied aside, the one scenario
 * generated alone with `-t agent-tool-choice` under
 * `AF_TOOLS_REFERENCE=update`, `cmp`-equal after). What it holds, read from
 * its bytes: the `toolChoices` key with a `pick` and an `outcome` row per
 * call (`set` on the first write, the engine's `append` encoding after);
 * `dynamicToolSchemas` narrowed to two tools plus `read_skill` on calls 1, 2
 * and 4 and the full five on call 3 (`after-miss`); the served views'
 * `tools.schemas` and the receipts' `tools.schemaHashes` naming exactly those
 * lists; `toolsInjections` re-numbered to the served set; and the
 * `requestMeasurement` sizes that shrink with the tools slot. The miss on
 * call 2 (`lookup`, narrowed away) is answered off-wire — `history` holds
 * its result as it always would have.
 *
 * 9.106.0: one new reference `agent-ontology` (`.ontology(map)` over one
 * tool — two calls, the map's three nodes, two sources, one edge); none of
 * the 19 moved (the 19 run first on the wired 9.106.0 tree — 20/20 green,
 * the reference directory untouched by git — copied aside, the one scenario
 * generated alone with `-t agent-ontology` under `AF_TOOLS_REFERENCE=update`,
 * `cmp`-equal after). What it holds, read from its bytes: the run constant
 * `ontology` (`{ id, version, hash, spec }`, the whole spec) on seed's commit
 * with its one `set` trace row; the always-on `ontology` instruction
 * everywhere a piece is recorded (`activeInjections`, `activeBySlot`,
 * `systemPromptInjections`, the receipt's `system.pieces`); the ontology
 * PIECE — `source: 'ontology'`, last in the join — on every epoch's receipt
 * (`system.pieces`, `system.chars`/`hash`) and served view (`system.text`);
 * and the `requestMeasurement` sizes that grow with both. No message, no
 * tool, no gap, no other key.
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
  slidingWindow,
  type AgentRunResult,
} from '../../../src/index.js';
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import { buildAgentMessageApiChart } from '../../../src/core/agent/buildAgentMessageApiChart.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { skillScopedTools, staticTools } from '../../../src/tool-providers/index.js';
import { mockClassifier, type ClassifyResult } from '../../../src/classify/index.js';
import { defineOntology } from '../../../src/ontology/index.js';
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
/** A classifier answer ranking `names` highest first — the tool-choice question's shape. */
const rank = (...names: string[]): ClassifyResult => ({
  model: 'jev-1.13.0',
  answers: {
    tool: {
      type: 'choice',
      choice: names[0]!,
      confidence: 0.8,
      probabilities: Object.fromEntries(names.map((n, i) => [n, 0.9 - i * 0.2])),
    },
  },
  usage: { inputTokens: 100, outputTokens: 8 },
  latencyMs: 5,
});
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
  // The findings ledger (9.101.0) — the ONE armed scenario: a basis on two
  // calls, the first result's standing on the second call, and a JSON answer
  // carrying the second result's standing under the top-level `_findings`.
  // The parser refuses every key it does not know, so the run passes only
  // because the reserved key was peeled before the judge (the peel is on the
  // record: `llmLatestContent` is the peeled JSON, `history` is the emission).
  'agent-findings': () =>
    agentRun(
      'dynamic',
      [
        call('c1', 'alpha_tool', {
          q: 'nodes',
          _findings: { basis: 'exploratory', expect: 'low' },
        }),
        call('c2', 'alpha_tool', {
          q: 'node-1',
          _findings: {
            basis: 'direct',
            expect: 'high',
            previous: [
              {
                toolCallId: 'c1',
                standing: 'fact',
                sought: true,
                assertions: [
                  { subject: { kind: 'node', id: 'node-1' }, predicate: 'state', value: 'up' },
                ],
              },
            ],
          },
        }),
        answer(
          JSON.stringify({
            done: true,
            _findings: { previous: [{ toolCallId: 'c2', standing: 'noise' }] },
          }),
        ),
      ],
      (a) =>
        a
          .system('bot')
          .tool(tool('alpha_tool'))
          .findings()
          .outputSchema(
            {
              parse: (value: unknown) => {
                if (value === null || typeof value !== 'object' || Array.isArray(value))
                  throw new Error('not an object');
                const unknown = Object.keys(value as object).filter((k) => k !== 'done');
                if (unknown.length > 0) throw new Error(`unknown keys: ${unknown.join(',')}`);
                return value as { done: boolean };
              },
            } as never,
            { retries: 0 },
          ),
    ),
  // The findings ledger with a JUDGE (9.104.0, `.findings({ judge })`) — the
  // third armed scenario: the `agent-findings` script with a scripted
  // classifier judging each of the two results (`c1` noise against the
  // declared proposition, `c2` fact against the question). What it adds
  // over `agent-findings` is exactly the second source's rows —
  // `judgment:c1` after `basis:c1`, `judgment:c2` after `basis:c2` — and
  // the two `findings.judged` events; the model's own rows, the served
  // piece and the wire are the bytes `agent-findings` records (policy A:
  // nothing is served from a judgment). Generated ALONE with the 17 copied
  // aside and `cmp`-equal after.
  'agent-findings-judge': () =>
    agentRun(
      'dynamic',
      [
        call('c1', 'alpha_tool', {
          q: 'nodes',
          _findings: {
            basis: 'exploratory',
            expect: 'low',
            proposition: 'every node is up',
            predicts: 'a list with no down node',
          },
        }),
        call('c2', 'alpha_tool', {
          q: 'node-1',
          _findings: {
            basis: 'direct',
            expect: 'high',
            previous: [
              {
                toolCallId: 'c1',
                standing: 'fact',
                sought: true,
                assertions: [
                  { subject: { kind: 'node', id: 'node-1' }, predicate: 'state', value: 'up' },
                ],
              },
            ],
          },
        }),
        answer(
          JSON.stringify({
            done: true,
            _findings: { previous: [{ toolCallId: 'c2', standing: 'noise' }] },
          }),
        ),
      ],
      (a) =>
        a
          .system('bot')
          .tool(tool('alpha_tool'))
          .findings({
            judge: mockClassifier([
              {
                model: 'jev-1.13.0',
                answers: {
                  standing: {
                    type: 'choice',
                    choice: 'noise',
                    confidence: 0.59,
                    probabilities: { fact: 0.0, noise: 0.69, open: 0.3, 'ruled-out': 0.01 },
                  },
                  tests_subject: { type: 'noul', noul: 0.19 },
                },
                usage: { inputTokens: 494, outputTokens: 68 },
                latencyMs: 212,
              },
              {
                model: 'jev-1.13.0',
                answers: {
                  standing: {
                    type: 'choice',
                    choice: 'fact',
                    confidence: 0.81,
                    probabilities: { fact: 0.9, noise: 0.05, open: 0.05, 'ruled-out': 0.0 },
                  },
                  tests_subject: { type: 'noul', noul: 0.88 },
                },
                usage: { inputTokens: 480, outputTokens: 66 },
                latencyMs: 180,
              },
            ]),
          })
          .outputSchema(
            {
              parse: (value: unknown) => {
                if (value === null || typeof value !== 'object' || Array.isArray(value))
                  throw new Error('not an object');
                const unknown = Object.keys(value as object).filter((k) => k !== 'done');
                if (unknown.length > 0) throw new Error(`unknown keys: ${unknown.join(',')}`);
                return value as { done: boolean };
              },
            } as never,
            { retries: 0 },
          ),
    ),
  // The findings ledger under a WINDOW (9.102.0) — the second armed scenario:
  // eight calls under `slidingWindow({ keepRecentTurns: 2 })`, two results
  // declared facts (`c1` on the second call, `c3` on the fourth), one noise
  // (`c2`) and one ruled-out (`c4`). The fact turns are held by
  // `'ledger-fact'` past the keep window; the noise and ruled-out turns are
  // collapsed on the wire and then leave oldest-first, each with its
  // standing on the record (`droppedStandings`).
  'agent-findings-window': () =>
    agentRun(
      'dynamic',
      [
        call('c1', 'alpha_tool', { q: 'nodes', _findings: { basis: 'exploratory' } }),
        call('c2', 'alpha_tool', {
          q: 'node-1',
          _findings: {
            basis: 'direct',
            previous: [
              {
                toolCallId: 'c1',
                standing: 'fact',
                sought: true,
                assertions: [
                  { subject: { kind: 'node', id: 'node-1' }, predicate: 'state', value: 'up' },
                ],
              },
            ],
          },
        }),
        call('c3', 'alpha_tool', {
          q: 'node-2',
          _findings: { basis: 'direct', previous: [{ toolCallId: 'c2', standing: 'noise' }] },
        }),
        call('c4', 'alpha_tool', {
          q: 'node-3',
          _findings: {
            basis: 'direct',
            previous: [
              {
                toolCallId: 'c3',
                standing: 'fact',
                sought: true,
                assertions: [
                  { subject: { kind: 'node', id: 'node-2' }, predicate: 'state', value: 'down' },
                ],
              },
            ],
          },
        }),
        call('c5', 'alpha_tool', {
          q: 'node-4',
          _findings: {
            basis: 'exploratory',
            previous: [{ toolCallId: 'c4', standing: 'ruled-out', line: 'node-3 was up' }],
          },
        }),
        call('c6', 'alpha_tool', { q: 'node-5', _findings: { basis: 'exploratory' } }),
        call('c7', 'alpha_tool', { q: 'node-6', _findings: { basis: 'exploratory' } }),
        call('c8', 'alpha_tool', { q: 'node-7', _findings: { basis: 'exploratory' } }),
        answer('done'),
      ],
      (a) =>
        a
          .system('bot')
          .tool(tool('alpha_tool'))
          .findings()
          .window(slidingWindow({ keepRecentTurns: 2 })),
      { maxIterations: 10 },
    ),
  // Tool choice by classifier (9.105.0, `.toolChoice({ serve: { top: 2 } })`)
  // — the fourth armed scenario: four static tools and a skill (so
  // `read_skill` is a door), a scripted classifier ranking a different pair
  // on each of three calls, the model calling a served tool, then a
  // NARROWED-AWAY tool (a miss: the off-wire dispatch answers it, the next
  // call serves the full wire), then answering. What it adds over the
  // unarmed shape is the `toolChoices` key (pick · outcome per call), the
  // narrowed `dynamicToolSchemas` on the calls that narrowed, and the
  // sizes that follow. Generated ALONE with the 18 copied aside and
  // `cmp`-equal after.
  'agent-tool-choice': () =>
    agentRun(
      'dynamic',
      [call('c1', 'charge'), call('c2', 'lookup'), call('c3', 'ship'), answer('done')],
      (a) =>
        a
          .system('bot')
          .tool(tool('lookup'))
          .tool(tool('charge'))
          .tool(tool('ship'))
          .tool(tool('invoice'))
          .skill(defineSkill({ id: 'billing', description: 'billing', body: 'B' }))
          .toolChoice({
            classifier: mockClassifier([
              rank('charge', 'lookup'),
              rank('ship', 'invoice'),
              rank('ship', 'charge'),
              rank('invoice', 'lookup'),
            ]),
            serve: { top: 2 },
          }),
    ),
  'agent-ontology': () =>
    agentRun('dynamic', [call('c1', 'lookup_port', { q: 'p1' }), answer('p1 is down')], (a) =>
      a
        .system('bot')
        .tool(tool('lookup_port'))
        .ontology(
          defineOntology({
            id: 'fleet',
            version: '1',
            sources: {
              inventory: { meaning: 'the switch inventory export', configured: true },
              syslog: { meaning: 'the syslog archive' },
            },
            nodes: {
              port: {
                meaning: 'a physical switch port',
                aliases: ['interface'],
                sources: [{ source: 'inventory', via: ['lookup_port'], coverage: 'all ports' }],
              },
              port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
              outage_ticket: {
                meaning: 'an open incident about a port',
                sources: [{ source: 'syslog' }],
              },
            },
            edges: [
              {
                from: 'port_error_rate',
                to: 'port',
                relation: 'measured-on',
                meaning: 'the port it counts',
              },
            ],
          }),
        ),
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
