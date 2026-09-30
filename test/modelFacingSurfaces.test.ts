/**
 * THE INVENTORY — every model-facing producer `test/helpers/modelFacingClaims.ts`
 * is responsible for, and proof that each one is actually read by the checker.
 *
 * ── WHY A REGISTRY AND NOT MORE ASSERTIONS ────────────────────────────────
 *
 * Round 3 of the skill-graph cursor bug shipped WITH the checker already
 * written. The banned sentence did not defeat it; the sentence moved forty
 * lines, into the `read_skill` description, and the suite that owned the
 * checker did not read that surface. Nothing went red, because coverage was
 * decided by which suite happened to import the helper — a habit, not a
 * guarantee.
 *
 * So the producers are listed HERE. Each row composes the producer's REAL
 * output by calling the shipped code (never a copy of the sentence), and every
 * row is read by `unprovable()` at its own surface. A registered producer
 * cannot be an unchecked one: the row IS the check, whatever any other suite
 * does or stops doing.
 *
 * ── WHAT A GREEN RUN HERE DOES NOT PROVE ──────────────────────────────────
 *
 * The list is hand-maintained, so it proves exactly one thing: REGISTERED
 * producers are checked. It cannot see a producer nobody registered. A new
 * model-facing sentence written into a new file tomorrow is invisible here
 * until somebody adds the row — which is precisely the shape of the round-3
 * escape, one level up.
 *
 * That gap was written down here as a caveat, and it was really a prediction:
 * the `read_skill` gate's refusals and the trace toolpack were both live
 * producers matching the checker's own rules, and neither had a row. Both are
 * registered below now, and the gap itself is closed from the other side by
 * `test/modelFacingScan.test.ts`, which walks `src/` for sentence-shaped
 * literals and fails on one nobody has accounted for. The two are different
 * instruments and both are needed: the scan reads LITERALS and cannot see the
 * sentence a producer actually composes; the rows here compose the real
 * output. Still read a green run here as "the producers we registered are
 * clean", never as "every model-facing sentence in the library is clean".
 *
 * `drivenBy` names the suites that exercise a producer END TO END through a
 * real agent. It is documentation for the reader and is checked only for
 * existence: the checker coverage comes from the row itself, so a producer
 * whose end-to-end suite is renamed loses a pointer, not its checking.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  absent,
  Agent,
  codeRunnerTool,
  coverage,
  defineTool,
  describedResult,
  inMemoryArtifacts,
  isInputPause,
  requestInput,
  semantic,
  type ArtifactScope,
  type CodeRunner,
} from '../src/index.js';
import {
  callTraceTool,
  innerRunStore,
  recordRun,
  traceToolpack,
  type TraceToolpackArtifacts,
} from '../src/observe.js';
import {
  composeReadSkillRefusal,
  notDispatchedResult,
  unknownToolResult,
} from '../src/core/agent/stages/toolCalls.js';
import { servedToModel } from '../src/core/agent/coverage/read.js';
import { semanticsForModel } from '../src/lib/semantics/envelope.js';
import { WRAP_UP_INSTRUCTION } from '../src/core/agent/stages/wrapUp.js';
import {
  FINDINGS_ANSWER_ASK,
  FINDINGS_ARGUMENT_SCHEMA,
  FINDINGS_FROM_PROPERTY,
  FINDINGS_INSTRUCTION,
  FINDINGS_SOURCES_SCHEMA,
  findingsInstructionFor,
} from '../src/core/agent/findings/reserved.js';
import { findingsLedgerPiece } from '../src/core/agent/findings/serve.js';
import {
  filledNote,
  keptAnswersNote,
  secondPauseRefusal,
  timeRefusal,
  timeLimitsSentence,
  timeWindowsLine,
  unansweredRefusal,
  unmountedRulesRefusal,
  unreadableRulesRefusal,
  withArgumentRules,
} from '../src/core/agent/arguments/serve.js';
import { rulesOf } from '../src/core/agent/arguments/declare.js';
import { periodCheckLine } from '../src/core/agent/coverage/period.js';
import {
  factExpectation,
  WINDOW_FORM_EXPECTATION,
  WINDOW_ZONE_EXPECTATION,
} from '../src/core/agent/arguments/ask.js';
import { SHOWN_ARGS } from '../src/core/toolShownArgs.js';
import { defineOntology, ONTOLOGY_INSTRUCTION, ontologyPiece } from '../src/ontology/index.js';
import type { FindingsLedger } from '../src/core/agent/findings/types.js';
import {
  nudgeTeachingMessage,
  type StepPlan,
  type StepPointer,
} from '../src/lib/injection-engine/skillSteps.js';
import { mock } from '../src/llm-providers.js';
import { defineSkill } from '../src/injection-engine.js';
import { selfCallNotice } from '../src/core/agent/selfCallNotice.js';
import {
  readSkillDescriptor,
  type ReadSkillOffer,
} from '../src/lib/injection-engine/skillToolDescriptors.js';
import { presentArtifact } from '../src/artifacts/present.js';
import { standingLineOf } from '../src/core/agent/assessment/compose.js';
import { resolveToolWants } from '../src/artifacts/wants.js';
import { parkCard } from '../src/maps/engagement/parkCard.js';
import type {
  EngagementPlan,
  MapEngagement,
  MapEngagementRecord,
} from '../src/maps/engagement/types.js';
import {
  unprovable,
  BANNED_CLAUSES,
  INJECTED_TURN,
  TOOL_RESULT,
  GRAPH_TOOL_DESCRIPTION,
  PARK_CARD,
  type Surface,
} from './helpers/modelFacingClaims.js';

/** One model-facing producer, and how to make it speak. */
interface ModelFacingProducer {
  /** What a reader greps for when this row goes red. */
  readonly id: string;
  /** The file that composes the sentences — the one to open. */
  readonly module: string;
  readonly surface: Surface;
  /** The evidence for `surface.lifetime`. An asserted lifetime is an exemption
   *  with no argument, which is how a false sentence gets waved through. */
  readonly lifetimeBecause: string;
  /** Suites that drive this producer end to end. Checked for existence only. */
  readonly drivenBy: readonly string[];
  /** The producer's real output — every arm that can reach the model. */
  readonly compose: () => Promise<readonly string[]>;
  /**
   * Markers proving `compose` still REACHES the arms that carried a false
   * sentence — one stable phrase per arm, never the wording of a fix.
   *
   * Without them a row can rot into vacuous coverage: `compose` drifts to the
   * easy arms, the checker reads only those, and the row goes on reporting
   * that its producer is covered. That is the round-3 failure wearing a green
   * badge, so it fails here instead.
   */
  readonly reaches: readonly RegExp[];
}

// ─── Fixtures the rows compose against ───────────────────────────────

const SCOPE: ArtifactScope = { conversationId: 'model-facing-inventory' };

const skills = [
  defineSkill({ id: 'alpha', description: 'alpha does things', body: 'ALPHA_BODY' }),
  defineSkill({ id: 'beta', description: 'beta does things', body: 'BETA_BODY' }),
  defineSkill({ id: 'gamma', description: 'gamma does things', body: 'GAMMA_BODY' }),
];

/** Every `read_skill` description shape a graph run can compose. */
const readSkillDescriptions = (): readonly string[] => {
  const offers: readonly ReadSkillOffer[] = [
    // Decisively routed: a cursor, no menu, something reachable and something not.
    { grantable: ['beta'], showRefusable: true, cursorId: 'alpha' },
    // The cursor with nowhere to go — the arm that says so in one sentence.
    { grantable: [], showRefusable: true, cursorId: 'alpha' },
    // Turn-start menu, stay offered.
    {
      grantable: ['beta', 'gamma'],
      cursorId: 'alpha',
      menu: { candidates: [{ id: 'beta', relevance: 0.71 }], cursorId: 'alpha', stay: true },
    },
    // Role-hidden cursor: the description may name nothing about it.
    { grantable: ['gamma'], showRefusable: true, cursorId: 'alpha', hiddenIds: ['alpha', 'beta'] },
    // No graph — the plain catalog this tool has always had.
    {},
  ];
  return [
    ...offers.map((offer) => readSkillDescriptor(skills, offer)?.description ?? ''),
    readSkillDescriptor(skills)?.description ?? '',
  ];
};

/** Every `present` refusal, over an empty scope and a stocked one. */
const presentRefusals = async (): Promise<readonly string[]> => {
  const store = inMemoryArtifacts();
  const refusal = async (args: Record<string, unknown>): Promise<string> => {
    const outcome = await presentArtifact(store, SCOPE, args);
    if (outcome.ok) throw new Error(`present(${JSON.stringify(args)}) was expected to refuse`);
    return outcome.refusal;
  };
  const out = [
    await refusal({ as: 'table' }),
    await refusal({ ref: 'art_missing' }),
    // The listing arm that reported the moment instead of the call.
    await refusal({ ref: 'art_missing', as: 'table' }),
  ];
  await store.put(SCOPE, {
    kind: 'chart/spec',
    mediaType: 'application/json',
    data: { bars: [1, 2, 3] },
    label: 'Q3 sales',
  });
  // The same refusal once the scope HAS something — the state that falsifies
  // the sentence above when it is re-read.
  return [...out, await refusal({ ref: 'art_missing', as: 'table' })];
};

/** Every `wants` dispatch refusal, over an empty scope and a stocked one. */
const wantsRefusals = async (): Promise<readonly string[]> => {
  const store = inMemoryArtifacts();
  const wants = { dataset: 'dataset/rows' } as const;
  const schema = {
    type: 'object',
    properties: { dataset: { type: 'string' } },
    required: ['dataset'],
  };
  const refusal = async (args: Record<string, unknown>): Promise<string> => {
    const verdict = await resolveToolWants(store, SCOPE, 'summarize_rows', wants, args, schema);
    if (verdict.ok) throw new Error(`wants(${JSON.stringify(args)}) was expected to refuse`);
    return verdict.refusal;
  };
  const out = [
    await refusal({}),
    await refusal({ dataset: 42 }),
    await refusal({ dataset: 'art_missing' }),
  ];
  const { meta: wrongKind } = await store.put(SCOPE, {
    kind: 'file/csv',
    mediaType: 'text/csv',
    data: 'region,total\nwest,42\n',
    label: 'rows.csv',
  });
  await store.put(SCOPE, {
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: [{ region: 'west' }],
    label: 'Q3 rows',
  });
  // Stocked scope: the kind-mismatch arm, and the listing that CAN resolve.
  return [...out, await refusal({ dataset: wrongKind.ref }), await refusal({})];
};

/**
 * Every park card the kernel can render — one per branch that changes a word.
 *
 * `parkCard` is a pure function over plain data (its own module header says
 * so), so the rows are built by calling it, not by driving an agent to a park.
 * The end-to-end proof that this text reaches a real system prompt lives in
 * `drivenBy`.
 */
const parkCards = (): readonly string[] => {
  const plan: EngagementPlan = {
    renewalGrace: 3,
    maps: [
      { id: 'zone-audit-map', memberIds: ['zone-audit', 'billing'], toolNames: ['get_zone_info'] },
    ],
  };
  const record = (over: Partial<MapEngagementRecord>): MapEngagement => [
    {
      mapId: 'zone-audit-map',
      standing: 'parked',
      by: 'lexical',
      since: 4,
      foundedBy: 'lexical',
      foundedAt: 1,
      at: 'zone-audit',
      idle: 3,
      ...over,
    } as MapEngagementRecord,
  ];
  return [
    // `by: 'assumed'` and everything else are DIFFERENT reason sentences.
    parkCard(plan, record({ by: 'assumed' })) ?? '',
    parkCard(plan, record({})) ?? '',
    // No position observed — the `(unknown)` cursor arm.
    parkCard(plan, record({ at: undefined })) ?? '',
  ];
};

/**
 * The code runner's rendered result — BOTH preamble arms of `render`.
 *
 * The registry drove only the ref-less call, so the arm that speaks when data
 * WAS staged had no row reading it and no marker pinning it; it was registered
 * and unchecked, which is the same green badge as unregistered. So the run
 * makes two calls: one passing a live ref (staged), one passing none.
 */
