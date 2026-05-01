/**
 * agentfootprint/status — chat-bubble status surface.
 *
 * Pattern: pure projection. `selectThinkingState` walks the typed
 *          event log forward, tracking active pause / tool / LLM state,
 *          and returns the CURRENT thinking state (or null when the
 *          bubble should hide).
 * Role:    Outer ring. Consumers (Lens, custom chat UIs, embedded
 *          widgets) call this to drive a "what is the agent doing
 *          right now?" indicator. Output feeds `renderThinkingLine`
 *          which resolves a template + variables to a final string.
 *
 * Why a subpath:
 *   - Consistent with `agentfootprint/observe` and
 *     `agentfootprint/locales` — every observability surface gets its
 *     own entry point.
 *   - Self-documenting at the import line: `from 'agentfootprint/status'`
 *     vs an opaque main-export grab.
 *   - Future home for extended-thinking primitives (Anthropic
 *     `thinking_delta` / `redacted_thinking` blocks). Adding them here
 *     is non-breaking; consumers already importing from
 *     `agentfootprint/status` get the new state surface for free.
 *
 * Back-compat: every export here is also re-exported from the main
 * `agentfootprint` entry. Migrating consumers is mechanical (rewrite
 * the import path); both paths work.
 *
 * State machine (4 states + null):
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
 */

export {
  defaultThinkingTemplates,
  selectThinkingState,
  renderThinkingLine,
  type ThinkingState,
  type ThinkingStateKind,
  type ThinkingTemplates,
  type ThinkingContext,
} from './recorders/observability/thinking/thinkingTemplates.js';
