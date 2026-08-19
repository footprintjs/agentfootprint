/**
 * Thinking templates — chat-bubble surface (separate from commentary).
 *
 * Audience split:
 *   • COMMENTARY (`commentaryTemplates`)  — third-person, every moment,
 *                                            shown in Lens panel. Audience:
 *                                            developer / observer.
 *   • THINKING (this file)                — first-person, mid-call only,
 *                                            shown in chat bubble. Audience:
 *                                            end user chatting with the agent.
 *
 * The thinking surface is a tiny finite state machine driven purely by
 * the event log:
 *
 *      ┌──────────┐  llm.start, no tools yet
 *  ────┤  idle    ├────────────────────────────► "Thinking…"
 *      └──────────┘
 *
 *      ┌──────────┐  stream.token chunks accumulate
 *  ────┤streaming ├────────────────────────────► "{{partial}}"
 *      └──────────┘
 *
 *      ┌──────────┐  tool.start, no tool.end yet
 *  ────┤   tool   ├────────────────────────────► "Working on `weather`…"
 *      └──────────┘                               (or per-tool override)
 *
 *      ┌──────────┐  tool_progress, still no tool.end
 *  ────┤   tool   ├────────────────────────────► "Looking at your screen…"
 *      └──────────┘  (same state, newer line)     (or the generic report)
 *
 *      ┌──────────┐  pause.request, no resume yet
 *  ────┤  paused  ├────────────────────────────► "Waiting on you: …"
 *      └──────────┘
 *
 *      (null)        run done / between calls   → bubble hidden
 *
 * The selector returns the CURRENT state by walking the event log;
 * the renderer maps state → final string by looking up the template.
 *
 * Per-tool templates: consumers can ship `tool.<toolName>` keys
 * (e.g. `tool.weather: 'Looking up the weather…'`) which the renderer
 * prefers over the generic `tool` template. Lets each tool have its
 * own first-person status without per-tool plumbing.
 *
 * MID-CALL REPORTS (9.54.0). `ctx.progress(payload)` files
 * `stream.tool_progress` from inside a still-running tool call. Through
 * 9.53.0 that event reached the record and stopped there: nothing
 * projected it onto the surface a person watches, so consumers hand-rolled
 * a side channel for the live middle of a long call. The `tool` state now
 * consumes it — same state, newer line — and the DISPLAY CONTRACT is
 * deliberately narrow, because `payload` is author-defined `unknown`:
 *
 *   · a top-level string field named `message` is shown VERBATIM
 *     (trimmed; cut at {@link PROGRESS_MESSAGE_LIMIT} characters, and the
 *     cut is always stated). `message` is the word MCP's own progress
 *     notification uses, so a tool already speaking that protocol needs no
 *     second vocabulary.
 *   · anything else — no `message`, a non-string one, an empty one — gets
 *     the generic line: the tool's name, that it reported, and how many
 *     times. NEVER a pretty-printed dump of the author's payload: a status
 *     line is prose, and prose that quotes a JSON blob is the field-dump
 *     law broken in public.
 *
 * The structured payload rides on to the record untouched either way. One
 * `ctx.progress` call, two honest faces.
 */

import type { AgentfootprintEvent } from '../../../events/registry.js';

// ── State machine types ────────────────────────────────────────────

/** The four mid-call states a chat bubble might render. */
export type StatusKind = 'idle' | 'tool' | 'streaming' | 'paused';

/**
 * What the selector returns. The chat-bubble consumer feeds this into
 * the renderer to get the final string.
 */
export interface StatusState {
  readonly state: StatusKind;
  /** Vars for `{{name}}` substitution in the matched template. */
  readonly vars: Readonly<Record<string, string>>;
  /** When `state === 'tool'`, the resolving toolName. The renderer
   *  uses this to look up `tool.<toolName>` before the generic `tool`. */
  readonly toolName?: string;
}

/** Flat template map. Keys: state kinds + per-tool overrides. */
export type StatusTemplates = Readonly<Record<string, string>>;

