/**
 * bench/time/harness.mjs — runs ONE (case, arm, repetition) of the English-reader bench and keeps
 * what the run left: the tools' own read log (what window each call READ), every ask and the
 * simulated person's reply, the time rows of the record, the late time line each request carried
 * (`arguments/serve.ts` · `timeWindowsLine` — the request's LAST message), the usage, and the
 * reduced recording.
 *
 * The inputs bench's pure helpers are reused as they are (`bench/inputs/harness.mjs`): the prices
 * and the cost, the request digest, the recording reducer and the usage sum. What a run IS here:
 *
 * - a fresh agent: the sheet's system prompt at the run's clock, the two tools, `maxIterations`
 *   6, and the arm — `off` = `.time({ zone })`, `on` = `.time({ zone, reader:
 *   englishTimeReader() })`; on a build without the reader the arm is REFUSED, never run unarmed;
 * - ONE message, run at the run's `now` (`agent.run({ message, time: { now } })`); every pause is
 *   answered by the case's person (`cases.mjs` · `answerAsk`) and resumed, at most
 *   `MAX_ANSWERED_ASKS` times;
 * - fresh tools whose `execute` logs what they received and the window they read — the bounds
 *   (epoch ms), or a look-back from the dispatch clock — before they answer.
 *
 * The library arrives as `doors` so the same code runs against the built package (`run.mjs`).
 */

import { PRICES, costOf, digest, projectRequest, reduceRecording, usageOf } from '../inputs/harness.mjs';
import { TOOLS, ZONE, answerAsk, systemPrompt } from './cases.mjs';

export { PRICES, costOf };

/** Loop bound per turn. */
export const MAX_ITERATIONS = 6;
/** Output bound per model call. */
export const MAX_TOKENS = 1024;
/** How many asks one run may answer (a zone, a confirmation, a re-ask, and one spare). */
export const MAX_ANSWERED_ASKS = 4;

/** The ledger row kinds the bench keeps (small; the reduced recording holds the rest). */
const KEEP_ROWS = new Set(['clock', 'time-reading', 'time-answer', 'call-window', 'argument']);

/** The run's key: `arm/case/r<rep>` — unique within an invocation, and its raw file's name. */
export function runKey(arm, caseId, rep) {
  return `${arm}/${caseId}/r${rep}`;
}

/** A look-back spelling (`30m`, `2h`, `3d`, `1w`) → ms, or `undefined`. */
export function lookbackMs(text) {
  const m = /^\s*(\d+)\s*(m|min|h|d|w)\s*$/i.exec(String(text ?? ''));
  if (m === null) return undefined;
  const unit = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2].toLowerCase()];
  return Number(m[1]) * unit;
}

/** The window a call READ, from what it received: bounds, or a look-back from `dispatchedAt`. */
export function readWindowOf(tool, args, dispatchedAt) {
  if (tool === 'client_activity') {
    const from = Number(args.start_time);
    const to = Number(args.end_time);
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : undefined;
  }
  if (tool === 'search_logs') {
    const ms = lookbackMs(args.window ?? '1h');
    return ms === undefined ? undefined : { from: dispatchedAt - ms, to: dispatchedAt };
  }
  return undefined;
}

/** The sheet's tools, through the library's own `defineTool`; each logs its read before it answers. */
export function buildTools(doors, readLog) {
  return TOOLS.map((spec) =>
    doors.defineTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      askOrAssume: spec.askOrAssume,
      period: spec.period,
      execute: async (args, ctx) => {
        const dispatchedAt = Date.now();
        const window = readWindowOf(spec.name, args, dispatchedAt);
        readLog.push({
          toolCallId: ctx?.toolCallId,
          tool: spec.name,
          received: { ...args },
          dispatchedAt,
          ...(window !== undefined && { window }),
          ...(ctx?.time?.asked !== undefined && { asked: ctx.time.asked }),
        });
        return spec.name === 'client_activity'
          ? JSON.stringify({ clients: [{ name: 'fin-01', operations: 42 }, { name: 'hr-02', operations: 17 }] })
          : '3 error lines: 2 × "backup job timeout", 1 × "HTTP 504 from catalog"';
      },
    }),
  );
}

