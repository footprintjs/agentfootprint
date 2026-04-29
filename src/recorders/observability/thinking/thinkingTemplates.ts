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
 */

import type { AgentfootprintEvent } from '../../../events/registry.js';

// ── State machine types ────────────────────────────────────────────

/** The four mid-call states a chat bubble might render. */
export type ThinkingStateKind = 'idle' | 'tool' | 'streaming' | 'paused';

/**
 * What the selector returns. The chat-bubble consumer feeds this into
 * the renderer to get the final string.
 */
export interface ThinkingState {
  readonly state: ThinkingStateKind;
  /** Vars for `{{name}}` substitution in the matched template. */
  readonly vars: Readonly<Record<string, string>>;
  /** When `state === 'tool'`, the resolving toolName. The renderer
   *  uses this to look up `tool.<toolName>` before the generic `tool`. */
  readonly toolName?: string;
}

/** Flat template map. Keys: state kinds + per-tool overrides. */
export type ThinkingTemplates = Readonly<Record<string, string>>;

/** Render context — what the consumer's app config injects. */
export interface ThinkingContext {
  /** Active actor's name. Substituted as `{{appName}}` in templates. */
  readonly appName: string;
}

// ── Defaults ───────────────────────────────────────────────────────

/**
 * Bundled English defaults. Override in the agent config via
 * `.thinkingTemplates({...})`. Per-tool overrides go via
 * `tool.<toolName>` keys.
 */
export const defaultThinkingTemplates: ThinkingTemplates = {
  idle: 'Thinking…',
  streaming: '{{partial}}',
  tool: 'Working on `{{toolName}}`…',
  paused: 'Waiting on you: {{question}}',
};

// ── Selector ───────────────────────────────────────────────────────

/**
 * Derive the current thinking state from the event log.
 *
 * Single forward walk that tracks "active" state for each domain:
 *   • pause       — set on pause.request, cleared on pause.resume
 *   • tool        — set on tool.start, cleared on matching tool.end
 *                   (matched by `toolCallId` for parallel-tool safety)
 *   • llm         — set on llm.start, cleared on llm.end
 *
 * Priority order (highest first):
 *
 *   1. ACTIVE PAUSE wins. When the agent is waiting on the human,
 *      that's what the chat should show — not the underlying tool
 *      that triggered the pause.
 *   2. ACTIVE TOOL — the LLM said "use a tool" and the tool is
 *      running. Show "Working on `<toolName>`…".
 *   3. ACTIVE LLM — call in flight. Show streaming tokens if any
 *      arrived, otherwise "Thinking…".
 *   4. Otherwise null (bubble hidden).
 *
 * Pure projection. Forward walk is O(n); a closing event correctly
 * cancels its matching opener so a completed tool.start/tool.end
 * pair leaves the state quiescent.
 */
export function selectThinkingState(events: readonly AgentfootprintEvent[]): ThinkingState | null {
  let activePause: { question: string; toolCallId?: string } | null = null;
  let activeTool: { toolName: string; toolCallId?: string } | null = null;
  let activeLlmStartIdx = -1; // -1 = no active LLM call

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
        activeTool = {
          toolName: p.toolName,
          ...(p.toolCallId ? { toolCallId: p.toolCallId } : {}),
        };
        break;
      }
      case 'agentfootprint.stream.tool_end': {
        // Match by toolCallId so parallel tools don't clobber each
        // other. If no toolCallId is present (older event), clear
        // unconditionally — backward-compat with simpler emitters.
        const p = e.payload as { toolCallId?: string };
        if (!p.toolCallId || activeTool?.toolCallId === p.toolCallId) {
          activeTool = null;
        }
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
  if (activeTool) {
    return {
      state: 'tool',
      toolName: activeTool.toolName,
      vars: {
        toolName: activeTool.toolName,
        ...(activeTool.toolCallId ? { toolCallId: activeTool.toolCallId } : {}),
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
 *   • `state === null`           → null (chat bubble renders nothing)
 *   • `state === 'tool'`         → tries `tool.<toolName>` first, then
 *                                   generic `tool`
 *   • Other states               → looks up the state's name as the key
 *
 * Missing template keys return null rather than the empty string —
 * keeps the contract honest (consumer can detect "no template" and
 * fall back to its own default).
 */
export function renderThinkingLine(
  state: ThinkingState | null,
  ctx: ThinkingContext,
  templates: ThinkingTemplates = defaultThinkingTemplates,
): string | null {
  if (!state) return null;

  let key: string = state.state;
  if (state.state === 'tool' && state.toolName) {
    const specific = `tool.${state.toolName}`;
    if (templates[specific] !== undefined) key = specific;
  }
  const template = templates[key];
  if (template === undefined) return null;

  const vars: Record<string, string> = { appName: ctx.appName, ...state.vars };
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
}