/** Render context — what the consumer's app config injects. */
export interface StatusContext {
  /** Active actor's name. Substituted as `{{appName}}` in templates. */
  readonly appName: string;
}

// ── Defaults ───────────────────────────────────────────────────────

/**
 * Bundled English defaults. Override in the agent config via
 * `.thinkingTemplates({...})`. Per-tool overrides go via
 * `tool.<toolName>` keys.
 */
export const defaultStatusTemplates: StatusTemplates = {
  idle: 'Thinking…',
  streaming: '{{partial}}',
  tool: 'Working on `{{toolName}}`…',
  paused: 'Waiting on you: {{question}}',

  // Mid-call reports (9.54.0). `tool.progress` mirrors `streaming` — the
  // template is the author's own sentence and nothing else, because a line
  // this library wrapped around it would be this library talking over a tool
  // that already said what it is doing.
  'tool.progress': '{{progressMessage}}',
  // …and when it said nothing sayable, the honest line is the fact that it
  // reported, plus how often. No payload, ever.
  'tool.progress.generic': '`{{toolName}}` reported progress ({{progressCount}} so far)…',
};

/**
 * How much of a tool author's `message` one status line carries before it is
 * cut. A status line lives in a chat bubble; past ~120 characters it stops
 * being a status and starts being a paragraph.
 *
 * Truncation is always STATED, never silent — the line says how much it cut,
 * the same rule the analyst-view humanizer keeps. A message that legitimately
 * ends in an ellipsis must stay distinguishable from one we shortened.
 */
export const PROGRESS_MESSAGE_LIMIT = 120;

/**
 * The tool author's `message`, ready to show — or `null` when this report had
 * nothing sayable and the generic line should stand instead.
 *
 * Deliberately strict, and the strictness is the contract:
 *
 *   · the payload must be a plain object with a top-level `message` STRING.
 *     A bare string payload is not a `message` — `ctx.progress('…')` is a
 *     valid report, but it is the author's data, not a sentence they asked us
 *     to show a person. Wrapping it (`ctx.progress({ message: '…' })`) is the
 *     one-word opt-in, and it keeps a single rule to document.
 *   · an empty or whitespace-only `message` is not a sentence. It falls to the
 *     generic line rather than blanking the bubble mid-call.
 *
 * Nothing here reads any other field. Guessing at `done`/`total`/`percent`
 * would put words in the tool's mouth: one tool's `total` is hops, the next
 * one's is bytes, and a status line that says "3 of 12" about the wrong unit
 * is worse than one that says nothing.
 */
export function progressMessageOf(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = (payload as { message?: unknown }).message;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.length <= PROGRESS_MESSAGE_LIMIT) return text;
  const cut = text.length - PROGRESS_MESSAGE_LIMIT;
  return `${text.slice(0, PROGRESS_MESSAGE_LIMIT)}… (+${String(cut)} more)`;
}

// ── Selector ───────────────────────────────────────────────────────

/**
 * Derive the current thinking state from the event log.
 *
 * Single forward walk that tracks "active" state for each domain:
 *   • pause       — set on pause.request, cleared on pause.resume
 *   • tool calls  — a call joins the in-flight map on tool.start and leaves
 *                   it on ITS OWN tool.end (matched by `toolCallId`), so two
 *                   parallel calls cannot close each other. Each in-flight
 *                   call also carries its own progress tally (9.54.0).
 *   • llm         — set on llm.start, cleared on llm.end
 *
 * Priority order (highest first):
 *
 *   1. ACTIVE PAUSE wins. When the agent is waiting on the human,
 *      that's what the chat should show — not the underlying tool
 *      that triggered the pause.
 *   2. AN IN-FLIGHT TOOL CALL — the LLM said "use a tool" and the tool is
 *      running. Show "Working on `<toolName>`…", or, once that call has
 *      reported, what it reported.
 *   3. ACTIVE LLM — call in flight. Show streaming tokens if any
 *      arrived, otherwise "Thinking…".
 *   4. Otherwise null (bubble hidden).
 *
 * WHICH CALL THE LINE IS ABOUT, when several run in parallel: the one with
 * the most recent `tool_progress`, and only if none of them has reported, the
 * most recently STARTED. A report is the newest evidence of what is actually
 * happening, and a surface that showed a silent call while a reporting one
 * had something to say would be choosing the less informative truth. Two
 * chatty parallel calls therefore alternate on the line, each verbatim, in the
 * order their reports landed — which is what a person watching them wants.
 *
 * Pure projection. Forward walk is O(n); a closing event correctly
 * cancels its matching opener so a completed tool.start/tool.end
 * pair leaves the state quiescent.
 */
