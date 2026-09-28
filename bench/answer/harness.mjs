/**
 * bench/answer/harness.mjs — runs ONE (case, arm, repetition) of the answer-layer bench and
 * keeps what the run left: every turn's answer and the model's own final text, the in-run
 * standing (`agentfootprint.answer.assessed` and `turn_end.answerAssessment`), the read-after
 * standing (`assessAnswer` over the recording, and `agent.assessment()`), the tools' execution
 * log, the digests of the requests the model was served, the usage, and the recording.
 *
 * The library arrives as `doors` — `{ Agent, defineTool, absent, coverage, mock, anthropic,
 * recordRun, assessAnswer }` — so the same code runs against the built package (`run.mjs`) and
 * against the sources (`test/bench/answer/*`). Nothing here imports agentfootprint.
 *
 * The pieces every bench shares — prices, digests, the request projection, the reduced
 * recording, the usage sum, the Anthropic wire — are the inputs bench's (`../inputs/harness.mjs`),
 * imported, not copied.
 *
 * WHAT A RUN IS. A fresh agent (the sheet's system prompt, all six tools, the evidence gate at
 * posture `assist`, `maxIterations` 6, and the arm's `.answerLayer()` option), fresh tools over
 * the fixed fixture data, one `recordRun` attached before the first turn, and the case's turns
 * sent in order (`run`, then `followUp`). The LAST turn is the one measured.
 */

import {
  PRICES,
  anthropicWire,
  costOf,
  digest,
  projectRequest,
  reduceRecording,
  usageOf,
} from '../inputs/harness.mjs';
import { SYSTEM_PROMPT, TOOLS, armOption } from './cases.mjs';

export { PRICES, costOf, digest };

/** Loop bound per turn, output bound per model call — the inputs bench's registered values. */
export const MAX_ITERATIONS = 6;
export const MAX_TOKENS = 1024;

const ASSESSED = 'agentfootprint.answer.assessed';
const TURN_START = 'agentfootprint.agent.turn_start';
const TURN_END = 'agentfootprint.agent.turn_end';
const LLM_END = 'agentfootprint.stream.llm_end';

// ── the standing, projected ──────────────────────────────────────────────────

/**
 * The standing as data, in ONE shape for every source: the value, its rendering, the reason
 * kinds and the checks that ran (layer, check, ran, of) — the fields `assessmentDataOf` serves.
 * A full `AnswerAssessment` (the read-after fold) and an event payload both project to it, so
 * "in-run equals read-after" is a byte comparison. `undefined` in, `undefined` out.
 */
export function projectStanding(value) {
  if (value === undefined || value === null) return undefined;
  return {
    assessment: value.assessment,
    standing: value.standing,
    reasons: (value.reasons ?? []).map((r) => (typeof r === 'string' ? r : r.reason)),
    checked: (value.checked ?? []).map((c) => ({
      layer: c.layer,
      check: c.check,
      ran: c.ran,
      of: c.of,
    })),
  };
}

// ── the tools ────────────────────────────────────────────────────────────────

/**
 * The sheet's tools through the library's own `defineTool`. Each `execute` logs
 * `{ turn, toolCallId, tool, received }` (and `failed` on a throw) before it answers.
 */
export function buildTools(doors, execLog, turnRef) {
  const lib = { absent: doors.absent, coverage: doors.coverage };
  return TOOLS.map((spec) =>
    doors.defineTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      execute: async (args, ctx) => {
        const entry = {
          turn: turnRef.turn,
          toolCallId: ctx.toolCallId,
          tool: spec.name,
          received: { ...args },
        };
        try {
          const result = spec.run(args ?? {}, lib);
          execLog.push(entry);
          return result;
        } catch (err) {
          execLog.push({ ...entry, failed: String(err?.message ?? err) });
          throw err;
        }
      },
    }),
  );
}

/** The agent under `arm`: the same build for every arm but the one option. */
export function buildAgent(doors, { provider, model, arm, tools, temperature }) {
  let builder = doors.Agent.create({
    provider,
    model,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(temperature !== undefined && { temperature }),
  })
    .system(SYSTEM_PROMPT)
    .tools(tools)
    .namesAndNumbersFromEvidence();
  const option = armOption(arm);
  if (option !== undefined) builder = builder.answerLayer(option);
  return builder.build();
}

// ── the scripted mock ────────────────────────────────────────────────────────

/**
 * The scripted model for one run: plays `variant` step by step, turn by turn, and records the
 * digest of every request it is served. A request past the end of the script answers
 * "(the mock script ran out)" and sets `state.exhausted`.
 */
export function scriptedMock(doors, variant, turnRef, requests, state) {
  let callNo = 0;
  return doors.mock({
    respond: (req) => {
      requests.push({ turn: turnRef.turn, digest: digest(projectRequest(req)) });
      const steps = variant.turns[turnRef.turn] ?? [];
      const step = steps[state.step];
      state.step += 1;
      if (step === undefined) {
        state.exhausted = true;
        return { content: '(the mock script ran out)' };
      }
      if (step.answer !== undefined) return { content: step.answer };
      const calls = step.calls ?? [step];
      return {
        toolCalls: calls.map((c) => ({
          id: `t${turnRef.turn + 1}c${(callNo += 1)}`,
          name: c.call,
          args: { ...c.args },
        })),
      };
    },
  });
}

// ── reading one turn off the events ──────────────────────────────────────────

