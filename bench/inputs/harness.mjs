/**
 * bench/inputs/harness.mjs — runs ONE (case, arm, repetition) of the inputs-layer bench and
 * keeps what the run left: the recording (with its snapshot), the tools' own execution log, the
 * digests of the requests the model was served, the usage, and the standing fold's verdict.
 *
 * The library arrives as `doors` — `{ Agent, defineTool, mock, anthropic, recordRun,
 * assessAnswer }` — so the same code runs against the built package (`run.mjs`, the bench) and
 * against the sources (`test/bench/inputs/*`, the suite). Nothing here imports agentfootprint.
 *
 * WHAT A RUN IS. A fresh agent (the sheet's system prompt, all five tools, `maxIterations` 6),
 * fresh tools over the fixed fixture data (nothing carries from one run to the next — the
 * "freshly loaded seed" of the protocol), one `recordRun` attached before the first turn, and
 * the case's turns sent in order (`run`, then `followUp`). Nothing is judged here; `metrics.mjs`
 * reads the result.
 *
 * WHAT RAN is the tool's own record, not the model's proposal: each tool's `execute` logs the
 * arguments it received and the period it applied (`cases.mjs` · `TOOLS[].run`), so a default the
 * tool applied, a value the library filled (step 3) and a value the person answered (step 4) all
 * land in one place — the store's query log. A call the library refused before dispatch (an
 * argument outside the enum) never reaches it.
 */

import { createHash } from 'node:crypto';

import { FOLD_DECLARATIONS, SYSTEM_PROMPT, TOOLS, armDeclaration } from './cases.mjs';

/** Loop bound per turn. A real model that keeps calling stops here, and the record says so. */
export const MAX_ITERATIONS = 6;
/** Output bound per model call. The answers are a few sentences; this caps what a call can cost. */
export const MAX_TOKENS = 1024;

/**
 * USD per million tokens. Haiku 4.5's list prices (input $1, output $5; a cache read 0.1× input;
 * a cache write priced at the 1-hour rate, 2× input, the dearer of the two TTLs — so a cap
 * computed from these rates is never below the bill). The mock costs nothing. A model not in this
 * table cannot be run: the spend cap would be a guess.
 */
export const PRICES = Object.freeze({
  mock: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
});

/** The run's USD from its summed usage, at `PRICES[model]`. */
export function costOf(usage, model) {
  const p = PRICES[model];
  if (p === undefined)
    throw new Error(`no price for model '${model}' — add its rates to PRICES first`);
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

// ── digests ──────────────────────────────────────────────────────────────────

/** JSON with object keys sorted at every depth — the same value always prints the same bytes. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** sha256 of the stable JSON, first 16 hex characters. */
export function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);
}

/**
 * The served request, as the mock provider receives it — every field that reaches the model,
 * none that cannot (`signal`). Its digest is the bench's own byte law: an unarmed arm must keep
 * serving these bytes after steps 3 and 4 land (`test/bench/inputs/unarmed-bytes.test.ts`).
 */
export function projectRequest(req) {
  return {
    model: req.model,
    systemPrompt: req.systemPrompt,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    toolChoice: req.toolChoice,
    cacheMarkers: req.cacheMarkers,
    tools: (req.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
      toolCalls: m.toolCalls,
    })),
  };
}

// ── the tools ────────────────────────────────────────────────────────────────

/**
 * The sheet's tools under `arm`, built through the library's own `defineTool`. Each `execute`
 * logs `{ turn, toolCallId, tool, received, effective }` to `execLog` before it answers.
 *
 * Refuses an arm whose declaration the library did not keep: `defineTool` copies the fields it
 * knows one by one, so on a build that predates a step the declaration would vanish and the arm
 * would run unarmed — configured-and-inert, which looks exactly like configured-and-working.
 */
export function buildTools(doors, arm, execLog, turnRef) {
  return TOOLS.map((spec) => {
    const declaration = armDeclaration(arm, spec);
    const tool = doors.defineTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      ...declaration,
      execute: async (args, ctx) => {
        const entry = {
          turn: turnRef.turn,
          toolCallId: ctx.toolCallId,
          tool: spec.name,
          received: { ...args },
        };
        let ran;
        try {
          ran = spec.run(args);
        } catch (err) {
          execLog.push({ ...entry, failed: String(err?.message ?? err) });
          throw err;
        }
        execLog.push({
          ...entry,
          ...(ran.effective !== undefined && { effective: ran.effective }),
        });
        return ran.result;
      },
    });
    if (declaration.askOrAssume !== undefined && tool.askOrAssume === undefined) {
      throw new Error(
        `arm '${arm}': this build's defineTool dropped \`askOrAssume\` on ${spec.name} — the ` +
          `inputs layer is not in it (step ${
            arm === 'assume' ? 3 : 4
          }). Refusing to run the arm unarmed.`,
      );
    }
    return tool;
  });
}

// ── the scripted mock ────────────────────────────────────────────────────────

/** How the mock's answers say a period — each is a `DURATION_PHRASES` entry for its duration. */
const MOCK_WINDOW_WORDS = Object.freeze({
  '1h': 'the last hour',
  '2h': 'the last 2 hours',
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
  '-60m': 'the last 60 minutes',
  '-6h': 'the last 6 hours',
  '-24h': 'the last 24 hours',
  '-7d': 'the last 7 days',
});