export function selectStatus(events: readonly AgentfootprintEvent[]): StatusState | null {
  let activePause: { question: string; toolCallId?: string } | null = null;
  let activeLlmStartIdx = -1; // -1 = no active LLM call

  /** One in-flight tool call. `lastProgressSeq === -1` ⇒ never reported. */
  interface InFlightCall {
    readonly toolName: string;
    readonly toolCallId?: string;
    readonly startSeq: number;
    progressCount: number;
    lastProgressSeq: number;
    /** The last report's `message`, or null when it carried none. */
    lastMessage: string | null;
  }
  const inFlight = new Map<string, InFlightCall>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'agentfootprint.pause.request': {
        const p = e.payload as { reason?: string; toolCallId?: string };
        activePause = {
          question: p.reason ?? 'input required',
          ...(p.toolCallId ? { toolCallId: p.toolCallId } : {}),
        };
        break;
      }
      case 'agentfootprint.pause.resume':
        activePause = null;
        break;

      case 'agentfootprint.stream.tool_start': {
        const p = e.payload as { toolName: string; toolCallId?: string };
        // A call with no id still gets a slot — an emitter simpler than this
        // library's own (a hand-built stream, an older recording) must still
        // move the bubble. The synthetic key just cannot be correlated.
        inFlight.set(p.toolCallId ?? `__anon#${String(i)}`, {
          toolName: p.toolName,
          ...(p.toolCallId ? { toolCallId: p.toolCallId } : {}),
          startSeq: i,
          progressCount: 0,
          lastProgressSeq: -1,
          lastMessage: null,
        });
        break;
      }

      case 'agentfootprint.stream.tool_progress': {
        // 9.54.0 — the live middle of a call. Correlate STRICTLY by id: the
        // framework stamps it, so a real run always has one. Off the wire it
        // may be missing, and then the only safe attribution is a sole
        // in-flight call; with two running, a guess would put one call's words
        // under the other one's name.
        const p = e.payload as { toolCallId?: string; payload?: unknown };
        const key =
          p.toolCallId !== undefined && inFlight.has(p.toolCallId)
            ? p.toolCallId
            : p.toolCallId === undefined && inFlight.size === 1
            ? [...inFlight.keys()][0]
            : undefined;
        if (key === undefined) break; // a report for a call that already ended
        const call = inFlight.get(key);
        if (call === undefined) break;
        call.progressCount += 1;
        call.lastProgressSeq = i;
        call.lastMessage = progressMessageOf(p.payload);
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        // Match by toolCallId so parallel tools don't clobber each
        // other. If no toolCallId is present (older event), clear
        // unconditionally — backward-compat with simpler emitters.
        const p = e.payload as { toolCallId?: string };
        if (p.toolCallId === undefined) inFlight.clear();
        else inFlight.delete(p.toolCallId);
        break;
      }

      case 'agentfootprint.stream.llm_start':
        activeLlmStartIdx = i;
        break;
      case 'agentfootprint.stream.llm_end':
        activeLlmStartIdx = -1;
        break;
    }
  }

  // Priority resolution.
  if (activePause) {
    return {
      state: 'paused',
      vars: {
        question: activePause.question,
        ...(activePause.toolCallId ? { toolCallId: activePause.toolCallId } : {}),
      },
    };
  }
  const calls = [...inFlight.values()];
  if (calls.length > 0) {
    const reported = calls.filter((c) => c.lastProgressSeq >= 0);
    const focus =
      reported.length > 0
        ? reported.reduce((a, b) => (b.lastProgressSeq > a.lastProgressSeq ? b : a))
        : calls.reduce((a, b) => (b.startSeq > a.startSeq ? b : a));
    return {
      state: 'tool',
      toolName: focus.toolName,
      vars: {
        toolName: focus.toolName,
        ...(focus.toolCallId ? { toolCallId: focus.toolCallId } : {}),
        // Absent field → absent clause: a call that has not reported carries
        // no progress vars at all, so the renderer resolves exactly the ladder
        // it resolved before this feature existed.
        ...(focus.progressCount > 0 ? { progressCount: String(focus.progressCount) } : {}),
        ...(focus.lastMessage !== null ? { progressMessage: focus.lastMessage } : {}),
      },
    };
  }
  if (activeLlmStartIdx >= 0) {
    // Concatenate any tokens emitted after the active llm.start.
    let partial = '';
    for (let j = activeLlmStartIdx + 1; j < events.length; j++) {
      if (events[j].type === 'agentfootprint.stream.token') {
        const tok = events[j].payload as { content: string };
        partial += tok.content;
      }
    }
    return partial.length > 0
      ? { state: 'streaming', vars: { partial } }
      : { state: 'idle', vars: {} };
  }
  return null;
}