/** The agent for `arm`. Refuses `on` on a build without `englishTimeReader` or `.time()`. */
export function buildAgent(doors, arm, provider, model, tools, nowIso, temperature) {
  let builder = doors.Agent.create({
    provider,
    model,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(temperature !== undefined && { temperature }),
  })
    .system(systemPrompt(nowIso))
    .tools(tools);
  if (typeof builder.time !== 'function') {
    throw new Error("this build's AgentBuilder has no time() — the time layer is not in it");
  }
  if (arm === 'on') {
    if (typeof doors.englishTimeReader !== 'function') {
      throw new Error(
        "arm 'on': this build exports no englishTimeReader — step T6b is not in it. Refusing to run the arm unarmed.",
      );
    }
    builder = builder.time({ zone: ZONE, reader: doors.englishTimeReader() });
  } else if (arm === 'off') {
    builder = builder.time({ zone: ZONE });
  } else {
    throw new Error(`unknown arm '${arm}' — off or on`);
  }
  return builder.build();
}

/** A message's text: a string, or its text blocks joined (the Anthropic wire). */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * The request's late time line (`arguments/serve.ts` · `timeWindowsLine`), or `undefined`: the
 * request's LAST message when it is a `user` TEXT message that is not the person's own message.
 * Recognised by position, never by wording — the only request-only user line these agents can
 * carry is the time line (no evidence gate, so no staged-refs nudge), and a tool result is a
 * block, not text.
 */
export function timeLineOf(messages, personMessage) {
  const last = (messages ?? [])[(messages ?? []).length - 1];
  if (last?.role !== 'user') return undefined;
  const text = textOf(last.content);
  return text.length > 0 && text !== personMessage ? text : undefined;
}

/** What the bench keeps of one served request: its digest and the late time line it carried. */
function servedOf(projected, personMessage) {
  const line = timeLineOf(projected.messages, personMessage);
  return { digest: digest(projected), ...(line !== undefined && { timeLine: line }) };
}

/** The scripted model: plays the variant's steps, then answers; records each served request. */
export function scriptedMock(doors, variant, now, requests, state, personMessage) {
  let callNo = 0;
  const steps = variant.steps(now);
  return doors.mock({
    respond: (req) => {
      requests.push(servedOf(projectRequest(req), personMessage));
      const step = steps[state.step];
      state.step += 1;
      if (step === undefined) return { content: 'Here is what the tool returned.' };
      return {
        toolCalls: [{ id: `c${(callNo += 1)}`, name: step.call, args: { ...(step.args ?? {}) } }],
      };
    },
  });
}

/** The package's Anthropic adapter over the caller's SDK client, recording each wire body served. */
export function anthropicWire(doors, sdkClient, requests, personMessage) {
  const record = (params) => {
    const line = timeLineOf(params.messages, personMessage);
    requests.push({ digest: digest(params), ...(line !== undefined && { timeLine: line }) });
  };
  const client = {
    messages: {
      create: (params) => {
        record(params);
        return sdkClient.messages.create(params);
      },
      stream: (params) => {
        record(params);
        return sdkClient.messages.stream(params);
      },
    },
  };
  return doors.anthropic({ _client: client });
}