const codeRunnerResults = async (): Promise<readonly string[]> => {
  const runner: CodeRunner = {
    id: 'inventory-runner',
    start: async () => ({
      id: 'session-1',
      stageInputs: async (inputs) =>
        inputs.map((input) => ({ name: input.name, path: `/session/${input.name}`, bytes: 1 })),
      execute: async () => ({ ok: true, stdout: 'ran', stderr: '', artifacts: [] }),
      stop: async () => undefined,
    }),
  };
  const store = inMemoryArtifacts();
  const { meta } = await store.put(SCOPE, {
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: [{ region: 'west', total: 42 }],
    label: 'Q3 rows',
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [
            { id: 't1', name: 'run_code', args: { code: 'print(1)', dataset: meta.ref } },
          ],
          stopReason: 'tool_use',
        },
        {
          content: '',
          toolCalls: [{ id: 't2', name: 'run_code', args: { code: 'print(2)' } }],
          stopReason: 'tool_use',
        },
        { content: 'done', toolCalls: [], stopReason: 'stop' },
      ] as never,
    }),
    model: 'mock',
    maxIterations: 4,
    artifacts: { store },
  })
    .system('s')
    .tool(codeRunnerTool({ runner, wants: { dataset: 'dataset/rows' } }))
    .build();
  const results: string[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) =>
    results.push(String((e.payload as { result?: unknown }).result)),
  );
  // The store's scope is the run's identity — without it the ref the model
  // passes resolves in nobody's scope and the staged arm never runs.
  await agent.run({ message: 'go', identity: SCOPE });
  return results;
};

/**
 * Every arm of the ONE `read_skill` refusal composer (9.86.0).
 *
 * It replaced two gate-local composers that could contradict each other, and
 * it is the producer the round-3 escape happened INSIDE — so the row exists
 * for the same reason the description's row does: the sentence a model reads
 * when it is told no is the sentence that teaches it what the map is.
 *
 * `hops` and `openIds` arrive ALREADY role-filtered (the gate's contract), so
 * the fixtures pass filtered lists — a row that passed raw sets would be
 * checking a call the library never makes.
 */
const readSkillRefusals = (): readonly string[] => [
  // Reachability: hops to name, no hops to name, and the turn's start as the
  // anchor when no cursor has been set yet.
  composeReadSkillRefusal({
    requestedId: 'vault',
    targetClass: 'unreachable',
    cursorId: 'billing',
    hops: { named: ['refunds'], held: true },
    openIds: { named: ['debug'], held: true },
  }),
  composeReadSkillRefusal({
    requestedId: 'vault',
    targetClass: 'unreachable',
    cursorId: 'billing',
    hops: { named: ['refunds'], held: true },
    openIds: { named: [], held: false },
  }),
  composeReadSkillRefusal({
    requestedId: 'vault',
    targetClass: 'unreachable',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: [], held: false },
  }),
  composeReadSkillRefusal({
    requestedId: 'vault',
    targetClass: 'unreachable',
    hops: { named: ['triage'], held: true },
    openIds: { named: [], held: false },
  }),
  // The non-'unreachable' fallback: reachable only from a direct caller that
  // refused an admissible class for a reason of its own.
  composeReadSkillRefusal({
    requestedId: 'refunds',
    targetClass: 'hop',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: [], held: false },
  }),
  // Tree: nothing to move, with and without open skills to name.
  composeReadSkillRefusal({
    requestedId: 'leaf-b',
    targetClass: 'unreachable',
    hops: { named: [], held: false },
    openIds: { named: [], held: false },
    isTree: true,
  }),
  composeReadSkillRefusal({
    requestedId: 'leaf-b',
    targetClass: 'unreachable',
    hops: { named: [], held: false },
    openIds: { named: ['helper'], held: true },
    isTree: true,
  }),
  // The hop set the graph HELD and the role filter emptied — the arm that used
  // to assert "No skill was reachable from 'billing'" over a graph that was
  // routing. It composes no hop clause at all now, so the row's markers below
  // can pin an absence.
  composeReadSkillRefusal({
    requestedId: 'vault',
    targetClass: 'unreachable',
    cursorId: 'billing',
    hops: { named: [], held: true },
    openIds: { named: [], held: false },
  }),
  // Posture 'rails' — the framework routes, so no hop is named at all. The
  // gate hands these arms an EMPTY hop list (`{ named: [], held: false }`),
  // which is what these fixtures pass: a row composing a call the library
  // never makes would check nothing.
  composeReadSkillRefusal({
    requestedId: 'refunds',
    targetClass: 'hop',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: [], held: false },
    posture: 'rails',
  }),
  composeReadSkillRefusal({
    requestedId: 'refunds',
    targetClass: 'hop',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: ['debug'], held: true },
    posture: 'rails',
  }),
  // Posture 'guard' — off an outstanding menu, with a menu the filter emptied,
  // and with no menu at all (both arms of the decisively-routed clause).
  composeReadSkillRefusal({
    requestedId: 'refunds',
    targetClass: 'hop',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: ['debug'], held: true },
    posture: 'guard',
    menuOffered: { named: ['shipping', 'triage'], held: true },
  }),
  composeReadSkillRefusal({
    requestedId: 'refunds',
    targetClass: 'hop',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: [], held: false },
    posture: 'guard',
    menuOffered: { named: [], held: true },
  }),
  // No menu at all: one arm per `TurnRoute.by` value the gate can hand over
  // (9.86.1) — each a different past fact, and none of them the old
  // "Declared routes moved the cursor instead." tail that was composed for
  // every value and true of none in particular.
  ...(['entry', 'intent', 'continuity', 'menu', 'decider', 'none'] as const).map((by) =>
    composeReadSkillRefusal({
      requestedId: 'refunds',
      targetClass: 'hop',
      cursorId: 'billing',
      hops: { named: [], held: false },
      openIds: { named: [], held: false },
      posture: 'guard',
      turnStartedBy: by,
    }),
  ),
  // A cursor this caller may not be told the name of (9.86.1): the anchor is
  // the skill, unnamed, and not "the turn's start".
  composeReadSkillRefusal({
    requestedId: 'vault',
    targetClass: 'unreachable',
    cursorWithheld: true,
    hops: { named: ['refunds'], held: true },
    openIds: { named: [], held: false },
  }),
  composeReadSkillRefusal({
    requestedId: 'refunds',
    targetClass: 'hop',
    cursorId: 'billing',
    hops: { named: [], held: false },
    openIds: { named: [], held: false },
    posture: 'guard',
  }),
];

/**
 * All three arms of the ONE unknown-tool result: a stocked roster, a bare one,
 * and the roster the role filter emptied — which names nothing AND denies
 * nothing, because the dispatch map was holding names this caller may not be
 * told about.
 */
const unknownToolResults = (): readonly string[] => [
  unknownToolResult('nope', { named: ['calc', 'probe'], held: true }),
  unknownToolResult('nope', { named: [], held: false }),
  unknownToolResult('nope', { named: [], held: true }),
];

/**
 * A real run whose batch paused on its middle call (`requestInput`) and whose
 * third call the resume SETTLED — the record `inspect_tool_call`'s
 * never-dispatched arm reads (`traceToolpack.ts` · `notDispatchedOf`).
 */
const settledBatchArtifacts = async (): Promise<TraceToolpackArtifacts> => {
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'first', args: {} },
            { id: 'c2', name: 'second', args: {} },
            { id: 'c3', name: 'third', args: {} },
          ],
        },
        { content: 'done' },
      ],
    }),
    model: 'mock',
  })
    .tools(
      ['first', 'second', 'third'].map((name) =>
        defineTool({
          name,
          description: `the ${name} tool`,
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            name === 'second'
              ? requestInput({
                  id: 'year',
                  question: 'Which year?',
                  fields: [{ id: 'year', type: 'number', required: true }],
                })
              : `${name} ran`,
        }),
      ),
    )
    .build();
  const paused = await agent.run({ message: 'go' });
  if (!isInputPause(paused)) throw new Error('expected an input pause');
  const recorder = recordRun(agent);
  await agent.resume(paused.checkpoint, {
    requestId: paused.awaitingInput.requestId,
    values: { year: 2026 },
  });
  const recording = recorder.toRecording();
  recorder.stop();
  return { snapshot: agent.getLastSnapshot()!, events: recording.events };
};

/**
 * The trace toolpack's model-facing RESULTS, composed through the real
 * `execute` (`callTraceTool` validates args exactly as an Agent dispatch
 * would, so these are the strings a debugging session reads).
 *
 * A run is driven for real because `inspect_tool_call` joins four records —
 * the assistant turn, the ledger, the tool turn and the event tail — and a
 * hand-built bag would let the row pass while the join it reports on was
 * broken. The proposed args are deliberately INVALID against the tool's
 * schema, which is the one way to reach the validation line.
 */
const traceToolpackResults = async (): Promise<readonly string[]> => {
  const lookupOrder = defineTool<{ orderId: string }, string>({
    name: 'lookup_order',
    description: 'Look up an order by id',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
    execute: ({ orderId }) => `Order ${orderId}: warranty ACTIVE`,
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        // No `orderId` — the args fail the schema the model was shown.
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'lookup_order', args: {} }],
          stopReason: 'tool_use',
        },
        { content: 'done', toolCalls: [], stopReason: 'stop' },
      ] as never,
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('support')
    .tool(lookupOrder)
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'Order 7712?' });
  const recording = recorder.toRecording();
  recorder.stop();
  const artifacts: TraceToolpackArtifacts = {
    snapshot: agent.getLastSnapshot()!,
    events: recording.events,
  };

  // The descent's two "no record here" arms: a lookup holding OTHER records,
  // and a lookup holding none at all.
  const stocked = innerRunStore(4);
  stocked.keep({ toolCallId: 'c9', toolName: 'weather_advice', outcome: 'ok', steps: 4 });
  return [
    // The never-dispatched arm (9.113.0): a call the paused batch settled.
    await callTraceTool(traceToolpack(await settledBatchArtifacts()), 'inspect_tool_call', {
      toolCallId: 'c3',
    }),
    await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', { toolCallId: 'c1' }),
    await callTraceTool(traceToolpack({ ...artifacts, innerRuns: stocked }), 'inspect_tool_run', {
      toolCallId: 'c1',
    }),
    // The id the OUTER run never made — the arm that used to say "every id
    // this run made" and could not say which run that was.
    await callTraceTool(traceToolpack({ ...artifacts, innerRuns: stocked }), 'inspect_tool_run', {
      toolCallId: 'c-missing',
    }),
    await callTraceTool(
      traceToolpack({ ...artifacts, innerRuns: innerRunStore(4) }),
      'inspect_tool_run',
      { toolCallId: 'c1' },
    ),
  ];
};

/**
 * Both spans of the stepped-skill nudge — one unrun step, and a range.
 *
 * The nudge is a turn this library writes in a person's voice, so it is read
 * again on every later call of the turn. Its span clause is the arm that
 * changes wording, which is why the row composes both rather than one.
 */
const stepNudges = (): readonly string[] => {
  const plan: StepPlan = {
    skillId: 'refund',
    steps: [
      { tool: 'lookup', note: 'find the order first' },
      { tool: 'charge', note: 'refund the charge' },
      { tool: 'export', note: 'file the receipt' },
    ],
    toolNames: new Set(['lookup', 'charge', 'export']),
    onSkip: 'advance',
  };
  const at = (step: number): StepPointer => ({ skillId: 'refund', step, total: 3, skipped: [] });
  // `remainingStepsOf` keeps every step at or after the pointer, so a pointer
  // on the last step is the only way to reach the single-step wording.
  return [nudgeTeachingMessage(at(1), plan), nudgeTeachingMessage(at(3), plan)];
};

/**
 * The findings ledger's two model-facing strings (9.101.0, `.findings()`).
 *
 * Both ride the REQUEST, never `history`: the `_findings` property is rebuilt
 * onto every served schema by `withFindingsArgument` at the committed tool
 * list (`buildToolsSlot`, the seed fallback), and the instruction is a
 * system piece registered through `defineInstruction` — recomposed by the
 * injection engine on every pass. Neither is written into a `role: 'tool'`
 * or `role: 'user'` message, so a later call re-reads a fresh copy, not a
 * stale one. `test/core/agent/findings/reserved.test.ts` judges the same two
 * strings at the STRICTEST lifetime as well; the rows here name the real one.
 */
const RESERVED_ARGUMENT_DESCRIPTION: Surface = {
  channel: 'tool-description',
  lifetime: 'request-ephemeral',
};
const ALWAYS_ON_INSTRUCTION: Surface = {
  channel: 'system-text',
  lifetime: 'request-ephemeral',
};
/** The SERVED piece (step 3): composed per request from the committed
 *  `findingsLedger` key and joined into `systemPieces` only — never an
 *  injection, never a `history` turn. */
const LEDGER_PIECE: Surface = {
  channel: 'system-text',
  lifetime: 'request-ephemeral',
};

/**
 * The inputs layer's sentence on a ruled property (honesty layer 2). It rides
 * the REQUEST — rebuilt onto the served copy of the schema at the one
 * decoration site and its seed twin — but it is judged at the STRICTEST
 * lifetime anyway (the design's rule for every served honesty sentence): it
 * states the rule and what the record keeps, which stays true on every
 * re-read, including under a cached tools slot.
 */
