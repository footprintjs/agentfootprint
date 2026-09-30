/**
 * bench/time-checks/harness.mjs — runs ONE (case, arm, repetition) of the result-checks bench and
 * keeps what the run left: each tool's own read log (what its store READ, after its clamp, its
 * retention, its day grain), every ask and the simulated person's reply, the time rows of the
 * record, the answer's standing (`agent.assessment()`), the model's own final words (the last
 * `llm_end` event with no tool call — never the library's limits block), the late time line each
 * request carried, the usage, and the reduced recording.
 *
 * The two arms run two BUILDS of the library, handed in as `doors[arm]` (`run.mjs` · `loadDoors`):
 * `off` — the build before step T8 (`--baseline`, a worktree of `feat/time-layer-2` at the commit
 * before T8); `on` — this branch's build. Everything else is the same: the sheet's system prompt
 * at the message's clock, the case's tools, `.time({ zone }).limitsTravelWithTheAnswer()`,
 * `maxIterations` 6, `maxTokens` 1024, and the person's window as the host's (`time.window`).
 */

import {
  PRICES,
  costOf,
  digest,
  projectRequest,
  reduceRecording,
  usageOf,
} from '../inputs/harness.mjs';
import {
  ACTIVITY_MAX_READ,
  ACTIVITY_RETENTION,
  BADGE_SWIPES,
  DAILY,
  DAY,
  DOOR_EVENTS,
  ERROR_LINES,
  HOUR,
  LOGS_HELD,
  OPS_PER_DAY,
  TOOL_SPECS,
  ZONE,
  answerAsk,
  isoWithOffset,
  la,
  systemPrompt,
  wallClock,
} from './cases.mjs';

export { PRICES, costOf };

export const MAX_ITERATIONS = 6;
export const MAX_TOKENS = 1024;
export const MAX_ANSWERED_ASKS = 3;

/** The ledger row kinds the bench keeps. */
const KEEP_ROWS = new Set(['clock', 'call', 'call-window', 'period', 'source-clock', 'argument']);

export function runKey(arm, caseId, rep) {
  return `${arm}/${caseId}/r${rep}`;
}

/** A look-back spelling (`30m`, `2h`, `3d`, `1w`, `90min`) → ms, or `undefined`. */
export function lookbackMs(text) {
  const m = /^\s*(\d+)\s*(m|min|mins|minutes?|h|hr|hours?|d|days?|w|weeks?)\s*$/i.exec(
    String(text ?? ''),
  );
  if (m === null) return undefined;
  const u = m[2].toLowerCase()[0];
  const unit = { m: 60_000, h: HOUR, d: DAY, w: 7 * DAY }[u];
  return Number(m[1]) * unit;
}

const iso = (ms) => new Date(ms).toISOString();

/** A Los Angeles day's start at or before `ms` (October/September 2026 are PDT throughout). */
function dayStartLA(ms) {
  const wall = new Date(ms - 7 * HOUR).toISOString().slice(0, 10);
  return la(`${wall}T00:00:00`);
}
const dayKey = (start) => new Date(start - 7 * HOUR).toISOString().slice(0, 10);