/**
 * Runs one (case, arm, repetition); returns the raw record `metrics.mjs` · `readRun` reads.
 *
 * @param {object} opts
 * @param {object} opts.doors   `{ Agent, defineTool, englishTimeReader, isInputPause, mock, anthropic, recordRun }`
 * @param {object} opts.caseDef a `cases.mjs` · `CASES` entry
 * @param {'off'|'on'} opts.arm
 * @param {number} opts.rep     the repetition; on the mock it picks the scripted variant
 * @param {'mock'|'anthropic'} opts.provider
 * @param {string} opts.model   `'mock'`, or a model with a `PRICES` row
 * @param {string} opts.now     the run's clock, ISO (the time the person wrote the message)
 * @param {object} [opts.sdkClient]
 * @param {number} [opts.temperature] sent only when set; the registered run sends none
 * @param {number} [opts.maxAnsweredAsks] how many asks the person answers (default
 *   `MAX_ANSWERED_ASKS`); `0` ends the run at its first ask, kept as `pendingAsk` — the unread
 *   rule's cases (`rule-unread.mjs`) measure whether the ask OPENS, not what follows it
 */
export async function runCase(opts) {
  const { doors, caseDef, arm, rep, provider: kind, model, now } = opts;
  if (PRICES[model] === undefined) throw new Error(`no price for model '${model}'`);
  const nowMs = Date.parse(now);
  const readLog = [];
  const requests = [];
  const asks = [];
  const mockState = { step: 0 };
  const variant = kind === 'mock' ? caseDef.mock[rep % caseDef.mock.length] : undefined;
  const tools = buildTools(doors, readLog);
  let provider;
  if (kind === 'mock')
    provider = scriptedMock(doors, variant, nowMs, requests, mockState, caseDef.message);
  else if (kind === 'anthropic') {
    if (opts.sdkClient === undefined) throw new Error('provider anthropic needs opts.sdkClient');
    provider = anthropicWire(doors, opts.sdkClient, requests, caseDef.message);
  } else throw new Error(`unknown provider '${kind}' — mock or anthropic`);

  const agent = buildAgent(doors, arm, provider, model, tools, now, opts.temperature);
  const recorder = doors.recordRun(agent);
  const started = Date.now();
  let answer;
  let error;
  let stuck = false;
  let pendingAsk;
  const maxAsks = opts.maxAnsweredAsks ?? MAX_ANSWERED_ASKS;
  try {
    let out = await agent.run({ message: caseDef.message, time: { now } });
    while (doors.isInputPause(out) && asks.length < maxAsks) {
      const ai = out.awaitingInput;
      const answered = answerAsk(caseDef, ai, nowMs);
      asks.push({
        question: ai.question,
        fields: (ai.fields ?? []).map((f) => ({
          id: f.id,
          ...(f.format !== undefined && { format: f.format }),
          description: f.description,
        })),
        answers: answered.fields,
      });
      out = await agent.resume(out.checkpoint, answered.reply);
    }
    if (typeof out === 'string') answer = out;
    else stuck = true;
    // The ask the run ended on, unanswered: its fields and how many values each OFFERED (an
    // empty list is the free-entry ask — nothing filled in).
    if (doors.isInputPause(out)) {
      pendingAsk = {
        question: out.awaitingInput.question,
        fields: (out.awaitingInput.fields ?? []).map((f) => ({
          id: f.id,
          ...(f.format !== undefined && { format: f.format }),
          description: f.description,
          offered: (f.enum ?? []).length,
        })),
      };
    }
  } catch (err) {
    error = String(err?.message ?? err);
  }
  const durationMs = Date.now() - started;
  const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();
  let rows = [];
  try {
    rows = (agent.findings() ?? []).filter((r) => KEEP_ROWS.has(r.kind)).map((r) => ({ ...r }));
  } catch {
    rows = [];
  }
  const usage = usageOf(recording.events ?? []);
  return {
    key: runKey(arm, caseDef.id, rep),
    arm,
    caseId: caseDef.id,
    rep,
    provider: kind,
    model,
    now,
    ...(variant !== undefined && { variant: variant.label }),
    message: caseDef.message,
    ...(answer !== undefined && { answer }),
    ...(stuck && { stuck: true }),
    ...(error !== undefined && { error }),
    readLog,
    asks,
    ...(pendingAsk !== undefined && { pendingAsk }),
    rows,
    requests,
    usage,
    usd: costOf(usage, model),
    durationMs,
    recording: reduceRecording(recording),
  };
}