/**
 * The events of each turn, split at `turn_start`. A continued conversation's second turn starts
 * at its own `turn_start`, so turn i's events are the i-th slice.
 */
export function eventsByTurn(events) {
  const turns = [];
  for (const e of events) {
    if (e.type === TURN_START) turns.push([]);
    if (turns.length > 0) turns[turns.length - 1].push(e);
  }
  return turns;
}

/** What one turn's events say: the model's last text, the in-run standing(s), turn_end's copy. */
export function readTurnEvents(events) {
  const llmEnds = events.filter((e) => e.type === LLM_END);
  const lastText = [...llmEnds].reverse().find((e) => (e.payload?.toolCallCount ?? 0) === 0);
  const assessed = events.filter((e) => e.type === ASSESSED);
  const turnEnd = events.find((e) => e.type === TURN_END);
  return {
    modelText: lastText?.payload?.content,
    assessedCount: assessed.length,
    inRunEvent: projectStanding(assessed[assessed.length - 1]?.payload),
    inRunTurnEnd: projectStanding(turnEnd?.payload?.answerAssessment),
    turnEndContent: turnEnd?.payload?.finalContent,
  };
}

// ── one run ──────────────────────────────────────────────────────────────────

/** The run's key: `arm/case/r<rep>` — unique within an invocation, and its file name. */
export function runKey(arm, caseId, rep) {
  return `${arm}/${caseId}/r${rep}`;
}

/**
 * Runs one (case, arm, repetition) and returns the raw record `metrics.mjs` · `readRun` reads.
 *
 * @param {object} opts
 * @param {object} opts.doors       the library (see the header)
 * @param {object} opts.caseDef     a `cases.mjs` · `CASES` entry
 * @param {string} opts.arm         `cases.mjs` · `ARMS`
 * @param {number} opts.rep         the repetition; on the mock it picks the scripted variant
 * @param {'mock'|'anthropic'} opts.provider
 * @param {string} opts.model       `'mock'`, or a model with a `PRICES` row
 * @param {object} [opts.sdkClient] the Anthropic SDK client (anthropic only)
 * @param {number} [opts.temperature] sent only when set; the registered runs send none
 */
export async function runCase(opts) {
  const { doors, caseDef, arm, rep, provider: kind, model } = opts;
  if (PRICES[model] === undefined) throw new Error(`no price for model '${model}'`);
  const execLog = [];
  const requests = [];
  const turnRef = { turn: 0 };
  const mockState = { step: 0, exhausted: false };
  const variant = kind === 'mock' ? caseDef.mock[rep % caseDef.mock.length] : undefined;

  const tools = buildTools(doors, execLog, turnRef);
  let provider;
  if (kind === 'mock') provider = scriptedMock(doors, variant, turnRef, requests, mockState);
  else if (kind === 'anthropic') {
    if (opts.sdkClient === undefined) throw new Error('provider anthropic needs opts.sdkClient');
    provider = anthropicWire(doors, opts.sdkClient, turnRef, requests);
  } else throw new Error(`unknown provider '${kind}' — mock or anthropic`);

  const agent = buildAgent(doors, { provider, model, arm, tools, temperature: opts.temperature });
  const recorder = doors.recordRun(agent);
  const turns = [];
  const started = Date.now();
  for (let i = 0; i < caseDef.turns.length; i += 1) {
    turnRef.turn = i;
    mockState.step = 0;
    const message = caseDef.turns[i];
    try {
      const out = i === 0 ? await agent.run({ message }) : await agent.followUp(message);
      if (typeof out !== 'string') {
        // The layer never asks; a pause here is a tool's own (none of the sheet's tools pauses).
        turns.push({ message, paused: true });
        break;
      }
      turns.push({ message, answer: out });
    } catch (err) {
      turns.push({ message, error: String(err?.message ?? err) });
      break;
    }
  }
  const durationMs = Date.now() - started;
  const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();

  // The in-run reading, turn by turn, off the recorded events.
  const byTurn = eventsByTurn(recording.events ?? []);
  turns.forEach((t, i) => Object.assign(t, readTurnEvents(byTurn[i] ?? [])));

  // The read-after readings of the last turn: the pure fold over the recording (no app
  // declarations — the in-run fold takes none), and the agent's own reader.
  let readAfter;
  let agentAssessment;
  try {
    readAfter = projectStanding(doors.assessAnswer(recording));
  } catch (err) {
    readAfter = { error: String(err?.message ?? err) };
  }
  try {
    agentAssessment = projectStanding(await agent.assessment());
  } catch (err) {
    agentAssessment = { error: String(err?.message ?? err) };
  }
  const state = recording.snapshot?.sharedState ?? {};
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const usage = usageOf(recording.events ?? []);
  return {
    key: runKey(arm, caseDef.id, rep),
    arm,
    caseId: caseDef.id,
    rep,
    provider: kind,
    model,
    ...(variant !== undefined && { variant: variant.label }),
    ...(mockState.exhausted && { mockExhausted: true }),
    turns,
    execLog,
    requests,
    readAfter,
    agentAssessment,
    witness: {
      turn: state.turnNumber,
      grounded: ledger.filter((r) => r?.kind === 'grounded').map((r) => ({ turn: r.turn })),
      stepsUnfinished: ledger.filter((r) => r?.kind === 'steps-unfinished').length,
    },
    unsupportedValues: state.unsupportedValues,
    usage,
    usd: costOf(usage, model),
    durationMs,
    recording: reduceRecording(recording),
  };
}