/** One result, in the mock's words — the facts it carries, restated. */
function describeResult(v) {
  if (v === null || typeof v !== 'object') return '';
  if (typeof v.total === 'number') {
    return v.total === 0
      ? `${v.service}: no errors.`
      : `${v.service}: ${v.total} errors, most often ${v.top_codes[0].code}.`;
  }
  if (typeof v.p95_read_ms === 'number') {
    return `${v.host}: p95 read ${v.p95_read_ms} ms, peak ${v.iops_peak} IOPS.`;
  }
  if (typeof v.flows_total === 'number') {
    return `${v.host}: ${v.flows_total} flows, busiest peer ${v.top_peer}.`;
  }
  if (Array.isArray(v.services)) return `Services: ${v.services.join(', ')}.`;
  if (Array.isArray(v.hosts))
    return `Hosts: ${v.hosts.map((h) => `${h.id} (${h.role})`).join(', ')}.`;
  return '';
}

/** The mock's answer step: its text, or the facts of this turn's results plus an optional period. */
export function composeMockAnswer(messages, answer) {
  if (answer.text !== undefined) return answer.text;
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  const parts = [];
  for (const m of messages.slice(lastUser + 1)) {
    if (m.role !== 'tool') continue;
    try {
      parts.push(describeResult(JSON.parse(m.content)));
    } catch {
      // A refusal or a tool error is text, not a result: nothing to restate.
    }
  }
  const text = parts.filter((p) => p !== '').join(' ') || 'Nothing came back.';
  return answer.window === undefined ? text : `${text} (Over ${MOCK_WINDOW_WORDS[answer.window]}.)`;
}

/**
 * The scripted model for one run: plays `variant` step by step, turn by turn, and records the
 * digest of every request it is served. A request past the end of the script answers
 * "(the mock script ran out)" and sets `state.exhausted` — the harness reports it.
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
      if (step.answer !== undefined)
        return { content: composeMockAnswer(req.messages, step.answer) };
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

/**
 * The package's own Anthropic adapter over an SDK client the caller built (`run.mjs` ·
 * `loadSdkClient`, or a stub in a test). The client is wrapped only to record the digest of each
 * wire body — the bytes that went to the API.
 */
export function anthropicWire(doors, sdkClient, turnRef, requests) {
  const record = (params) => requests.push({ turn: turnRef.turn, digest: digest(params) });
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

// ── the recording ────────────────────────────────────────────────────────────

/** Snapshot fields the bench keeps: the committed state and the log it folds from. */
const KEEP_SNAPSHOT = ['runId', 'sharedState', 'commitLog', 'commitValues', 'initialState'];

/**
 * The recording the bench saves: the snapshot's committed state and commit log (what the
 * standing fold and a later confusion table read), every event with the streamed token text
 * blanked (its slot kept, so an event index still points at the same event), and a note of what
 * was dropped. Dropped: the chart (`structure`) and the snapshot's derived views — the execution
 * tree, subflow results, recorder data — about 85% of a recording's bytes, none of it read by the
 * fold or by `metrics.mjs`.
 */
export function reduceRecording(recording) {
  const snapshot = recording.snapshot ?? {};
  const kept = Object.fromEntries(
    KEEP_SNAPSHOT.filter((k) => k in snapshot).map((k) => [k, snapshot[k]]),
  );
  return {
    snapshot: kept,
    events: (recording.events ?? []).map((e) =>
      e.type === 'agentfootprint.stream.token'
        ? { ...e, payload: { ...e.payload, content: '' } }
        : e,
    ),
    structure: null,
    reduced: {
      by: 'bench/inputs/harness.mjs · reduceRecording',
      dropped: [
        'structure',
        ...Object.keys(snapshot)
          .filter((k) => !KEEP_SNAPSHOT.includes(k))
          .map((k) => `snapshot.${k}`),
        'stream.token content',
      ],
    },
  };
}

/** Summed usage over every model call the run's events report (every turn: every call is paid). */
export function usageOf(events) {
  const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const e of events) {
    if (e.type !== 'agentfootprint.stream.llm_end') continue;
    const u = e.payload.usage ?? {};
    usage.calls += 1;
    usage.input += u.input ?? 0;
    usage.output += u.output ?? 0;
    usage.cacheRead += u.cacheRead ?? 0;
    usage.cacheWrite += u.cacheWrite ?? 0;
  }
  return usage;
}

// ── one run ──────────────────────────────────────────────────────────────────

/** The run's key: `arm/case/r<rep>` — unique within an invocation, and the file name it saves under. */
export function runKey(arm, caseId, rep) {
  return `${arm}/${caseId}/r${rep}`;
}

/**
 * Runs one (case, arm, repetition) and returns the raw record `metrics.mjs` · `readRun` reads.
 *
 * @param {object} opts
 * @param {object} opts.doors       the library: `{ Agent, defineTool, mock, anthropic, recordRun, assessAnswer }`
 * @param {object} opts.caseDef     a `cases.mjs` · `CASES` entry
 * @param {string} opts.arm         `'off'` in step 2 (`cases.mjs` · `ARMS`)
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

  const tools = buildTools(doors, arm, execLog, turnRef);
  let provider;
  if (kind === 'mock') provider = scriptedMock(doors, variant, turnRef, requests, mockState);
  else if (kind === 'anthropic') {
    if (opts.sdkClient === undefined) throw new Error('provider anthropic needs opts.sdkClient');
    provider = anthropicWire(doors, opts.sdkClient, turnRef, requests);
  } else throw new Error(`unknown provider '${kind}' — mock or anthropic`);

  const agent = doors.Agent.create({
    provider,
    model,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
  })
    .system(SYSTEM_PROMPT)
    .tools(tools)
    .build();

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
        // A pause. Step 2's arms never ask; step 4 answers here (`cases.mjs` · `personAnswer`).
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

  let standing;
  try {
    const a = doors.assessAnswer(recording, FOLD_DECLARATIONS);
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
    turns,
    execLog,
    requests,
    usage,
    usd: costOf(usage, model),
    standing,
    durationMs,
    recording: reduceRecording(recording),
  };
}
