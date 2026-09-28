/**
 * bench/results/harness.mjs — runs ONE (case, arm, repetition) of the results-layer bench and
 * keeps what the run left: the recording (with its snapshot), the stores' own read log, the
 * digests of the requests the model was served, the usage, and the standing fold's verdict.
 *
 * The inputs bench's harness is the pattern (`bench/inputs/harness.mjs`), and its pure helpers
 * are reused as they are: the prices and the cost, the request digest, the Anthropic wire
 * wrapper, the recording reducer and the usage sum. What differs is what a run IS here:
 *
 * - a fresh agent (the sheet's system prompt, the three tools, `maxIterations` 6), the case's
 *   ONE question, one `recordRun` attached before it;
 * - fresh tools over the case's world (`cases.mjs` · `worldOf`) — each `execute` reads the store
 *   (`cases.mjs` · `readStore`), logs what it received and the period it read, and answers
 *   through the library's own doors (`cases.mjs` · `respond`: `absent()` / `describedResult()`);
 * - the arm: `off` builds the agent as it ships; `on` adds `.resultsLayer()` and the tools
 *   declare their period. On a build without the layer the arm is REFUSED, never run unarmed.
 *
 * The library arrives as `doors` — `{ Agent, defineTool, absent, describedResult, mock,
 * anthropic, recordRun, assessAnswer }` — so the same code runs against the built package
 * (`run.mjs`) and against the sources (`test/bench/results/*`).
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
import { SYSTEM_PROMPT, TOOLS, readStore, respond, worldOf } from './cases.mjs';

export { PRICES, costOf };

/** Loop bound per turn. */
export const MAX_ITERATIONS = 6;
/** Output bound per model call. */
export const MAX_TOKENS = 1024;

/** The run's key: `arm/case/r<rep>` — unique within an invocation, and its raw file's name. */
export function runKey(arm, caseId, rep) {
  return `${arm}/${caseId}/r${rep}`;
}

/**
 * The sheet's tools under `arm` over `world`, through the library's own `defineTool`. Each
 * `execute` logs `{ toolCallId, tool, received, window, queried, held, found }` (or `failed`)
 * before it answers — the store's read log, the record of what each read covered.
 */
export function buildTools(doors, arm, world, readLog) {
  return TOOLS.map((spec) =>
    doors.defineTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      execute: async (args, ctx) => {
        const entry = { toolCallId: ctx?.toolCallId, tool: spec.name, received: { ...args } };
        let read;
        try {
          read = readStore(spec.name, args, world);
        } catch (err) {
          readLog.push({ ...entry, failed: String(err?.message ?? err) });
          throw err;
        }
        readLog.push({
          ...entry,
          window: read.window,
          queried: read.queried,
          held: read.held,
          found: read.rows.length,
        });
        return respond(doors, arm, read, world);
      },
    }),
  );
}

/**
 * The agent for `arm`. Refuses the `on` arm on a build whose builder has no `.resultsLayer()`:
 * without the refusal an armed run would quietly compare `off` with `off`.
 */
export function buildAgent(doors, arm, provider, model, tools, temperature) {
  let builder = doors.Agent.create({
    provider,
    model,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(temperature !== undefined && { temperature }),
  })
    .system(SYSTEM_PROMPT)
    .tools(tools);
  if (arm === 'on') {
    if (typeof builder.resultsLayer !== 'function') {
      throw new Error(
        "arm 'on': this build's AgentBuilder has no resultsLayer() — the results layer (step 7b) " +
          'is not in it. Refusing to run the arm unarmed.',
      );
    }
    builder = builder.resultsLayer();
  } else if (arm !== 'off') {
    throw new Error(`unknown arm '${arm}' — off or on`);
  }
  return builder.build();
}

/**
 * The scripted model for one run: plays `variant.steps` in order and records the digest of every
 * request it is served. A request past the end answers "(the mock script ran out)" and sets
 * `state.exhausted`.
 */
export function scriptedMock(doors, variant, requests, state) {
  let callNo = 0;
  return doors.mock({
    respond: (req) => {
      requests.push({ turn: 0, digest: digest(projectRequest(req)) });
      const step = variant.steps[state.step];
      state.step += 1;
      if (step === undefined) {
        state.exhausted = true;
        return { content: '(the mock script ran out)' };
      }
      if (step.answer !== undefined) return { content: step.answer };
      const calls = step.calls ?? [step];
      return {
        toolCalls: calls.map((c) => ({
          id: `t1c${(callNo += 1)}`,
          name: c.call,
          args: { ...c.args },
        })),
      };
    },
  });
}

/**
 * Runs one (case, arm, repetition) and returns the raw record `metrics.mjs` · `readRun` reads.
 *
 * @param {object} opts
 * @param {object} opts.doors        the library (see the header)
 * @param {object} opts.caseDef      a `cases.mjs` · `CASES` entry
 * @param {'off'|'on'} opts.arm
 * @param {number} opts.rep          the repetition; on the mock it picks the scripted variant
 * @param {'mock'|'anthropic'} opts.provider
 * @param {string} opts.model        `'mock'`, or a model with a `PRICES` row
 * @param {object} [opts.sdkClient]  the Anthropic SDK client (anthropic only)
 * @param {number} [opts.temperature] sent only when set; the registered runs send none
 */
export async function runCase(opts) {
  const { doors, caseDef, arm, rep, provider: kind, model } = opts;
  if (PRICES[model] === undefined) throw new Error(`no price for model '${model}'`);
  if (!caseDef.arms.includes(arm)) throw new Error(`case ${caseDef.id} does not run arm ${arm}`);
  const world = worldOf(caseDef);
  const readLog = [];
  const requests = [];
  const turnRef = { turn: 0 };
  const mockState = { step: 0, exhausted: false };
  const variant = kind === 'mock' ? caseDef.mock[rep % caseDef.mock.length] : undefined;

  const tools = buildTools(doors, arm, world, readLog);
  let provider;
  if (kind === 'mock') provider = scriptedMock(doors, variant, requests, mockState);
  else if (kind === 'anthropic') {
    if (opts.sdkClient === undefined) throw new Error('provider anthropic needs opts.sdkClient');
    provider = anthropicWire(doors, opts.sdkClient, turnRef, requests);
  } else throw new Error(`unknown provider '${kind}' — mock or anthropic`);

  const agent = buildAgent(doors, arm, provider, model, tools, opts.temperature);
  const recorder = doors.recordRun(agent);
  const started = Date.now();
  let answer;
  let error;
  let paused = false;
  try {
    const out = await agent.run({ message: caseDef.message });
    if (typeof out === 'string') answer = out;
    else paused = true;
  } catch (err) {
    error = String(err?.message ?? err);
  }
  const durationMs = Date.now() - started;
  const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();

  let standing;
  try {
    const a = doors.assessAnswer(recording, {});
    standing = {
      standing: a.standing,
      assessment: a.assessment,
      reasons: a.reasons.map((r) => r.reason),
    };
  } catch (err) {
    standing = { error: String(err?.message ?? err) };
  }
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
    message: caseDef.message,
    ...(answer !== undefined && { answer }),
    ...(paused && { paused: true }),
    ...(error !== undefined && { error }),
    readLog,
    requests,
    usage,
    usd: costOf(usage, model),
    standing,
    durationMs,
    recording: reduceRecording(recording),
  };
}
