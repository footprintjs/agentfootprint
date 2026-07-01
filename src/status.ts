/**
 * agentfootprint/status — chat-bubble status surface.
 *
 * Pattern: pure projection. `selectStatus` walks the typed
 *          event log forward, tracking active pause / tool / LLM state,
 *          and returns the CURRENT thinking state (or null when the
 *          bubble should hide).
 * Role:    Outer ring. Consumers (Lens, custom chat UIs, embedded
 *          widgets) call this to drive a "what is the agent doing
 *          right now?" indicator. Output feeds `renderStatusLine`
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
 * Prose lives elsewhere: the `defaultStatusTemplates` catalog's canonical
 * home is `agentfootprint/locales` (the single i18n home for all prose —
 * commentary, thinking, status). It is re-exported here for convenience, but
 * new code should import the words from `/locales` and the LOGIC
 * (`selectStatus` / `renderStatusLine`) from here.
 *
 * As of v7 these are NOT on the main `agentfootprint` barrel — status is a
 * named subpath like every other observability surface. Import the logic
 * from `agentfootprint/status`, the words from `agentfootprint/locales`.
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

// Logic only — the status state machine + renderer. The prose catalog
// (`defaultStatusTemplates`) lives on `agentfootprint/locales`, the single
// home for all user-facing text; `renderStatusLine` consumes it.
export {
  selectStatus,
  renderStatusLine,
  type StatusState,
  type StatusKind,
  type StatusTemplates,
  type StatusContext,
} from './recorders/observability/status/statusTemplates.js';