const RULED_PROPERTY_DESCRIPTION: Surface = {
  channel: 'tool-description',
  lifetime: 'persistent-history',
};

/**
 * The one served time line (time step T6b), served LATE: "yesterday" in a
 * look-back tool's and an epoch tool's form — as the window the person
 * CONFIRMED in the time ask, as one they EDITED, as a `model` reader's
 * unconfirmed reading, and PENDING (a proposal the person has not answered),
 * alone and beside a settled window; once more with a view that hides a value.
 */
function timeWindowLines(): string[] {
  const lookback = defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback' } as never,
    execute: () => 'ok',
  });
  const epoch = defineTool({
    name: 'client_activity',
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
    },
    askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
    } as never,
    execute: () => 'ok',
  });
  const hiding = {
    ...epoch,
    [SHOWN_ARGS]: (args: Record<string, unknown>) =>
      'start_time' in args ? { ...args, start_time: 'REDACTED' } : args,
  };
  const window = {
    mention: 0,
    quote: 'yesterday',
    range: { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' },
    zone: 'America/Los_Angeles',
  };
  const sets = [
    { source: 'answered' as const, answer: 'confirmed' as const },
    { source: 'answered' as const, answer: 'edited' as const },
    { source: 'derived-from-reading' as const },
  ].map((who) => ({ now: '2026-10-09T15:40:00Z', windows: [{ ...window, ...who }] }));
  const pendingSets = [
    { now: '2026-10-09T15:40:00Z', windows: [], pending: ['yesterday'] },
    { ...sets[0]!, pending: ['10/09/26 8 AM to 8:40 AM PST', 'last 2 hours'] },
    // …and after a call already ran on a window the model wrote: the limit, not the move.
    { now: '2026-10-09T15:40:00Z', windows: [], pending: ['yesterday'], ranUnconfirmed: true },
  ];
  const wires = [
    new Map<string, unknown>([
      ['search_logs', lookback],
      ['client_activity', epoch],
    ]),
    new Map<string, unknown>([['client_activity', hiding]]),
  ];
  return [...sets, ...pendingSets].flatMap((windows) =>
    wires.flatMap((winning) => {
      const served = [...winning.values()].map((t) => (t as { schema: unknown }).schema);
      const line = timeWindowsLine(served as never, winning as never, windows);
      return line === undefined ? [] : [line];
    }),
  );
}

/**
 * The time limits an answer states (time step T8), served late: a clamp (less
 * than was asked), a model-chosen look-back wider than the person's window, a
 * refusal older than the source keeps, and two wall-clock sources on
 * different zones — each alone, and together.
 */
function timeLimitLines(): string[] {
  const zone = { zone: 'America/Los_Angeles' };
  const range = (from: string, to: string) => ({ from, to });
  const base = { kind: 'period', turn: 1, iteration: 1, verdict: 'covered' } as const;
  const clamp = periodCheckLine(
    {
      ...base,
      toolCallId: 'c1',
      toolName: 'client_activity',
      differs: {
        against: 'asked',
        asked: range('2026-09-09T15:40:00Z', '2026-10-09T15:40:00Z'),
        read: [range('2026-10-02T15:40:00Z', '2026-10-09T15:40:00Z')],
        source: 'queried',
        missing: [range('2026-09-09T15:40:00Z', '2026-10-02T15:40:00Z')],
        extra: [],
      },
    } as never,
    zone,
    'model',
  )!;
  const wider = periodCheckLine(
    {
      ...base,
      toolCallId: 'c2',
      toolName: 'search_logs',
      differs: {
        against: 'person',
        asked: range('2026-10-08T15:00:00Z', '2026-10-08T16:00:00Z'),
        read: [range('2026-10-08T15:00:00Z', '2026-10-09T15:40:00Z')],
        source: 'asked',
        missing: [],
        extra: [range('2026-10-08T16:00:00Z', '2026-10-09T15:40:00Z')],
      },
    } as never,
    zone,
    'model',
  )!;
  const old = periodCheckLine(
    {
      ...base,
      toolCallId: 'c3',
      toolName: 'client_activity',
      verdict: 'undeclared',
      beyondRetention: true,
    } as never,
    zone,
    'model',
  )!;
  const clocks = ["the sources' clocks differ (UTC, America/New_York) — compared as instants"];
  return [
    { period: [clamp], clocks: [] },
    { period: [wider], clocks: [] },
    { period: [old], clocks: [] },
    { period: [], clocks },
    { period: [clamp, wider, old], clocks },
  ].flatMap((lines) => {
    const line = timeLimitsSentence(lines);
    return line === undefined ? [] : [line];
  });
}

/** A ruled tool, and the same tool with an argument view that hides the ruled value. */
function ruledSchemaDescriptions(): string[] {
  const tool = defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1h', '2h'], description: 'Look-back period.' },
        limit: { type: 'integer' },
      },
    },
    askOrAssume: { window: { assume: '2h' }, limit: { assume: 50 } },
    execute: () => 'ok',
  });
  const hiding = {
    ...tool,
    [SHOWN_ARGS]: (args: Record<string, unknown>) =>
      'window' in args ? { ...args, window: 'REDACTED' } : args,
  };
  // …and an `ask` rule (step 4): the sentence prints no value — there is none.
  const asking = defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1h', '2h'], description: 'Look-back period.' },
      },
    },
    askOrAssume: { window: { ask: 'Which period?', choices: ['1h', '2h'] } },
    execute: () => 'ok',
  });
  // …both under declared sources too (step 5): the `ask` sentence names `_findings.from`.
  return [tool, hiding, asking].flatMap((t) =>
    [undefined, { sources: true }].flatMap((options) => {
      const served = withArgumentRules(t.schema, t as never, options);
      const props = served.inputSchema.properties as Record<string, { description?: string }>;
      return Object.values(props).flatMap((p) => (p.description ? [p.description] : []));
    }),
  );
}

/** Both refusals, the dispatch re-read's composed from the REAL assert's own sentence. */
function ruledRefusals(): string[] {
  const broken = rulesOf({
    schema: {
      name: 'search_logs',
      inputSchema: { type: 'object', properties: { window: { type: 'string', enum: ['1h'] } } },
    },
    askOrAssume: { window: { assume: '9h' } },
  });
  const reason = broken !== undefined && 'refused' in broken ? broken.refused : '';
  return [unreadableRulesRefusal('search_logs', reason), unmountedRulesRefusal('search_logs')];
}

/**
 * A ledger that reaches EVERY arm of the piece's grammar: a conflict (two
 * facts on one key), a placed fact, an open row with `settles`, a ruled-out
 * row, noise, an undeclared served result, a bucket past its cap (`+K more`)
 * and a line past its width (`…[clipped N chars]`).
 */
function findingsPieces(): string[] {
  const assertion = (id: string, value: unknown, provenance: string) => ({
    subject: { kind: 'port', id },
    predicate: 'state',
    value,
    stratum: 'asserted' as const,
    provenance,
  });
  const standing = (
    toolCallId: string,
    kind: 'fact' | 'open' | 'noise' | 'ruled-out',
    extra: object = {},
  ) => ({
    kind: 'standing' as const,
    toolCallId,
    toolName: 'lookup_port',
    standing: kind,
    assertions: [],
    declaredOn: { toolCallId: 'call_9' },
    iteration: 2,
    ...extra,
  });
  const ledger: FindingsLedger = [
    standing('call_1', 'fact', { assertions: [assertion('fc1/7', 'up', 'tool:call_1')] }),
    standing('call_2', 'fact', { assertions: [assertion('fc1/7', 'down', 'tool:call_2')] }),
    standing('call_3', 'fact', {
      ref: 'art_9f3c',
      assertions: Array.from({ length: 70 }, (_, i) =>
        assertion(`fc1/${i}`, i, 'artifact:art_9f3c'),
      ),
    }),
    standing('call_4', 'open', {
      toolName: 'fetch_log',
      settles: `the log for the window ${'x'.repeat(260)}`,
    }),
    standing('call_5', 'ruled-out', { line: 'the port is not on switch B' }),
    standing('call_6', 'noise'),
  ] as FindingsLedger;
  const served = ['call_1', 'call_2', 'call_3', 'call_4', 'call_5', 'call_6', 'call_7'];
  return [findingsLedgerPiece(ledger, served)!.rawContent];
}

/** The piece under `findings({ answerAsk: 'quote-facts' })` (9.103.0): the
 *  same ledger with `FINDINGS_ANSWER_ASK` as its last section — composed by
 *  the real function, so the row reads the ask where the model reads it. */
function findingsAskPieces(): string[] {
  const ledger: FindingsLedger = [
    {
      kind: 'standing',
      toolCallId: 'call_1',
      toolName: 'lookup_port',
      standing: 'fact',
      assertions: [
        {
          subject: { kind: 'port', id: 'fc1/7' },
          predicate: 'state',
          value: 'up',
          stratum: 'asserted',
          provenance: 'tool:call_1',
        },
      ],
      declaredOn: { toolCallId: 'call_2' },
      iteration: 2,
    },
  ] as FindingsLedger;
  return [findingsLedgerPiece(ledger, ['call_1', 'call_2'], 'quote-facts')!.rawContent];
}

/** The piece with a `contingent:` section (9.110.0): a ledger holding one
 *  set-aside standing and two contingent rows — one filed at the answer, one
 *  at a dispatch with two carriers — composed by the real function. */
function findingsContingentPieces(): string[] {
  const ledger: FindingsLedger = [
    {
      kind: 'standing',
      toolCallId: 'call_1',
      toolName: 'lookup_port',
      standing: 'noise',
      assertions: [],
      declaredOn: { toolCallId: 'call_2' },
      iteration: 2,
    },
    {
      kind: 'standing',
      toolCallId: 'call_4',
      toolName: 'fetch_log',
      standing: 'open',
      settles: 'a second read',
      assertions: [],
      declaredOn: { toolCallId: 'call_5' },
      iteration: 5,
    },
    {
      kind: 'contingent',
      declaredOn: { toolCallId: 'call_7' },
      value: '41200',
      carriers: [
        { toolCallId: 'call_1', standing: 'noise' },
        { toolCallId: 'call_4', standing: 'open' },
      ],
      iteration: 7,
    },
    {
      kind: 'contingent',
      declaredOn: 'answer',
      value: 'fc1/7',
      carriers: [{ toolCallId: 'call_1', standing: 'noise' }],
      iteration: 8,
    },
  ] as FindingsLedger;
  return [findingsLedgerPiece(ledger, ['call_1', 'call_4', 'call_7'])!.rawContent];
}

/** The piece with an `unsettled by absence:` section (9.113.0): two
 *  ruled-out standings, each with the row the rule files beside it — an
 *  absence quoting every part of its envelope, and an absence that declared
 *  no boundary and no way out — composed by the real function. */
function findingsUnsettledPieces(): string[] {
  const ruledOut = (toolCallId: string, toolName: string, iteration: number) => ({
    kind: 'standing',
    toolCallId,
    toolName,
    standing: 'ruled-out',
    line: 'not the path',
    assertions: [],
    declaredOn: { toolCallId: 'call_9' },
    iteration,
  });
  const ledger = [
    ruledOut('call_1', 'host_hbas', 2),
    {
      kind: 'unsettled-by-absence',
      toolCallId: 'call_1',
      notChecked: [
        {
          what: 'whether nas-cluster-06 is a hypervisor host',
          why: 'this lookup reads HBA rows only',
        },
        { what: 'the archived HBA history' },
      ],
      cannotCover: [
        { what: 'hosts outside the collected inventory', why: 'one inventory per collector' },
      ],
      tryInstead: 'Look nas-cluster-06 up in cluster_inventory first.',
      iteration: 2,
    },
    ruledOut('call_2', 'port_lookup', 3),
    { kind: 'unsettled-by-absence', toolCallId: 'call_2', iteration: 3 },
  ] as FindingsLedger;
  return [findingsLedgerPiece(ledger, ['call_1', 'call_2', 'call_3'])!.rawContent];
}

/** Every `description` in the reserved property's schema tree — each one the
 *  model reads on every served tool, at whatever depth the provider renders. */
function findingsSchemaDescriptions(schema: unknown = FINDINGS_ARGUMENT_SCHEMA): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'description' && typeof value === 'string') out.push(value);
      else walk(value);
    }
  };
  walk(schema);
  return out;
}

/**
 * The declared-sources arm's served surface (honesty layer 2, step 5): the
 * `from` property planted on a RULED tool's `_findings` — inside the ledger's
 * decoration, or alone (`FINDINGS_SOURCES_SCHEMA`, declared sources without
 * the ledger). It rides the request only — rebuilt onto every served schema —
 * but it is judged at the STRICTEST lifetime (the design's rule for every
 * served honesty sentence). There is no instruction line any more: `from` is
 * explained once, in its own property.
 */