/** A row's wall time `YYYY-MM-DD HH:MM` in `zone`. */
function wallStamp(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ── the tools' stores (what each READ, and what it answers) ──────────────────────────────────

function bothBounds(args) {
  const from = Number(args.start_time);
  const to = Number(args.end_time);
  return Number.isFinite(from) && Number.isFinite(to) && from < to ? { from, to } : undefined;
}

/** client_activity: a read covers 7 days at most (the front is clamped); the store keeps 90 days. */
function clientActivity(doors, args, dispatchedAt) {
  const b = bothBounds(args);
  if (b === undefined)
    return { text: 'start_time and end_time (epoch ms, start < end) are required.' };
  const queried = { from: Math.max(b.from, b.to - ACTIVITY_MAX_READ), to: b.to };
  const held = { from: dispatchedAt - ACTIVITY_RETENTION, to: dispatchedAt };
  const read = {
    from: Math.max(queried.from, held.from),
    to: Math.min(queried.to, held.to),
  };
  const got = read.from < read.to ? read : undefined;
  const operations = got === undefined ? 0 : Math.round(((got.to - got.from) / DAY) * OPS_PER_DAY);
  return {
    read: got,
    queried,
    result: doors.describedResult({
      facts: [{ entity: 'all clients', operations }],
      provenance: { measuredAt: iso(dispatchedAt), source: 'activity store' },
      period: {
        queried: { from: iso(queried.from), to: iso(queried.to - 1) },
        held: { from: iso(held.from), to: iso(held.to) },
      },
    }),
  };
}

/** search_logs: every line inside the look-back, each with its time in Los Angeles. */
function searchLogs(doors, args, dispatchedAt, runStart) {
  const ms = lookbackMs(args.window ?? '1h');
  if (ms === undefined)
    return { text: `window '${args.window}' is not a look-back like 30m, 2h or 3d.` };
  const queried = { from: dispatchedAt - ms, to: dispatchedAt };
  const held = { from: dispatchedAt - LOGS_HELD, to: dispatchedAt };
  const read = { from: Math.max(queried.from, held.from), to: queried.to };
  const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
  const lines = ERROR_LINES.map((l) => ({ at: l.at(runStart), text: l.text }))
    .filter((l) => l.at >= read.from && l.at < read.to)
    .filter((l) => query === '' || `error ${l.text}`.toLowerCase().includes(query))
    .sort((a, b) => a.at - b.at);
  return {
    read,
    queried,
    result: doors.describedResult({
      facts: [
        { entity: 'error lines', count: lines.length },
        ...lines.map((l) => ({
          entity: 'error line',
          time: `${wallStamp(l.at, ZONE)} PDT`,
          level: 'ERROR',
          text: l.text,
        })),
      ],
      provenance: { measuredAt: iso(dispatchedAt), source: 'log store' },
      period: {
        queried: { from: iso(queried.from), to: iso(queried.to - 1) },
        held: { from: iso(held.from), to: iso(held.to) },
      },
    }),
  };
}

/** daily_totals: whole Los Angeles days — every day that starts inside the window, from the day of its start. */
function dailyTotals(doors, args, dispatchedAt) {
  const b = bothBounds(args);
  if (b === undefined)
    return { text: 'start_time and end_time (epoch ms, start < end) are required.' };
  const first = dayStartLA(b.from);
  const days = [];
  for (let d = first; d < b.to && d <= dispatchedAt; d += DAY) days.push(d);
  if (days.length === 0) return { text: 'no whole day in that window.' };
  const last = days[days.length - 1];
  const rows = days.map((d) => ({ entity: dayKey(d), backup_runs: DAILY[dayKey(d)] ?? 0 }));
  return {
    read: { from: first, to: last + DAY },
    queried: { from: first, to: last + DAY },
    result: doors.describedResult({
      facts: rows,
      provenance: { measuredAt: iso(dispatchedAt), source: 'backup scheduler' },
      period: {
        queried: { from: iso(first), to: iso(last) },
        held: { from: iso(la('2026-09-01T00:00:00')), to: iso(dispatchedAt) },
      },
    }),
  };
}

/** door_events / badge_log: the rows inside the window, minted as a dataset in the declared clock. */
async function rowsTool(doors, name, args, dispatchedAt, ctx, clock) {
  const b = bothBounds(args);
  if (b === undefined)
    return { text: 'start_time and end_time (epoch ms, start < end) are required.' };
  const all = name === 'door_events' ? DOOR_EVENTS : BADGE_SWIPES;
  const hits = all.filter((t) => t >= b.from && t < b.to && t <= dispatchedAt);
  const zone = clock?.zone ?? ZONE;
  const spell = clock?.spell === 'offset' ? isoWithOffset : iso;
  await ctx.artifacts.put({
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: hits.map((t) => ({ at: wallStamp(t, zone).replace(' ', 'T') + ':00' })),
    timeAxis: { column: 'at', unit: 'iso', ...(clock?.zone !== undefined && { zone: clock.zone }) },
  });
  const what = name === 'door_events' ? 'door openings' : 'badge swipes';
  return {
    read: { from: b.from, to: b.to },
    queried: { from: b.from, to: b.to },
    result: doors.describedResult({
      facts: [
        { entity: what, count: hits.length, times: hits.map((t) => wallClock(t, zone)).join(', ') },
      ],
      provenance: { measuredAt: iso(dispatchedAt), source: name },
      period: {
        queried: { from: spell(b.from), to: spell(b.to - 1) },
        held: { from: spell(dispatchedAt - 30 * DAY), to: spell(dispatchedAt) },
      },
    }),
  };
}

/** The case's tools, through the arm's own `defineTool`; each logs its read before it answers. */
export function buildTools(doors, caseDef, readLog, runStart) {
  return caseDef.tools.map((name) => {
    const spec = TOOL_SPECS[name];
    return doors.defineTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      askOrAssume: spec.askOrAssume,
      period: spec.period,
      execute: async (args, ctx) => {
        const dispatchedAt = Date.now();
        let out;
        if (name === 'client_activity') out = clientActivity(doors, args, dispatchedAt);
        else if (name === 'search_logs') out = searchLogs(doors, args, dispatchedAt, runStart);
        else if (name === 'daily_totals') out = dailyTotals(doors, args, dispatchedAt);
        else out = await rowsTool(doors, name, args, dispatchedAt, ctx, caseDef.clock?.[name]);
        readLog.push({
          toolCallId: ctx?.toolCallId,
          tool: name,
          received: { ...args },
          dispatchedAt,
          ...(out.read !== undefined && { read: out.read }),
          ...(out.queried !== undefined && { queried: out.queried }),
          ...(ctx?.time?.asked !== undefined && { asked: ctx.time.asked }),
        });
        return out.result ?? out.text;
      },
    });
  });
}