// ── Renderer ───────────────────────────────────────────────────────

/**
 * Resolve the matched template + substitute vars.
 *
 * Each state resolves a LADDER of candidate keys, most specific first, and
 * takes the first one the merged template map defines:
 *
 *   | the state                          | ladder                                                              |
 *   |------------------------------------|---------------------------------------------------------------------|
 *   | tool, reported with a `message`    | `tool.<name>.progress` → `tool.progress` → `tool.<name>` → `tool`     |
 *   | tool, reported without one         | `tool.<name>.progress.generic` → `tool.progress.generic` → `tool.<name>` → `tool` |
 *   | tool, no report yet                | `tool.<name>` → `tool`                                                |
 *   | anything else                      | the state's own name                                                  |
 *
 * The ladder falls THROUGH to the plain tool keys on purpose. A consumer who
 * shipped a curated `tool.weather` line and does not want it interrupted
 * deletes `tool.progress.generic` from their map and keeps it; a consumer who
 * ships a partial map that predates 9.54.0 keeps rendering exactly what it
 * rendered before, mid-call reports and all. Nothing here can blank a bubble
 * that used to have a line in it.
 *
 * Missing template keys return null rather than the empty string —
 * keeps the contract honest (consumer can detect "no template" and
 * fall back to its own default).
 */
export function renderStatusLine(
  state: StatusState | null,
  ctx: StatusContext,
  templates: StatusTemplates = defaultStatusTemplates,
): string | null {
  if (!state) return null;

  let template: string | undefined;
  for (const key of templateLadder(state)) {
    template = templates[key];
    if (template !== undefined) break;
  }
  if (template === undefined) return null;

  const vars: Record<string, string> = { appName: ctx.appName, ...state.vars };
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
}

/** Candidate template keys for a state, most specific first. */
function templateLadder(state: StatusState): readonly string[] {
  if (state.state !== 'tool') return [state.state];
  const generic = state.toolName !== undefined ? [`tool.${state.toolName}`, 'tool'] : ['tool'];
  const perTool = (suffix: string): string[] =>
    state.toolName !== undefined ? [`tool.${state.toolName}.${suffix}`] : [];
  if (state.vars.progressMessage !== undefined) {
    return [...perTool('progress'), 'tool.progress', ...generic];
  }
  if (state.vars.progressCount !== undefined) {
    return [...perTool('progress.generic'), 'tool.progress.generic', ...generic];
  }
  return generic;
}