const DECLARED_SOURCES_PROPERTY: Surface = {
  channel: 'tool-description',
  lifetime: 'persistent-history',
};

/** The ontology piece over a map that reaches EVERY arm of its grammar: a
 *  unit, aliases, two holdings (one with tools and a coverage sentence, one
 *  bare), a configured source, a `configured: false` source, an unconfigured
 *  one, a relation with a meaning and one without, a node nobody holds, a
 *  section past its cap (`+K more`). Composed by the real function. */
function ontologyPieces(): string[] {
  const map = defineOntology({
    id: 'fleet',
    version: '1',
    sources: {
      inventory: {
        meaning: 'the switch inventory export',
        coverage: 'every switch',
        configured: true,
      },
      syslog: { meaning: 'the syslog archive', configured: false },
      tickets: { meaning: 'the ticket queue' },
    },
    nodes: {
      port: {
        meaning: 'a physical switch port',
        aliases: ['interface'],
        sources: [
          { source: 'inventory', via: ['lookup_port'], coverage: 'all ports' },
          { source: 'syslog' },
        ],
      },
      port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
      ...Object.fromEntries(
        Array.from({ length: 70 }, (_, i) => [
          `term_${String(i).padStart(2, '0')}`,
          { meaning: `term ${i}` },
        ]),
      ),
    },
    edges: [
      {
        from: 'port_error_rate',
        to: 'port',
        relation: 'measured-on',
        meaning: 'the port it counts',
      },
      { from: 'port', to: 'port_error_rate', relation: 'has' },
    ],
  });
  return [ontologyPiece(map).rawContent];
}

/**
 * The empty-data refusal (honesty step 7a′), composed by the REAL mints — both
 * declaration doors, every data list — exactly as a tool's `execute` throws it.
 */