/** The agent for `arm`, from that arm's build. */
export function buildAgent(doors, provider, model, tools, messageIso, withStore, temperature) {
  const builder = doors.Agent.create({
    provider,
    model,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(temperature !== undefined && { temperature }),
    ...(withStore && { artifacts: { store: doors.inMemoryArtifacts() } }),
  })
    .system(systemPrompt(messageIso))
    .tools(tools);
  if (typeof builder.time !== 'function')
    throw new Error("this build's AgentBuilder has no time() — the time layer is not in it");
  return builder.time({ zone: ZONE }).limitsTravelWithTheAnswer().build();
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** The request's late time line: its LAST message when that is a `user` text that is not the person's. */
export function timeLineOf(messages, personMessage) {
  const last = (messages ?? [])[(messages ?? []).length - 1];
  if (last?.role !== 'user') return undefined;
  const text = textOf(last.content);
  return text.length > 0 && text !== personMessage ? text : undefined;
}

/** The model's own final words: the last `llm_end` that asked for no tool. */
export function modelAnswerOf(events) {
  let text;
  for (const e of events ?? []) {
    if (e.type !== 'agentfootprint.stream.llm_end') continue;
    if ((e.payload?.toolCallCount ?? 0) === 0 && typeof e.payload?.content === 'string')
      text = e.payload.content;
  }
  return text;
}

/** The scripted model: plays the variant's calls, then its answer; records each served request. */
export function scriptedMock(doors, variant, messageMs, requests, personMessage) {
  let step = 0;
  const calls = variant.steps(messageMs);
  return doors.mock({
    respond: (req) => {
      const p = projectRequest(req);
      const line = timeLineOf(p.messages, personMessage);
      requests.push({ digest: digest(p), ...(line !== undefined && { timeLine: line }) });
      if (step === 0 && calls.length > 0) {
        step = 1;
        return {
          toolCalls: calls.map((c, i) => ({
            id: `c${i + 1}`,
            name: c.call,
            args: { ...(c.args ?? {}) },
          })),
        };
      }
      return { content: variant.answer };
    },
  });
}

/** The arm's Anthropic adapter over the caller's SDK client, recording each wire body served. */
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
 * Runs one (case, arm, repetition).
 *
 * @param {object} opts
 * @param {object} opts.doors   that ARM's build: `{ Agent, defineTool, describedResult, inMemoryArtifacts, isInputPause, mock, anthropic, recordRun }`
 * @param {object} opts.caseDef
 * @param {'off'|'on'} opts.arm
 * @param {number} opts.rep
 * @param {'mock'|'anthropic'} opts.provider
 * @param {string} opts.model
 * @param {number} opts.runStart the run's clock at its start, epoch ms (to the second)
 */
export async function runCase(opts) {
  const { doors, caseDef, arm, rep, provider: kind, model, runStart } = opts;
  if (PRICES[model] === undefined) throw new Error(`no price for model '${model}'`);
  const messageMs = caseDef.messageAt(runStart);
  const messageIso = iso(messageMs);
  const window = caseDef.window(runStart);
  const readLog = [];
  const requests = [];
  const asks = [];
  const variant = kind === 'mock' ? caseDef.mock[rep % caseDef.mock.length] : undefined;
  const tools = buildTools(doors, caseDef, readLog, runStart);
  let provider;
  if (kind === 'mock')
    provider = scriptedMock(doors, variant, messageMs, requests, caseDef.message);
  else if (kind === 'anthropic') {
    if (opts.sdkClient === undefined) throw new Error('provider anthropic needs opts.sdkClient');
    provider = anthropicWire(doors, opts.sdkClient, requests, caseDef.message);
  } else throw new Error(`unknown provider '${kind}' — mock or anthropic`);

  const withStore = caseDef.clock !== undefined;
  const agent = buildAgent(doors, provider, model, tools, messageIso, withStore, opts.temperature);
  const recorder = doors.recordRun(agent);
  const started = Date.now();
  let answer;
  let error;
  let stuck = false;
  try {
    let out = await agent.run({
      message: caseDef.message,
      time: { now: messageIso, window: { from: iso(window.from), to: iso(window.to) } },
    });
    while (doors.isInputPause(out) && asks.length < MAX_ANSWERED_ASKS) {
      const ai = out.awaitingInput;
      const answered = answerAsk(caseDef, ai, runStart);
      asks.push({ question: ai.question, answers: answered.fields });
      out = await agent.resume(out.checkpoint, answered.reply);
    }
    if (typeof out === 'string') answer = out;
    else stuck = true;
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
  let standing;
  try {
    const a = await agent.assessment();
    if (a !== undefined)
      standing = { standing: a.standing, reasons: (a.reasons ?? []).map((r) => r.reason) };
  } catch (err) {
    standing = { error: String(err?.message ?? err) };
  }
  const events = recording.events ?? [];
  const usage = usageOf(events);
  const modelAnswer = modelAnswerOf(events);
  return {
    key: runKey(arm, caseDef.id, rep),
    arm,
    caseId: caseDef.id,
    rep,
    provider: kind,
    model,
    runStart: iso(runStart),
    messageAt: messageIso,
    window: { from: iso(window.from), to: iso(window.to) },
    ...(variant !== undefined && { variant: variant.label }),
    message: caseDef.message,
    ...(answer !== undefined && { answer }),
    ...(modelAnswer !== undefined && { modelAnswer }),
    ...(stuck && { stuck: true }),
    ...(error !== undefined && { error }),
    readLog,
    asks,
    rows,
    ...(standing !== undefined && { standing }),
    requests,
    usage,
    usd: costOf(usage, model),
    durationMs,
    recording: reduceRecording(recording),
  };
}