function emptyDataRefusals(): readonly string[] {
  const refusalOf = (mint: () => unknown): string => {
    try {
      mint();
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error('expected the empty data list to be refused');
  };
  const provenance = { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' };
  return [
    refusalOf(() => describedResult({ facts: [], provenance })),
    refusalOf(() =>
      describedResult({
        series: [],
        grain: { interval: '1h', aggregation: 'avg', isCounter: false },
        provenance,
      }),
    ),
    refusalOf(() => describedResult({ edges: [] })),
    refusalOf(() =>
      semantic({ facts: [], provenance: { measured_at: '2026-09-26T02:00:00Z', source: 'x' } }),
    ),
  ];
}

// ─── The registry ────────────────────────────────────────────────────

const PRODUCERS: readonly ModelFacingProducer[] = [
  {
    id: 'skill-graph — the read_skill SELF-CALL notice',
    module: 'src/core/agent/selfCallNotice.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the gate overwrites the tool result with it, so it is written into `history` and ' +
      're-read on every later call of the turn, wrap-up included',
    drivenBy: ['test/skillGraphSelfCall.test.ts'],
    reaches: [/named the skill you were already standing in/, /tool list/, /ALPHA_BODY/],
    compose: async () => [
      selfCallNotice({
        skillId: 'alpha',
        tools: { declared: ['alpha_tool'], served: ['alpha_tool'] },
      }),
      selfCallNotice({ skillId: 'alpha', tools: { declared: ['alpha_tool'], served: [] } }),
      selfCallNotice({ skillId: 'alpha', tools: { declared: [], served: [] } }),
      selfCallNotice({ skillId: 'alpha', tools: undefined }),
      selfCallNotice({
        skillId: 'alpha',
        tools: { declared: ['alpha_tool'], served: ['alpha_tool'] },
        body: 'ALPHA_BODY',
      }),
    ],
  },
  {
    id: 'skill-graph — the read_skill DESCRIPTION (the offer)',
    module: 'src/lib/injection-engine/skillToolDescriptors.ts',
    surface: GRAPH_TOOL_DESCRIPTION,
    lifetimeBecause:
      "`AgentBuilder.skillGraph` throws under `reactMode: 'classic'`, the one mode that " +
      'caches the tools slot, so a description carrying an offer was composed for the ' +
      'request being answered and is never re-read',
    drivenBy: ['test/skillGraphSelfCall.test.ts', 'test/security/skill-visibility.test.ts'],
    reaches: [
      /Activate a skill for the next iteration/,
      /Reachable from here/,
      /Not reachable from here/,
    ],
    compose: async () => readSkillDescriptions(),
  },
  {
    id: 'artifacts — the `present` teaching refusal',
    module: 'src/artifacts/present.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the tool-calls stage overwrites the placeholder result with it (`applyPresent`), so ' +
      'it lands on a `role: "tool"` message like any other result',
    drivenBy: ['test/artifacts/present.test.ts'],
    // One marker PER ARM, and the empty-scope arm needs its own. The two
    // obvious markers do not pin it: `found nothing under that ref` matches
    // both arms of the `listing` ternary, and the stocked one's own sentence
    // matches only that arm — so the arm carrying the sentence Phase 1 fixed
    // had no marker at all, and dropping it from `compose` left the suite
    // green. That is the round-3 escape reproduced inside the guard built to
    // prevent it: a checker is only as wide as what it is handed.
    //
    // The stocked arm is pinned by its PRODUCT, not by its prose: 'Q3 sales'
    // is the label of the artifact this fixture stores, and only `describeRef`
    // ever prints it. A marker on the sentence would have to be rewritten by
    // every sentence repair — which is how a marker quietly becomes a copy of
    // the fix instead of a guard on the arm.
    reaches: [/found nothing under that ref/, /Nothing was live/, /'Q3 sales'/],
    compose: presentRefusals,
  },
  {
    id: 'artifacts — the `wants` dispatch refusal',
    module: 'src/artifacts/wants.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'dispatch returns it as the tool result of a call it declined to run, so the model ' +
      're-reads it for the rest of the turn',
    drivenBy: ['test/artifacts/wants-dispatch.test.ts', 'test/core/code-staging.test.ts'],
    // Per arm again, and the listing arm is pinned by its PRODUCT ('Q3 rows'
    // is the label only `describeLiveRef` prints) rather than by the sentence
    // around it. The kind-mismatch arm gets its own marker too: it is the one
    // arm `compose` could drop while every other assertion here stayed green,
    // because its listing is byte-identical to the required-argument arm's.
    reaches: [
      /was not executed/,
      /No live 'dataset\/rows' artifacts/,
      /the wrong parcel for this ticket window/,
      /'Q3 rows'/,
    ],
    compose: wantsRefusals,
  },
  {
    id: 'maps — the park card',
    module: 'src/maps/engagement/parkCard.ts',
    surface: PARK_CARD,
    lifetimeBecause:
      'the injection engine rebuilds `activeInjections` every pass and appends the card from ' +
      "that pass's just-advanced engagement state, so the re-engaged pass carries no card at " +
      'all (park-is-visible) — no prompt is ever re-read',
    drivenBy: ['test/maps/park-is-visible.test.ts', 'test/maps/engagement.test.ts'],
    // One marker per branch that changes a word: the header, the field line,
    // both arms of `reasonOf`, both arms of `at ?? '(unknown)'`, and the
    // way-back line. `not POSITION` pins the last WITHOUT quoting the sentence
    // this phase repaired — the clause beside it is the one the line exists
    // for, and it survives a rewording of the suppression claim next to it.
    //
    // The two `reasonOf` markers name the CURSOR FIELD as well as the reason,
    // and they have to. Written as bare reason phrases they did not pin their
    // arms: `record({})` and `record({ at: undefined })` both carry the same
    // `by`, so deleting the first from `compose` left the second satisfying
    // its marker and the suite stayed green — the round-3 escape, inside the
    // guard built to catch it, on the very row being added to catch it. Both
    // facts land on ONE rendered line, so pinning the pair identifies the row.
    reaches: [
      /Map status/,
      /cursor: zone-audit \(unchanged\)[^\n]*nothing on this turn explains why it is loaded/,
      /cursor: zone-audit \(unchanged\)[^\n]*no recent evidence that it is the right map/,
      /cursor: \(unknown\)/,
      /engagement: PARKED/,
      /not POSITION/,
    ],
    compose: async () => parkCards(),
  },
  {
    id: 'code runner — the rendered run result',
    module: 'src/core/codeRunnerTool.ts',
    surface: TOOL_RESULT,
    lifetimeBecause: "it is the return value of the tool's `execute` — a tool result outright",
    drivenBy: ['test/core/code-staging.test.ts', 'test/artifacts/code-artifacts.test.ts'],
    // Both preamble arms. `paths` is the discriminator: only the STAGED arm
    // tells the model where its data landed, and every rewording of "here is
    // what went in" will still say it — whereas the two arms share the word
    // `staged`, the tool name and the argument name, so none of those can pin
    // one arm against the other.
    reaches: [/no artifact inputs were passed/, /\bpaths\b/],
    compose: codeRunnerResults,
  },
  {
    id: 'skill-graph — the read_skill REFUSAL composer',
    module: 'src/core/agent/stages/toolCalls.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the gate returns it as the result of the `read_skill` call it declined, so it is ' +
      'written onto a `role: "tool"` message and re-read on every later call of the turn',
    drivenBy: ['test/skillGraphSelfCall.test.ts', 'test/skillGraphTreePick.test.ts'],
    // One marker per ARM, because the arms are what a rewrite drops: the
    // three reachability shapes, the fallback the gate itself never reaches,
    // the tree, both postures, and the open-skill clause that rides along.
    reaches: [
      /was not reachable from 'billing'/,
      /No skill was reachable from/,
      /was not reachable from the turn's start/,
      /was not admitted from/,
      /this map is a decision tree/,
      /'rails' posture reserves routing to the framework/,
      /'guard' posture admits a routing pick only from the menu/,
      /was not admitted on that call\./,
      /no menu was outstanding when that call was made/,
      /had already been resolved decisively/,
      /had been carried over from the previous turn/,
      /had already been resolved by an earlier pick/,
      /resolved by the configured decider before the turn's first call/,
      /was not reachable from the skill the cursor stood in/,
      /Open skills were admitted on that call/,
    ],
    compose: async () => readSkillRefusals(),
  },
  {
    id: 'dispatch — the unknown-tool result',
    module: 'src/core/agent/stages/toolCalls.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'both dispatch doors return it as the tool result of a call they could not route, so ' +
      'it lands in `history` like any other result',
    drivenBy: ['test/core/agent/toolDivergenceWalk.test.ts'],
    reaches: [
      /Tool names that resolved to an implementation on that call/,
      /No tool name resolved to an implementation on that call/,
    ],
    compose: async () => unknownToolResults(),
  },
  {
    id: 'dispatch — the batch settlement (a paused batch’s un-dispatched siblings, 9.113.0)',
    module: 'src/core/agent/stages/toolCalls.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'every resume path appends it as the `role: "tool"` result of a call the paused batch ' +
      'never dispatched, so it is written into `history` and re-read on every later call of ' +
      'the turn',
    drivenBy: ['test/core/scenario/batch-pause-settlement.test.ts'],
    // One arm, three slots: the settled call's own tool, and the paused call
    // it is anchored to — by id and by tool. The markers pin the anchor, not
    // the wording around it (this file's rule for `reaches`); the wording is
    // pinned word for word in the scenario suite named in `drivenBy`, since
    // the checker's rows catch only some present-tense shapes.
    reaches: [/call 'c2' to 'collect_input'/, /Tool 'lookup_rows'/],
    compose: async () => [
      notDispatchedResult('lookup_rows', { toolName: 'collect_input', toolCallId: 'c2' }),
    ],
  },
  {
    id: 'trace toolpack — the tool-call inspection results',
    module: 'src/lib/trace-toolpack/traceToolpack.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      "these are the return values of the pack's `execute`, dispatched by a debugging agent " +
      'like any other tool — every later call of that session re-reads them',
    drivenBy: [
      'test/lib/trace-toolpack/inspectToolCall.test.ts',
      'test/lib/trace-toolpack/innerRunRecords.test.ts',
    ],
    // The arms this row composes, one marker each. NOT every arm of the
    // pack: the unknown-id arms of `inspect_tool_call` / `trace_node` carry
    // standing imperatives ("Call run_overview …") that this release did not
    // repair, and they are on the record as such in
    // `test/modelFacingScan.test.ts` rather than hidden by a row that quietly
    // does not compose them.
    reaches: [
      /TOOL CALL c1 — lookup_order/,
      /failed schema validation on call 'c1'/,
      /no retained inner run/,
      /Inner runs you CAN open/,
      /the outer run does not record a call with that id/,
      /No inner run was held when inspect_tool_run/,
      // The never-dispatched arm (9.113.0): anchored to the paused call and to
      // the settled one, by id.
      /not dispatched — the run paused on call 'c2' to 'second'.*without executing call 'c3'/,
    ],
    compose: traceToolpackResults,
  },
  {
    id: 'agent — the out-of-budget WRAP-UP frame',
    module: 'src/core/agent/stages/wrapUp.ts',
    surface: INJECTED_TURN,
    lifetimeBecause:
      'the stage appends it to `scope.history` as a `role: "user"` turn, so every later call ' +
      'of the turn re-reads it — a schema retry and an evidence recheck included',
    drivenBy: [
      'test/lib/injection-engine/userTurnProducers.test.ts',
      'test/core/agent-wrap-up.test.ts',
    ],
    reaches: [/action budget was exhausted before the wrap-up call this message opened/],
    compose: async () => [WRAP_UP_INSTRUCTION],
  },
  {
    id: 'skills — the stepped-skill NUDGE frame',
    module: 'src/lib/injection-engine/skillSteps.ts',
    surface: INJECTED_TURN,
    lifetimeBecause:
      'the nudge stage appends it to `scope.history` as a `role: "user"` turn — the same ' +
      'lifetime as the wrap-up, and the reason both had to stop speaking in the present',
    drivenBy: [
      'test/lib/injection-engine/userTurnProducers.test.ts',
      'test/core/agent/skill-steps.test.ts',
    ],
    // Both span arms: the range and the single step. They are one ternary
    // apart, and only one of them can be reached by any single fixture.
    reaches: [/Steps 1–3 of 'refund' had not run/, /Step 3 of 'refund' had not run/],
    compose: async () => stepNudges(),
  },
  {
    id: 'findings ledger — the reserved `_findings` argument DESCRIPTION',
    module: 'src/core/agent/findings/reserved.ts',
    surface: RESERVED_ARGUMENT_DESCRIPTION,
    lifetimeBecause:
      'it is a property of the served tool schema, rebuilt onto the committed list by ' +
      '`withFindingsArgument` for every request (`buildToolsSlot`, the seed fallback) and ' +
      'never written into `history` — the model reads a fresh copy on each call',
    drivenBy: [
      'test/core/agent/findings-ledger.test.ts',
      'test/adapters/reservedArgumentSurvives.test.ts',
    ],
    // One marker per description the schema carries: the versioned head, the
    // two basis arms, the four standings, and the stratum rule — the sentence
    // that says what the RECORD does with a declaration, not what serving will.
    reaches: [
      /^Findings v1/,
      /'direct' when you expect the result to answer/,
      /'exploratory' when you are looking/,
      /'noise' with nothing/,
      /a fact's assertions are asserted/,
      /leave a result unnamed rather than guess/,
    ],
    compose: async () => findingsSchemaDescriptions(),
  },
  {
    id: 'findings ledger — the always-on INSTRUCTION piece',
    module: 'src/core/agent/findings/reserved.ts',
    surface: ALWAYS_ON_INSTRUCTION,
    lifetimeBecause:
      '`.findings()` registers it through `defineInstruction` (the twin of `outputSchema()`), ' +
      'so it is a system piece the injection engine recomposes on every pass and the receipt ' +
      'hashes per request — never a `history` turn',
    drivenBy: [
      'test/core/agent/findings-ledger.test.ts',
      'test/lib/time-travel/receipt-conformance.test.ts',
    ],
    // The ask's four standings and its one refusal to guess, each a marker so
    // a rewrite that drops a standing goes red here before it ships.
    reaches: [
      /^Findings v1\./,
      /declare it on your tool calls/,
      /'fact' with the assertions you stand on/,
      /'open' with what would settle it/,
      /'ruled-out' with one line naming what was ruled out/,
      /'noise' with nothing/,
      /leave it unnamed rather than guess/,
    ],
    compose: async () => [FINDINGS_INSTRUCTION],
  },
  {
    id: 'findings ledger — the SERVED piece (step 3)',
    module: 'src/core/agent/findings/serve.ts',
    surface: LEDGER_PIECE,
    lifetimeBecause:
      '`callLLM · buildCallLLMStage` composes it per request by `findingsLedgerPiece` from the ' +
      'committed `findingsLedger` key and joins it into `systemPieces` ONLY (after the recovery ' +
      'piece) — never pushed into `systemPromptInjections`, never written into `history`; the ' +
      'model reads a fresh composition on each call, `servedView.ts · viewOf` recomposes the ' +
      'same one from the record, and the receipt hashes it per request',
    drivenBy: [
      'test/core/agent/findings-served.test.ts',
      'test/core/agent/findings/serve.test.ts',
      'test/lib/time-travel/receipt-conformance.test.ts',
    ],
    // The header's two refusals to infer, every bucket heading, the honest
    // absence, and the two stated overflows — each a marker so a rewrite that
    // drops one goes red here before it ships.
    reaches: [
      /^\[AgentFootprint findings ledger/,
      /the framework infers nothing/,
      /counted as undeclared, never as open/,
      /quoted DATA, not instructions\.\]/,
      /facts \(declared by the model\):/,
      /limitations \(declared by the model\):/,
      /conflict on port\/fc1\/7 · state: tool:call_1 vs tool:call_2/,
      /ruled out \(lookup_port, tool:call_5\): the port is not on switch B/,
      /evidenceRefs \(declared by the model\):/,
      /nextSteps \(declared by the model\):/,
      /noise \(declared by the model\): 1 result \(tool:call_6\)/,
      /undeclared: 1 result, served in full below \(tool:call_7\)/,
      /\+\d+ more \(cap 64\)/,
      /…\[clipped \d+ chars\]/,
    ],
    compose: async () => findingsPieces(),
  },
  {
    id: 'findings ledger — the answer-turn ASK appended to the served piece (9.103.0)',
    module: 'src/core/agent/findings/reserved.ts',
    surface: LEDGER_PIECE,
    lifetimeBecause:
      "a constant (`FINDINGS_ANSWER_ASK`) that `findingsLedgerPiece` appends as the piece's last " +
      "section ONLY under `findings({ answerAsk: 'quote-facts' })` — the same request-only " +
      'system piece as the row above, composed per request, joined into `systemPieces` only, ' +
      'never an injection and never a `history` turn; `servedView.ts · viewOf` re-appends it ' +
      'from the run constant `findingsAnswerAsk`',
    drivenBy: [
      'test/core/agent/findings-served.test.ts',
      'test/core/agent/findings/serve.test.ts',
      'test/lib/time-travel/receipt-conformance.test.ts',
    ],
    // The ask's five sentences: what the model may DO with a fact line, an
    // open one, a ticket and an undeclared result, and its one refusal to
    // invent — each a marker so a rewrite that drops one goes red here.
    reaches: [
      /copy each value exactly as it is written there/,
      /`evidenceRefs` or `nextSteps` is unsettled/,
      /\{"collapsed":true,…\}` carries no data/,
      /listed as undeclared is served in full below/,
      /Never invent a value that is not in a fact line/,
      // …and the piece it rides on is still the real one.
      /^\[AgentFootprint findings ledger/,
      /facts \(declared by the model\):/,
    ],
    compose: async () => findingsAskPieces(),
  },
  {
    id: 'findings ledger — the CONTINGENT line of the instruction (9.110.0)',
    module: 'src/core/agent/findings/reserved.ts',
    surface: ALWAYS_ON_INSTRUCTION,
    lifetimeBecause:
      'the same `findings-ledger` instruction as the row above — `AgentBuilder.build` rebuilds ' +
      'it in place with `FINDINGS_CONTINGENT_LINE` as its last line when the evidence gate is ' +
      'armed beside the ledger (`findingsInstructionFor`), so it is still a system piece the ' +
      'injection engine recomposes on every pass and the receipt hashes per request — never a ' +
      '`history` turn; and never registered on an agent with one door, where nothing is recorded ' +
      'as contingent and the sentence would be a promise the run could not keep',
    drivenBy: [
      'test/core/agent/findings/contingent.test.ts',
      'test/core/tools/byte-identity.test.ts',
    ],
    // What the record does with a value taken from a set-aside result, and
    // the two ways out — each a marker so a rewrite that drops one goes red.
    reaches: [
      /^Findings v1\./,
      /is recorded as contingent; either re-establish it from a result you stand on/,
      /or say your answer is contingent on it\.$/,
    ],
    compose: async () => [findingsInstructionFor({ contingent: true })],
  },
  {
    id: 'findings ledger — the served `contingent:` section (9.110.0)',
    module: 'src/core/agent/findings/serve.ts',
    surface: LEDGER_PIECE,
    lifetimeBecause:
      'the same request-only system piece as the SERVED piece row: `findingsLedgerPiece` quotes ' +
      'every `ContingentRow` of the committed `findingsLedger` under the heading `contingent (read ' +
      'off the record):` — the one section the header\'s "what the model itself declared" does not ' +
      "cover, named as the library's join so the header stays true — " +
      'composed per request, joined into `systemPieces` only, never an injection and never a ' +
      '`history` turn; `servedView.ts · viewOf` recomposes it from the record',
    drivenBy: [
      'test/core/agent/findings/contingent.test.ts',
      'test/core/agent/findings/serve.test.ts',
    ],
    // The heading, an answer-moment line, a dispatch-moment line with two
    // carriers — the grammar's every arm, each a marker.
    reaches: [
      /\ncontingent \(read off the record\):\n/,
      /^answer used fc1\/7 from tool:call_1 \(noise\)$/m,
      /^tool:call_7 used 41200 from tool:call_1 \(noise\), tool:call_4 \(open\)$/m,
      // …and the piece it rides on is still the real one.
      /^\[AgentFootprint findings ledger/,
      /noise \(declared by the model\): 1 result \(tool:call_1\)/,
    ],
    compose: async () => findingsContingentPieces(),
  },
  {
    id: 'findings ledger — the served `unsettled by absence:` section (9.113.0)',
    module: 'src/core/agent/findings/serve.ts',
    surface: LEDGER_PIECE,
    lifetimeBecause:
      'the same request-only system piece as the SERVED piece row: `findingsLedgerPiece` quotes ' +
      'the `UnsettledByAbsenceRow`s the ledger fold keeps (`foldLedger(...).unsettled`) under the ' +
      "heading `unsettled by absence (read off the record):` — the library's reading of the " +
      'result a ruled-out standing rests on, named as such so the header stays true — composed ' +
      'per request, joined into `systemPieces` only, never an injection and never a `history` ' +
      'turn; `servedView.ts · viewOf` recomposes it from the record',
    drivenBy: [
      'test/core/agent/findings/unsettled.test.ts',
      'test/core/agent/findings/serve.test.ts',
    ],
    // The heading, each head line, every part line — each a marker.
    reaches: [
      /\nunsettled by absence \(read off the record\):\n/,
      /^ruled out \(host_hbas, tool:call_1\) on an absence$/m,
      /^tool:call_1 not_checked: whether nas-cluster-06 is a hypervisor host — this lookup reads HBA rows only$/m,
      /^tool:call_1 not_checked: the archived HBA history$/m,
      /^tool:call_1 cannot_cover: hosts outside the collected inventory — one inventory per collector$/m,
      /^tool:call_1 try_instead: Look nas-cluster-06 up in cluster_inventory first\.$/m,
      /^ruled out \(port_lookup, tool:call_2\) on an absence$/m,
      // …and the piece it rides on is still the real one, the model's own
      // ruled-out line quoted as declared.
      /^\[AgentFootprint findings ledger/,
      /^ruled out \(host_hbas, tool:call_1\): not the path$/m,
    ],
    compose: async () => findingsUnsettledPieces(),
  },
  {
    id: 'inputs layer — the rule sentence on a ruled property (honesty layer 2)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: RULED_PROPERTY_DESCRIPTION,
    lifetimeBecause:
      'it is a property description on the served copy of the schema, rebuilt per request by ' +
      '`withArgumentRules` at the one decoration site; judged at the strictest lifetime because ' +
      'it states a rule and what the record keeps, which a later re-read cannot falsify',
    drivenBy: ['test/core/agent/arguments/layer.test.ts'],
    reaches: [
      /^Look-back period\. If left out, the tool's rule fills "2h", recorded as assumed\.$/m,
      /If left out, the tool's rule fills 50, recorded as assumed\./,
      /fills a declared value \(hidden by the tool's view\)/,
      /^Look-back period\. The tool's rule asks the person for this value; leave it out unless the person gave it\.$/m,
      // Step 5 (declared sources): the same rule, and where the model says the person gave it.
      /^Look-back period\. The tool's rule asks the person for this value; leave it out unless the person gave it, and then quote their words for it in `_findings\.from`\.$/m,
    ],
    compose: async () => ruledSchemaDescriptions(),
  },
  {
    id: 'time layer — the person’s windows, served late at the decision point (TQ13, step T6b)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: { channel: 'injected-turn', lifetime: 'request-ephemeral' },
    lifetimeBecause:
      'composed at the tools slot’s one decoration site from the turn’s recorded readings, the ' +
      'person’s answers in the time ask and the tools really served, stamped with its iteration, ' +
      'and appended by `callLLM` as the LAST `role: "user"` line of that one request — never ' +
      'written to history, so every later call re-reads a fresh composition (a pending quote the ' +
      'person then confirms is never re-read as pending)',
    drivenBy: ['test/core/time/english-run.test.ts'],
    reaches: [
      /^The person's time words, as the library holds them: “yesterday” is 2026-10-08 00:00–23:59 America\/Los_Angeles \(UTC-07:00\), the window the person confirmed when asked what their words meant — search_logs window "1960m" \(a wider read than the words named\); client_activity start_time 1791442800000, end_time 1791529200000\. A call may pass these values as written; an answer built on them states that window\.$/m,
      /client_activity start_time \(hidden by the tool's view\), end_time 1791529200000/,
      /, the window the person gave when asked what their words meant — /,
      /, a reading of the person's words they have not confirmed, not their words — /,
      /^The window for “yesterday” is not settled yet: the person confirms it in the library's own form, which shows its reading of those words with the zone and opens when search_logs is called with window left out, or client_activity is called with start_time, end_time left out \(or the call is refused with the reason\)\. So the next step is that call — not a question about the time in the reply, and not a window written into the call, which would run unconfirmed\.$/m,
      / that window\. The window for “10\/09\/26 8 AM to 8:40 AM PST”, “last 2 hours” is not settled yet: /,
      /^The window for “yesterday” is not settled: the person has not confirmed it, and the call that ran used a window written into it, unconfirmed\. An answer built on that call says its window was not confirmed by the person\.$/m,
    ],
    compose: async () => timeWindowLines(),
  },
  {
    id: 'time layer — the time limits an answer states, served late at the decision point (step T8)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: { channel: 'injected-turn', lifetime: 'request-ephemeral' },
    lifetimeBecause:
      'composed at the tools slot’s one decoration site from the turn’s `period` rows whose result ' +
      'checks hold and its `source-clock` rows (`coverage/timeLimits.ts` · `timeLimitLinesOf`, the ' +
      'owner the limits block also asks), appended to the ONE served time line, which `callLLM` ' +
      'serves as the LAST `role: "user"` line of that one request — never written to history',
    drivenBy: ['test/core/time/limits-served.test.ts'],
    reaches: [
      /^The time the tools read is not the time asked about, and an answer says so: client_activity read less than was asked — asked: .+; read: .+\. An answer states the time each result read and claims nothing about time no result read\.$/m,
      /search_logs read more than the person's window — the person's window: /,
      /client_activity: the time asked about is older than the oldest data the tool declares its source keeps/,
      /^Clocks: the sources' clocks differ \(UTC, America\/New_York\) — compared as instants\.$/m,
    ],
    compose: async () => timeLimitLines(),
  },
  {
    id: 'inputs layer — the note on a result whose call ran on a filled value (honesty layer 2)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'ToolCalls appends it to the `role: "tool"` result of the call it names, so it is written ' +
      'into `history` and re-read on every later call of the turn — past tense, anchored to ' +
      '"the call this result answers"',
    drivenBy: ['test/core/agent/arguments/layer.test.ts'],
    reaches: [
      /the call ran with "2h", the value the tool's rule assumes/,
      /hidden by the tool's view/,
      /window = "24h" in the search_logs call this result answers was chosen by the person when asked \(the call had left it out\)/,
      /chosen by the person when asked \(the value is hidden by the tool's view; the call had left it out\)/,
      // Step 5 (declared sources): the answer REPLACED a value the call carried.
      /window = "24h" in the search_logs call this result answers was chosen by the person when asked \(the call had carried "2h"\)/,
      /\(the value is hidden by the tool's view; the call had carried a value of its own\)/,
      // …and, under the arm, a later call may cite the answer (never for a hidden one).
      /was chosen by the person when asked \(the call had left it out\); a later call may cite that answer in `_findings\.from` with source 'turn'\.\]$/m,
      /\(the call had carried "2h"\); a later call may cite that answer in `_findings\.from` with source 'turn'\.\]$/m,
      // Time layer step T5a: the turn's one window of the person's filled the value.
      /the call ran with 1791558000000, from the window the person's own words gave — recorded as the person's\.\]/,
      /from a reading of the person's words they have not confirmed — recorded as a reading, not as the person's\.\]/,
      /the call ran with "2026-10-09T14:00:00Z\.\.2026-10-09T14:59:59Z", from the window the person set in the app — recorded as set in the app\.\]/,
      /the call ran with a value from the window the person's own words gave — recorded as the person's \(the value is hidden by the tool's view\)\.\]/,
      /the call ran with \{"gte":1791558000000,"lt":1791560460000\}, from the window/,
      // Time layer step T5b: no form held the window exactly — the value reads a wider one.
      /the call ran with "1960m", from the window the person's own words gave — recorded as the person's; the tool's form could not hold that window exactly, so the value reads a wider one — recorded as wider than asked\.\]/,
      /so the value reads a wider one, and the tool declares that it drops the rows outside the asked window\.\]/,
      /\(the value is hidden by the tool's view\); the tool's form could not hold that window exactly/,
      // Time layer step T6b: the window the person CHOSE when the library asked about their words.
      /the call ran with 1791558000000, from the window the person chose when asked what their words meant — recorded as the person's answer\.\]/,
      /recorded as the person's answer; the tool's form could not hold that window exactly, so the value reads a wider one — recorded as wider than asked\.\]/,
    ],
    compose: async () => [
      filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: false }]),
      filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: true }]),
      filledNote('search_logs', [
        { argument: 'window', value: '24h', hidden: false, source: 'answered' },
      ]),
      filledNote('search_logs', [
        { argument: 'window', value: '24h', hidden: true, source: 'answered' },
      ]),
      filledNote('search_logs', [
        { argument: 'window', value: '24h', hidden: false, source: 'answered', carried: '2h' },
      ]),
      filledNote('search_logs', [
        { argument: 'window', value: '24h', hidden: true, source: 'answered', carried: '2h' },
      ]),
      // Declared sources: the `turn` clause — and a hidden answer, which gets none.
      filledNote(
        'search_logs',
        [{ argument: 'window', value: '24h', hidden: false, source: 'answered' }],
        { sources: true },
      ),
      filledNote(
        'search_logs',
        [{ argument: 'window', value: '24h', hidden: false, source: 'answered', carried: '2h' }],
        { sources: true },
      ),
      filledNote(
        'search_logs',
        [{ argument: 'window', value: '24h', hidden: true, source: 'answered' }],
        { sources: true },
      ),
      filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: false }], {
        sources: true,
      }),
      // Time layer step T5a: a window fill, from each of the three sources, and hidden.
      filledNote('client_activity', [
        {
          argument: 'start_time',
          value: 1791558000000,
          hidden: false,
          source: 'window',
          from: 'said',
        },
      ]),
      filledNote('client_activity', [
        {
          argument: 'start_time',
          value: 1791558000000,
          hidden: false,
          source: 'window',
          from: 'derived-from-reading',
        },
      ]),
      // Time layer step T5b: a widened fill — read more, or trimmed by the tool; and hidden.
      filledNote('search_logs', [
        {
          argument: 'window',
          value: '1960m',
          hidden: false,
          source: 'window',
          from: 'said',
          wider: 'reads-more',
        },
      ]),
      filledNote('search_logs', [
        {
          argument: 'window',
          value: '1960m',
          hidden: false,
          source: 'window',
          from: 'control',
          wider: 'tool-trims',
        },
      ]),
      filledNote('search_logs', [
        {
          argument: 'window',
          value: '1960m',
          hidden: true,
          source: 'window',
          from: 'said',
          wider: 'reads-more',
        },
      ]),
      filledNote('search_logs', [
        {
          argument: 'window',
          value: '2026-10-09T14:00:00Z..2026-10-09T14:59:59Z',
          hidden: false,
          source: 'window',
          from: 'control',
        },
      ]),
      filledNote('client_activity', [
        {
          argument: 'start_time',
          value: 1791558000000,
          hidden: true,
          source: 'window',
          from: 'said',
        },
      ]),
      filledNote('client_activity', [
        {
          argument: 'range',
          value: { gte: 1791558000000, lt: 1791560460000 },
          hidden: false,
          source: 'window',
          from: 'said',
        },
      ]),
      filledNote('client_activity', [
        {
          argument: 'start_time',
          value: 1791558000000,
          hidden: false,
          source: 'window',
          from: 'answered',
        },
      ]),
      filledNote('search_logs', [
        {
          argument: 'window',
          value: '1960m',
          hidden: false,
          source: 'window',
          from: 'answered',
          wider: 'reads-more',
        },
      ]),
    ],
  },
  {
    id: 'inputs layer — the refusals of a ruled call (honesty layer 2)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'each lands as the `role: "tool"` result of the call it refused, in the argument-refusal ' +
      'shape, so it is written into `history`',
    drivenBy: ['test/core/agent/arguments/layer.test.ts'],
    reaches: [
      /its argument rules could not be read \(askOrAssume\.window\.assume/,
      /this agent was not built to apply/,
    ],
    compose: async () => ruledRefusals(),
  },
  {
    id: 'time layer — a call refused before dispatch on its window (step T5b)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'each lands as the `role: "tool"` result of the call it refused, in the argument-refusal ' +
      'shape, so it is written into `history` — past tense, anchored to "that call", naming only ' +
      "the tool's declared facts and an argument name, never the window's value",
    drivenBy: ['test/core/time/widen-run.test.ts'],
    reaches: [
      /search_logs was not run on that call: the window it asked for had not happened yet, and the tool declares that its source holds only the past\./,
      /the window it asked for had already ended, and the tool declares that its source holds only the future\./,
      /was wholly older than the oldest data the tool declares its source keeps \(30d\)\./,
      /was wider than the tool declares it reads at once \(maxRange 24h\); narrower windows, one call each, may be proposed instead\./,
      /spanned more than one calendar day, and the tool reads one day per call; one call per day may be proposed instead\./,
      /the wall time sent for start does not exist in the tool's zone — the clocks skip it at a daylight-saving change\./,
    ],
    compose: async () => [
      ...(
        ['time-future', 'time-past', 'beyond-retention', 'over-max-range', 'multi-day'] as const
      ).map((r) => timeRefusal('search_logs', r, { retention: '30d', maxRange: '24h' })),
      timeRefusal('badge_swipes', 'dst-gap', {}, 'start'),
    ],
  },
  {
    id: 'inputs layer — the batch ask’s refusals (honesty layer 2, step 4)',
    module: 'src/core/agent/arguments/serve.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'each lands as the `role: "tool"` result of the call it refused — a call whose person’s ' +
      'answers never fitted the tool, or a call that needed a second pause in a batch that had ' +
      'already paused once for the layer’s own ask — so it is written into `history`, past tense, ' +
      'anchored to "that call"',
    drivenBy: ['test/core/agent/arguments/ask-layer.test.ts'],
    reaches: [
      /the person's answers for limit did not fit what the tool accepts \(limit: integer\)/,
      // Time layer step T5a: the tool's declared facts joined the re-check.
      /\(window: a window that has already happened \(the source holds only the past\)\)/,
      /\(window: a window still to come \(the source holds only the future\)\)/,
      /\(window: a window inside what the source keeps \(30d\)\)/,
      /\(window: a window no wider than 24h\)/,
      // Time layer step T6b: the window asked of the person fits no form, or no time exists in the zone.
      /did not fit what the tool accepts \(start_time: a window one of the tool's declared period forms can hold\)/,
      /\(start_time: a time zone in which the time the person wrote exists\)/,
      /its check-in consent gate needed a person’s approval for those arguments/,
      /the tool asked to pause for a person, and this batch had already paused once/,
      // The review of step 4: a refused call's answers are KEPT, and the model is told so.
      /The person's answer for window was kept for the next purge_logs call that leaves it out, so the call may be proposed again without window\./,
      /The person's answers for window and limit were kept for the next export_logs call that leaves them out, so the call may be proposed again without them\./,
    ],
    compose: async () => [
      unansweredRefusal('top_talkers', [{ argument: 'limit', expected: 'integer' }]),
      ...(['time-future', 'time-past', 'beyond-retention', 'over-max-range'] as const).map((p) =>
        unansweredRefusal('search_logs', [
          {
            argument: 'window',
            expected: factExpectation(p, { retention: '30d', maxRange: '24h' }),
          },
        ]),
      ),
      unansweredRefusal('client_activity', [
        { argument: 'start_time', expected: WINDOW_FORM_EXPECTATION },
      ]),
      unansweredRefusal('client_activity', [
        { argument: 'start_time', expected: WINDOW_ZONE_EXPECTATION },
      ]),
      secondPauseRefusal('purge_logs', 'check-in'),
      secondPauseRefusal('collect_window', 'tool-pause'),
      secondPauseRefusal('purge_logs', 'check-in') + keptAnswersNote('purge_logs', ['window']),
      secondPauseRefusal('export_logs', 'tool-pause') +
        keptAnswersNote('export_logs', ['window', 'limit']),
    ],
  },
  {
    id: 'inputs layer — the `_findings.from` property on a ruled tool (honesty layer 2, step 5)',
    module: 'src/core/agent/findings/reserved.ts',
    surface: DECLARED_SOURCES_PROPERTY,
    lifetimeBecause:
      "a property of the served copy of a RULED tool's schema, planted by `withFindingsArgument` " +
      '(its `from` option) or, without the ledger, by `withSourcesArgument` at the one decoration ' +
      'site and its seed twin, rebuilt per request — judged at the strictest lifetime anyway, ' +
      'because it says what the model may declare and what the record keeps, and promises ' +
      'nothing a later path can break',
    drivenBy: [
      'test/core/agent/arguments/sources-layer.test.ts',
      'test/core/agent/arguments/sources-served.test.ts',
    ],
    // Every description the property carries — the array's, the source's, the quote's — and
    // the sources-only decoration's own (the versioned marker alone).
    reaches: [
      /^Where each argument value the call sends came from, one entry per value, recorded with the library's check of it; a value with no entry has no declared source on the record\.$/m,
      /^'user': the person's words \(quote\); 'result': a tool result \(id\); 'turn': their answer when the run asked them; 'app': your instructions; 'assumed': your own choice\.$/m,
      /^Copied exactly from the person's messages\.$/m,
      /^Findings v1 \(reserved by the agent runtime\)\.$/m,
    ],
    compose: async () => [
      ...findingsSchemaDescriptions(FINDINGS_FROM_PROPERTY),
      ...findingsSchemaDescriptions(FINDINGS_SOURCES_SCHEMA),
    ],
  },
  {
    id: 'result helpers — the empty-data refusal names absent() (honesty step 7a′)',
    module: 'src/lib/semantics/envelope.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the mint throws inside the tool’s `execute`, and the dispatch loop turns the throw into ' +
      'that call’s error result — a `role: "tool"` message written into `history` and re-read on ' +
      'every later call of the turn',
    drivenBy: ['test/lib/semantics/empty-data-refusal.test.ts'],
    reaches: [
      /^refused: `facts` is empty — if nothing matched, return absent\(\{ what, checked \}\) instead\. \(field: facts\)$/m,
      /^refused: `series` is empty — if nothing matched, return absent\(\{ what, checked \}\) instead\. \(field: series\)$/m,
      /^refused: `edges` is empty — if nothing matched, return absent\(\{ what, checked \}\) instead\. \(field: edges\)$/m,
    ],
    compose: async () => emptyDataRefusals(),
  },
  {
    id: 'result doors — the served period verdict word and its one clause (honesty step 7b, bench round 1)',
    module: 'src/core/agent/coverage/period.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the dispatch door serves it inside the `role: "tool"` result of the call whose period it ' +
      'judges (`coverage/read.ts` · `servedToModel`, `semanticsForModel`), so it is written into ' +
      '`history` and re-read on every later call of the turn — anchored to "this result" and ' +
      "to the result's own `period` keys, never to a time",
    drivenBy: ['test/core/agent/results/layer.test.ts'],
    reaches: [
      /`period\.verdict` is `not-held`: the store holds none of the time this read asked about/,
      /`period\.verdict` is `partly-held`: the store holds only part of the time this read asked about/,
      /`period\.verdict` is `unknown`: the tool cannot say what time its store holds/,
      /`checked` is the ground this answer covers inside `period\.held` only/,
    ],
    compose: async () => servedPeriodNotes(),
  },
  {
    id: 'result doors — the served in-progress clause (honesty layer 3, the third outcome)',
    module: 'src/core/agent/coverage/inProgress.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the dispatch door appends it to the note of a `coverage()` ledger that declares a ' +
      'non-empty `in_progress` (`coverage/read.ts` · `servedToModel`), inside the `role: "tool"` ' +
      'result of that call, so it is written into `history` and re-read on every later call of ' +
      'the turn — anchored to "the call this result answers" and to the result’s own ' +
      '`in_progress` key, never to a time',
    drivenBy: ['test/core/agent/coverage-in-progress.test.ts'],
    reaches: [
      /`in_progress` is what the call this result answers found still running: its outcome is not known yet, so it is neither a success nor a failure — report it as in progress, never as either\./,
    ],
    compose: async () => [
      String(
        (
          servedToModel(
            coverage(1, {
              checked: ['every session'],
              inProgress: ['sessions still synchronizing'],
            }),
          ) as { af_coverage: { note: string } }
        ).af_coverage.note,
      ),
    ],
  },
  {
    id: 'answer layer — the standing line appended to a prose answer (honesty layer 4)',
    module: 'src/core/agent/assessment/compose.ts',
    surface: INJECTED_TURN,
    lifetimeBecause:
      'appended after the answer under `.answerLayer({ standingLine: true })`, so it is part of ' +
      'the assistant turn a continued conversation carries (`agent.checkpoint()` keeps the ' +
      'answer) and every later call of that conversation re-reads it — it says what the ' +
      'record held when this answer was given, never what is true of the world',
    drivenBy: ['test/core/agent/assessment/answer-layer.test.ts'],
    reaches: [
      /^Not sure — window = "2h" was assumed by search_logs's rule, not given by you/m,
      /its value is hidden by the tool's view/,
      /a before-tool rule set a value a call ran with and did not say where it came from/,
      /a value a call ran with was read into your words: the quoted words are on the record, the value is not in them/,
      /a value a call ran with was taken from a result the model itself had set aside/,
      /a time in the answer is the library's own spelling of your words, not something you said or a tool returned/,
      /a tool read a different stretch of time than the one asked about/,
      /the time asked about is older than a tool declares its source keeps/,
      /^Consistent with the run's record — 2 checks ran and none fired/m,
      /^Consistent with the run's record — 1 check ran and did not fire: argument rules\./m,
      /^Known — the app's answer checks passed this exact answer\.$/m,
      /^Not assessed — no check applied to this answer\.$/m,
      /a tool's data does not reach the time the question asked about/,
      /^Consistent with the run's record — 1 check ran and did not fire: the time each result covered\./m,
      /^Ask — the run stopped to ask a question before it could answer\.$/m,
    ],
    compose: async () => {
      const base = { assessment: 'unknown' as const, checked: [] };
      return [
        standingLineOf(
          { ...base, standing: 'not-sure', reasons: ['argument-assumed', 'empty-undeclared'] },
          [
            { toolName: 'search_logs', argument: 'window', value: '2h', hidden: false },
            { toolName: 'vault', argument: 'token', value: 'REDACTED', hidden: true },
          ],
          true,
        ),
        standingLineOf(
          {
            ...base,
            standing: 'not-sure',
            reasons: [
              'argument-unverified',
              'argument-read',
              'value-contingent',
              'coverage-gap',
              'declared-absent',
              'sources-conflict',
              'value-unsupported',
              'value-survived-revision',
              'derived-from-reading',
              'stopped-early',
              'steps-unfinished',
              'answer-check-failed',
              'check-unreachable',
            ],
          },
          [],
          false,
        ),
        standingLineOf(
          {
            assessment: 'unrefuted',
            standing: 'consistent',
            reasons: [],
            checked: [
              { layer: 3, check: 'result-shape', ran: 1, of: 1 },
              { layer: 4, check: 'names-and-numbers', ran: 1, of: 1 },
            ],
          },
          [],
          false,
        ),
        standingLineOf(
          {
            assessment: 'unrefuted',
            standing: 'consistent',
            reasons: [],
            checked: [{ layer: 2, check: 'argument-rules', ran: 1, of: 1 }],
          },
          [],
          false,
        ),
        // The results layer's period reasons and check (honesty step 7b).
        standingLineOf(
          {
            ...base,
            standing: 'not-sure',
            reasons: [
              'period-not-held',
              'period-partly-held',
              'period-unknown',
              'period-undeclared',
              // The time layer's result checks (step T8).
              'period-differs-from-asked',
              'period-beyond-retention',
            ],
          },
          [],
          false,
        ),
        standingLineOf(
          {
            assessment: 'unrefuted',
            standing: 'consistent',
            reasons: [],
            checked: [{ layer: 3, check: 'result-period', ran: 1, of: 1 }],
          },
          [],
          false,
        ),
        standingLineOf({ ...base, assessment: 'known', standing: 'known', reasons: [] }, [], false),
        standingLineOf(
          { ...base, assessment: 'not-applicable', standing: 'not-assessed', reasons: [] },
          [],
          false,
        ),
        standingLineOf(
          { ...base, standing: 'ask', reasons: ['asked', 'argument-asked'] },
          [],
          false,
        ),
      ];
    },
  },
  {
    id: 'ontology — the always-on INSTRUCTION piece (9.106.0; v2 9.107.0; v3 9.108.0)',
    module: 'src/ontology/instruction.ts',
    surface: ALWAYS_ON_INSTRUCTION,
    lifetimeBecause:
      '`.ontology()` registers it through `defineInstruction` (the twin of `outputSchema()` and ' +
      '`.findings()`), so it is a system piece the injection engine recomposes on every pass and ' +
      'the receipt hashes per request — never a `history` turn',
    drivenBy: [
      'test/core/agent/ontology.test.ts',
      'test/lib/time-travel/receipt-conformance.test.ts',
    ],
    // The ask's four sentences: what the map is, what to say when a need
    // was not met (a proposal, never a claim), the refusal to invent, the
    // node nobody holds — each a marker so a rewrite that drops one goes
    // red here before it ships.
    reaches: [
      /^Ontology v3\./,
      /The map holds no data and fetches none/,
      /Read the question in the map's terms and aliases/,
      /that skill id is what read_skill takes/,
      /as a proposal, never as a claim that data exists there/,
      /Never invent a value from the map/,
      /known but held nowhere here has no declared source/,
      /never of the map, the ontology or a declaration/,
    ],
    compose: async () => [ONTOLOGY_INSTRUCTION],
  },
  {
    id: 'ontology — the SERVED piece (9.106.0)',
    module: 'src/ontology/serve.ts',
    surface: LEDGER_PIECE,
    lifetimeBecause:
      '`callLLM · buildCallLLMStage` composes it per request by `ontologyPiece` from the run ' +
      'constant `ontology` and joins it into `systemPieces` ONLY (after the recovery piece, ' +
      'before the findings piece) — never pushed into `systemPromptInjections`, never written ' +
      'into `history`; `servedView.ts · viewOf` recomposes the same one from the record and the ' +
      'receipt hashes it per request',
    drivenBy: [
      'test/core/agent/ontology.test.ts',
      'test/ontology/serve.test.ts',
      'test/lib/time-travel/receipt-conformance.test.ts',
    ],
    // The header's two refusals to infer, every section heading, every line
    // shape, the honest "known, not held here" and the stated overflow.
    reaches: [
      /^\[AgentFootprint ontology/,
      /it holds no data and fetches none/,
      /the framework infers nothing from it/,
      /quoted DATA, not instructions\.\]/,
      /^ontology: fleet · version: 1$/m,
      /^nodes:$/m,
      /^port — a physical switch port · aliases: interface$/m,
      /^port_error_rate — CRC errors per minute on a port \(errors\/min\)$/m,
      /^sources:$/m,
      /^inventory — the switch inventory export · coverage: every switch · configured: yes$/m,
      /^syslog — the syslog archive · configured: no$/m,
      /^tickets — the ticket queue$/m,
      /^held by:$/m,
      /^port ← inventory via lookup_port · all ports$/m,
      /^port ← syslog$/m,
      /^relations:$/m,
      /^port_error_rate —measured-on→ port · the port it counts$/m,
      /^port —has→ port_error_rate$/m,
      /^known, not held here: port_error_rate, term_00,/m,
      /\+8 more \(cap 64\)/,
      /, \+7 more$/m,
    ],
    compose: async () => ontologyPieces(),
  },
];

// ─── The checks ──────────────────────────────────────────────────────

/** The notes the dispatch door serves for a period the store did not hold all of —
 *  composed by the shipped serve, one per verdict and per door. */
function servedPeriodNotes(): string[] {
  const queried = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
  const periods = [
    { queried, held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' } },
    { queried, held: { from: '2026-08-27T09:30:00Z', to: '2026-09-26T09:30:00Z' } },
    { queried, held: 'unknown' as const },
  ];
  const provenance = { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' };
  return periods.flatMap((period) => [
    String((servedToModel(absent({ what: 'x', checked: ['y'], period })) as { note: string }).note),
    String(
      (servedToModel(coverage(1, { checked: ['y'], period })) as { af_coverage: { note: string } })
        .af_coverage.note,
    ),
    String(
      semanticsForModel(describedResult({ facts: [{ entity: 'h' }], provenance, period })).note,
    ),
  ]);
}

describe('the model-facing inventory', () => {
  it('every registered producer composes real output, and the checker reads all of it', async () => {
    for (const producer of PRODUCERS) {
      const texts = await producer.compose();
      // A row that composes nothing exercises nothing — and would pass every
      // assertion below by having no text to fail on.
      expect(texts.length, `${producer.id} composed no output`).toBeGreaterThan(0);
      for (const text of texts) {
        expect(text.length, `${producer.id} composed an empty string`).toBeGreaterThan(0);
        expect(unprovable(text, producer.surface), `${producer.id} — ${text}`).toEqual([]);
      }
      const all = texts.join('\n');
      for (const marker of producer.reaches) {
        expect(marker.test(all), `${producer.id} no longer reaches ${marker.source}`).toBe(true);
      }
    }
  });

  it('the alarm is wired — a known-false sentence is still caught at every persistent surface', () => {
    // Without this, a checker that silently stopped reporting would turn every
    // row above green. The sentence is the one that shipped three times.
    for (const producer of PRODUCERS) {
      if (producer.surface.lifetime !== 'persistent-history') continue;
      expect(
        unprovable('nothing is live in this scope right now', producer.surface),
        producer.id,
      ).not.toEqual([]);
    }
  });

  it('the container deictic is caught where it cannot be attributed, and left alone where it can', () => {
    // The literal sentence `codeRunnerTool` shipped before this phase, checked
    // through the CHECKER rather than through the source. That is the whole
    // difference between a rule and a copy of the fix: a suite holding only a
    // `toContain` of the new wording goes green again the moment somebody
    // reverts the repair, because the sentence it names is simply gone. This
    // one goes red, because the class is still banned.
    const shipped =
      '[staged into this session before your code ran: dataset — paths are in AF_STAGED_INPUTS]';
    expect(unprovable(shipped, TOOL_RESULT)).not.toEqual([]);
    // The repaired sibling, which names the call — the row has to let this
    // through or the repair it demands is not reachable.
    expect(
      unprovable(
        '[staged for the run_code call this result answers, before its code ran: dataset — ' +
          'their paths were in AF_STAGED_INPUTS for that call]',
        TOOL_RESULT,
      ),
    ).toEqual([]);
    // And the boundary. Not a registered producer — it stands for the DIMENSION
    // the exemption is keyed to, since the checker judges `lifetime` and
    // nothing else. The words are `codeRunnerTool`'s own tool description,
    // which says exactly what the banned result said and is true: a
    // description states the tool's mechanism instead of reporting one call,
    // and it rides the request's `tools` array instead of accumulating in
    // `history`. A ban with no boundary is a ban that gets deleted the first
    // time it fires on a true sentence.
    const AN_EPHEMERAL_SURFACE: Surface = {
      channel: 'tool-description',
      lifetime: 'request-ephemeral',
    };
    expect(
      unprovable(
        "Pass artifact refs as 'dataset' and their data is written into this session as " +
          'files BEFORE your code runs — never paste the data into the code.',
        AN_EPHEMERAL_SURFACE,
      ),
    ).toEqual([]);
  });

  it('every exemption carries an argument, and every row a reason — structurally', () => {
    // `exemptBecause` was DOCUMENTED as required and enforced nowhere: the two
    // fields were independent optionals, so a row could exempt a whole
    // lifetime and say nothing about why, and no reader would ever see the
    // omission. The type is a discriminated union now (both fields, or
    // neither), and this is the half a union cannot do: an empty string is
    // still a string.
    for (const row of BANNED_CLAUSES) {
      expect(row.why.trim().length, `${row.re.source} has no \`why\``).toBeGreaterThan(0);
      if (row.provableWhen === undefined) continue;
      expect(
        row.provableWhen.length,
        `${row.re.source} exempts no lifetime — an exemption that exempts nothing`,
      ).toBeGreaterThan(0);
      expect(
        row.exemptBecause.trim().length,
        `${row.re.source} exempts a lifetime with no argument`,
      ).toBeGreaterThan(0);
      // A STRICT subset of the lifetimes (9.86.1). `provableWhen` naming both
      // lifetimes compiles, carries an argument, and disables the row
      // everywhere — the exemption-with-no-argument defect in a new coat. There
      // are exactly two lifetimes, so "strict subset" is "fewer than two".
      expect(
        row.provableWhen.length,
        `${row.re.source} exempts EVERY lifetime — a rule that fires nowhere`,
      ).toBeLessThan(2);
    }
  });

  it('every producer row states WHY its lifetime is what it is', () => {
    // A lifetime is what the rules judge on, so an asserted one is an
    // exemption with no argument wearing a different field name.
    for (const producer of PRODUCERS) {
      expect(
        producer.lifetimeBecause.trim().length,
        `${producer.id} asserts a lifetime with no evidence`,
      ).toBeGreaterThan(0);
    }
  });

  it('every producer and every end-to-end suite it names is still on disk', () => {
    for (const producer of PRODUCERS) {
      expect(existsSync(resolve(process.cwd(), producer.module)), producer.module).toBe(true);
      for (const suite of producer.drivenBy) {
        expect(existsSync(resolve(process.cwd(), suite)), `${producer.id} → ${suite}`).toBe(true);
      }
    }
  });
});

/**
 * THE PROBE — fifteen sentences nobody has shipped, put to the checker.
 *
 * The rules were a list of the exact wordings that had already escaped, and a
 * list of past wordings can only ever catch the past. So fifteen plausible
 * forward-looking sentences were written — the kind a maintainer produces
 * without thinking twice, on a surface that keeps them — and run through the
 * checker as it stood. THIRTEEN passed. Four of them are quoted in the shape
 * rows of `modelFacingClaims.ts`, because they are the reason those rows
 * exist.
 *
 * The probe is kept as a test rather than as a note, because the interesting
 * direction is FORWARD: it fails the day somebody narrows a shape row to let
 * one sentence through, which is exactly how a checker dies.
 *
 * The second half is the other half of the same guard. A rule that catches
 * every sentence catches nothing — it gets deleted the first time it fires on
 * a true one. So the repaired forms, the ones real producers ship today, must
 * pass, and they are quoted from the producers rather than invented here.
 */
describe('the checker catches the shapes, not only the wordings it has seen', () => {
  const FORWARD_LOOKING: readonly string[] = [
    // Present-tense capability census — the wire moves under all four.
    'The following tools are available to you: calc, probe.',
    "The 'billing' skill is active for the rest of this turn.",
    'Nothing is live in this scope at the moment.',
    'The zone-audit map is loaded, and its members are reachable.',
    'Two skills are reachable from here: refunds and shipping.',
    // Deictic present — pointing at the moment of reading.
    "You are currently in 'alpha'.",
    'Its tools and instructions are now available.',
    'No inner runs are held right now.',
    // Second-person effect — a forecast the posture or the budget can refuse.
    'Calling read_skill switches you to beta.',
    "read_skill('vault') grants you the vault tools.",
    'The refunds skill activates you into a new tool set.',
    // Standing imperatives — orders that outlive the conditions they were
    // composed under.
    'Pick one of the skills above, or finish.',
    'Do not call read_skill again on this turn.',
    'Call run_overview to see what the run did do.',
    'Use trace_node for its details, or trace_slice from a downstream step.',
  ];

  /**
   * THE SECOND PROBE (9.86.1) — seventeen sentences written AGAINST the rows,
   * not from them.
   *
   * The fifteen above were the sentences the 9.86.0 shape rows were written
   * to; a suite that proves the rules catch the sentences they were derived
   * from proves the probe, not the class. A reviewer wrote seventeen more in
   * the same class — the plainest forecast forms, the ones a maintainer types
   * without thinking — and all seventeen walked past the rows as they stood:
   * the effect-verb row knew no future tense, the cursor row wanted a quote
   * right after `in `, the copula row knew six nouns, and a headed list has no
   * copula at all. The rows were widened to the grammar they claim, and these
   * are kept here so the next narrowing fails by name.
   */
  const FORWARD_LOOKING_SECOND_PROBE: readonly string[] = [
    // Effect verbs in the future and modal tenses.
    "read_skill will move you to 'beta'.",
    "read_skill('vault') will take you to the vault tools.",
    'You may call read_skill to switch skills.',
    // Cursor claims with a noun, a contraction, or a possessive.
    "You are in skill 'alpha'.",
    "You're in 'alpha'.",
    "Your current skill is 'alpha'.",
    // Headed inventories — the census with its verb elided.
    'Available tools: calc, probe.',
    'Tools you have: calc, probe.',
    'Skills you can reach: refunds, shipping.',
    // The copula with the nouns real producers use.
    "'billing' is enabled for this turn.",
    'The vault tools are yours to use.',
    'Nothing is in scope.',
    'The zone-audit map is mounted.',
    'read_skill is off the wire.',
    'No tools are offered on this request.',
    'Tools have been withheld.',
    // A forecast about the next call.
    'The budget has run out; the next call will not run a tool.',
  ];

  it('catches all fifteen at a persistent lifetime — thirteen of them used to pass', () => {
    const escaped = FORWARD_LOOKING.filter(
      (sentence) => unprovable(sentence, TOOL_RESULT).length === 0,
    );
    expect(escaped).toEqual([]);
  });

  it('catches the seventeen written against the rows — all seventeen used to pass (9.86.1)', () => {
    const escaped = FORWARD_LOOKING_SECOND_PROBE.filter(
      (sentence) => unprovable(sentence, TOOL_RESULT).length === 0,
    );
    expect(escaped).toEqual([]);
  });

  it('the widened rows still stand down on an ephemeral surface where the sentence is a report', () => {
    // The other half of widening: a `read_skill` description saying "Available
    // skills: refunds, shipping." on the request that offers them is a report,
    // and the headed-inventory row must let it through there — a row that fires
    // on every true description gets deleted.
    expect(unprovable('Available skills: refunds, shipping.', GRAPH_TOOL_DESCRIPTION)).toEqual([]);
    expect(unprovable("You are in skill 'alpha'.", GRAPH_TOOL_DESCRIPTION)).toEqual([]);
    // And two that are banned everywhere: pointing at the moment of reading,
    // and forecasting what a call after this one will do.
    expect(unprovable("You're currently in 'alpha'.", GRAPH_TOOL_DESCRIPTION)).not.toEqual([]);
    expect(unprovable('The next call will not run a tool.', GRAPH_TOOL_DESCRIPTION)).not.toEqual(
      [],
    );
  });

  it('the LIFETIME decides: one sentence, clean as a description and false as a result', () => {
    // The worked example in `src/lib/injection-engine/README.md`, executed
    // here so the documented law cannot drift from the rules. The description
    // is recomposed for the request being answered and may report the
    // present; the same words on a tool result are re-read after the cursor
    // and the graph have moved.
    const offer = "You are in 'billing'. Two skills are reachable from here: refunds, shipping.";
    expect(unprovable(offer, GRAPH_TOOL_DESCRIPTION)).toEqual([]);
    // The cursor claim, the reachability claim and the capability census —
    // three rows, three different ways the same sentence goes stale.
    expect(unprovable(offer, TOOL_RESULT).length).toBeGreaterThanOrEqual(3);
  });

  it('leaves the anchored past-tense forms alone — the repair has to be reachable', () => {
    // Every one of these is a sentence a producer in this tree composes today.
    const anchored: readonly string[] = [
      'read_skill("vault") was not granted on that call: \'vault\' was not reachable from ' +
        "'billing'. Skills reachable from 'billing' when that call was made: refunds.",
      "Unknown tool 'nope' on that call. Tool names that resolved to an implementation on " +
        'that call: calc, probe.',
      'Open skills were admitted on that call: debug.',
      "⚠ the arguments failed schema validation on call 'c1' — see the validation event / the " +
        'tool result, which carries the correction the model was given.',
      "No inner run was held when inspect_tool_run('c1') was answered. A tool that keeps " +
        'records had not been called in the turn this trace covers.',
      'You named the skill you were already standing in on that call, so nothing moved.',
    ];
    for (const sentence of anchored) {
      expect(unprovable(sentence, TOOL_RESULT), sentence).toEqual([]);
    }
  });
});
