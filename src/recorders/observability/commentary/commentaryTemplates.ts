/**
 * Commentary templates — bundled English prose for narrating an
 * agentfootprint run, plus the small engine that picks the right
 * template per event and substitutes payload values.
 *
 * Audience split (load-bearing):
 *   • COMMENTARY  — pure prose for the bottom panel of any viewer
 *                   (Lens, CLI tail, log file). NO technical numbers,
 *                   NO field dumps, NO library terms.
 *   • DETAILS      — token counts, durations, args, IDs. The right
 *                   panel / DevTools / structured-log territory.
 *
 * Architecture (3 pieces):
 *   1. `defaultCommentaryTemplates` — flat `key → string` map.
 *      i18n-ready: ship a Spanish/Japanese/etc. version with the same
 *      keys, pass via `commentaryTemplates` on the renderer.
 *   2. `selectCommentaryKey(event)` — per-event-type routing fn.
 *      Returns `string` (render this key), `null` (skip — too
 *      low-signal for prose), or `undefined` (fall through to a
 *      caller-supplied default humanizer).
 *   3. `extractCommentaryVars(event, ctx)` — builds the
 *      `{ appName, userPrompt, toolName, descClause, ... }` bag the
 *      template will be rendered with.
 *
 * Plus a tiny non-recursive `renderCommentary(template, vars)`.
 *
 * Why this lives in agentfootprint (not Lens):
 *   The keys ARE agentfootprint event types. The prose teaches
 *   agentfootprint concepts (slot composition, ReAct, tool-calling).
 *   Consumers building agentfootprint Agents ship their voice / locale
 *   alongside their system prompt and tool registry. Lens (or any
 *   other viewer) is just a renderer that consumes this surface.
 *
 * Verb discipline (encoded in the prose):
 *   • `{{appName}}` (active actor)  — called, dispatched, returned,
 *                                      decided, read, built
 *   • LLM (passive actor)            — suggested, responded, produced,
 *                                      asked for, gave
 *   The split reflects the architectural truth: LLMs don't act, the
 *   orchestrating system does.
 */

import type { AgentfootprintEvent } from '../../../events/registry.js';

/** Flat map of template keys to template strings. Keys use a dotted
 *  hierarchy mirroring event types + payload branches
 *  (`'stream.llm_start.iter1'`, `'context.injected.rag'`). Values may
 *  contain `{{name}}` placeholders that `renderCommentary` substitutes. */
export type CommentaryTemplates = Readonly<Record<string, string>>;

/**
 * The bundled English templates. Override per-key via the renderer's
 * `templates` option — partial overrides are spread on top of these
 * defaults so consumers only ship what they want to change.
 */
export const defaultCommentaryTemplates: CommentaryTemplates = {
  'agent.turn_start': 'User asked {{appName}}: "{{userPrompt}}".',

  // `{{agentName}}` resolves to the active agent's display name when
  // the event fires inside a Sequence stage / Swarm member / nested
  // Agent. For single-Agent runs (no inner-agent path), it falls back
  // to `{{appName}}` so existing copy reads identically.
  'stream.llm_start.iter1': '{{agentName}} sent the question to the LLM.',
  'stream.llm_start.iterN': "{{agentName}} sent the tool's result to the LLM for reasoning.",

  'stream.llm_end.tools': 'The LLM said it needs to use a tool. {{agentName}} will do that next.',
  'stream.llm_end.terminal':
    'The LLM gave the final answer. {{agentName}} returned it to the user.',

  // Streaming. Token chunks are NOT rendered as one line each — that
  // would flood the commentary. Consumers (Lens) accumulate tokens
  // into a single "live" entry that updates in place until llm_end
  // arrives, then replace it with the terminal narration above.
  // The two templates here are for that consumer:
  //   • `stream.thinking` — shown the moment llm_start fires, BEFORE
  //     any tokens arrive ("Chatbot is thinking…")
  //   • `stream.token.partial` — shown while tokens accumulate
  //     ("Chatbot is responding: {{partial}}")
  // Selecting these is a viewer concern; the engine emits the keys
  // and the renderer decides whether to mount a live line or skip.
  'stream.thinking': '{{appName}} is thinking…',
  'stream.token.partial': '{{appName}} is responding: {{partial}}',

  'stream.tool_start':
    '{{agentName}} called the `{{toolName}}` tool{{descClause}}. The LLM asked for it, and {{agentName}} figured out the inputs from the conversation.',
  'stream.tool_start.desc': ' — registered as "{{desc}}"',
  'stream.tool_start.noDesc': '',

  'stream.tool_end': 'The tool returned its result. {{agentName}} will share it with the LLM next.',

  'context.injected.rag':
    '{{appName}} retrieved relevant content and added it to the conversation.',
  'context.injected.skill':
    '{{appName}} activated a skill — its body went into the system prompt, and its tools became available to the LLM.',
  'context.injected.memory':
    '{{appName}} pulled prior content from memory and added it to the conversation.',
  // Generic — fits always-on rules + on-tool-return predicates uniformly.
  // Specialized variants below disambiguate when the trigger metadata
  // is available on the event.
  'context.injected.instructions': '{{appName}} added a rule to the system prompt: {{descClause}}.',
  'context.injected.instructions.onToolReturn':
    '{{appName}} added a tool-specific reminder after `{{lastToolName}}` returned: {{descClause}}.',
  'context.injected.instructions.alwaysOn':
    '{{appName}} added an always-on rule to the system prompt: {{descClause}}.',
  'context.injected.custom': '{{appName}} injected a custom piece of context.',

  'skill.activated':
    '{{appName}} turned on a skill — its tools and instructions are now available.',
  'skill.deactivated': '{{appName}} turned off a skill.',

  'composition.fork_start': '{{appName}} fanned out into parallel branches.',
  'composition.merge_end': '{{appName}} merged the parallel branches back into one.',

  // Multi-agent / multi-LLM composition narration. Each composition
  // primitive gets its own enter / exit template. Single-Agent runs
  // never fire these; they're for Sequence / Parallel / Loop /
  // Conditional shapes. Override per-key for locale or brand voice.
  'composition.enter.Sequence': 'Started pipeline `{{name}}` — {{childCount}} stages chained.',
  'composition.enter.Parallel': 'Forked `{{name}}` into {{childCount}} parallel branches.',
  'composition.enter.Loop': 'Started loop `{{name}}` — repeat until done.',
  'composition.enter.Conditional': 'Entering router `{{name}}` — picking a branch.',
  'composition.enter.Generic':
    'Entered composition `{{name}}` ({{kind}}) with {{childCount}} children.',
  'composition.exit': '`{{name}}` finished — {{status}} in {{durationMs}}ms.',
  // Inter-agent handoff (synthesized between adjacent Sequence stages).
  // Surfaces "classify → respond" instead of two unrelated llm_start
  // lines. Renderer derives `fromAgent` / `toAgent` from sibling
  // subflow.exit / entry pair at the same depth.
  'composition.handoff': 'Handed off `{{fromAgent}}` → `{{toAgent}}`.',

  'pause.request': '{{appName}} paused — waiting for input from a human or external system.',
  'pause.resume': '{{appName}} resumed.',

  'cost.limit_hit': '{{appName}} hit a cost limit and stopped.',
};

/** Context the var-extractor reads from. Anything that's NOT in the
 *  event payload (consumer-supplied appName, tool registry lookup) goes
 *  here. Pure data — no closures, no I/O. */
export interface CommentaryContext {
  /** The system that orchestrates the LLM. Substituted as the active
   *  actor in every line ("Acme called the LLM"). Default: `'Chatbot'`. */
  readonly appName: string;
  /** Resolves a tool name to its registered description ("Get current
   *  weather for a city"). Used to compose the optional `descClause`
   *  for `stream.tool_start`. Sync — Lens-style consumers precompute
   *  the lookup map from `context.injected source='registry'` events. */
  readonly getToolDescription?: (toolName: string) => string | undefined;
}

/**
 * Pick the template key for an event. Branches encoded in the key
 * suffix (no conditional logic in the templates themselves).
 *
 *   `null`      → explicit skip (baseline injections, low-signal events)
 *   `undefined` → fall through to caller's default humanizer
 *   `string`    → render `templates[key]` with `extractCommentaryVars`
 */
export function selectCommentaryKey(event: AgentfootprintEvent): string | null | undefined {
  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return 'agent.turn_start';
    case 'agentfootprint.agent.turn_end':
      return null;

    case 'agentfootprint.stream.llm_start':
      return event.payload.iteration === 1 ? 'stream.llm_start.iter1' : 'stream.llm_start.iterN';

    case 'agentfootprint.stream.llm_end':
      return event.payload.toolCallCount > 0 ? 'stream.llm_end.tools' : 'stream.llm_end.terminal';

    case 'agentfootprint.stream.tool_start':
      return 'stream.tool_start';
    case 'agentfootprint.stream.tool_end':
      return 'stream.tool_end';

    case 'agentfootprint.context.injected':
      switch (event.payload.source) {
        case 'rag':
          return 'context.injected.rag';
        case 'skill':
          return 'context.injected.skill';
        case 'memory':
          return 'context.injected.memory';
        case 'instructions':
          return 'context.injected.instructions';
        case 'custom':
          return 'context.injected.custom';
        // Baseline injections (LLM API natives, not engineering
        // decisions): drop from prose.
        case 'user':
        case 'tool-result':
        case 'assistant':
        case 'base':
        case 'registry':
          return null;
        default:
          return 'context.injected.custom';
      }

    case 'agentfootprint.skill.activated':
      return 'skill.activated';
    case 'agentfootprint.skill.deactivated':
      return 'skill.deactivated';

    case 'agentfootprint.agent.iteration_start':
    case 'agentfootprint.agent.iteration_end':
    case 'agentfootprint.agent.route_decided':
      return null; // implicit in surrounding llm.start/end narrative

    case 'agentfootprint.composition.fork_start':
      return 'composition.fork_start';
    case 'agentfootprint.composition.merge_end':
      return 'composition.merge_end';

    case 'agentfootprint.composition.enter': {
      // Per-kind template suffix lets each composition primitive read
      // naturally (Sequence = pipeline, Parallel = fork, Loop = repeat,
      // Conditional = router). Falls back to `composition.enter.Generic`
      // for unknown kinds so future primitives don't break the prose.
      const kind = event.payload.kind;
      const specific = `composition.enter.${kind}`;
      // Defer to the renderer to fall back when the specific key isn't
      // present — `renderCommentary` returns empty for missing tokens,
      // so a missing key is a degraded-but-not-fatal experience.
      return specific;
    }
    case 'agentfootprint.composition.exit':
      return 'composition.exit';

    case 'agentfootprint.pause.request':
      return 'pause.request';
    case 'agentfootprint.pause.resume':
      return 'pause.resume';

    case 'agentfootprint.cost.limit_hit':
      return 'cost.limit_hit';

    // Slot mechanics — plumbing, not pedagogy. The engineered
    // injections above already narrate WHAT was added; the surrounding
    // llm.start line narrates WHY. Mechanical "system-prompt composed
    // (iter 1, 54/4000 tokens)" leaks technical numbers and adds no
    // pedagogy.
    case 'agentfootprint.context.slot_composed':
    case 'agentfootprint.context.evicted':
    case 'agentfootprint.context.budget_pressure':
      return null;

    default:
      return undefined; // fall through
  }
}

/**
 * Build the variable bag for a given event. Flat `name → string` map;
 * `renderCommentary` substitutes by name. Templates use whatever names
 * this function produces.
 *
 * Two-step composition for `stream.tool_start`: the optional
 * `descClause` is a rendered sub-template. We pre-render it here so
 * the outer template stays a single non-recursive substitution pass.
 */
export function extractCommentaryVars(
  event: AgentfootprintEvent,
  ctx: CommentaryContext,
  templates: CommentaryTemplates = defaultCommentaryTemplates,
): Record<string, string> {
  const agentName = extractAgentName(event, ctx);
  const base = { appName: ctx.appName, agentName };

  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return { ...base, userPrompt: event.payload.userPrompt };

    case 'agentfootprint.stream.tool_start': {
      const toolName = event.payload.toolName;
      const desc = ctx.getToolDescription?.(toolName);
      const hasDesc = typeof desc === 'string' && desc.trim().length > 0;
      // Pre-render the descClause sub-template so the outer template
      // sees a literal string. Keeps the engine flat (non-recursive).
      const descClause = hasDesc
        ? // hasDesc guarantees desc is a non-empty string here.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          renderCommentary(templates['stream.tool_start.desc'] ?? '', { desc: desc! })
        : templates['stream.tool_start.noDesc'] ?? '';
      return { ...base, toolName, descClause };
    }

    case 'agentfootprint.composition.enter': {
      const p = event.payload;
      return {
        ...base,
        name: p.name,
        kind: p.kind,
        childCount: String(p.childCount),
      };
    }

    case 'agentfootprint.composition.exit': {
      const p = event.payload;
      // CompositionExitPayload carries `id` but no `name` — use the id
      // as the display key. Consumers can override the template if
      // they want to look up names from a side table.
      return {
        ...base,
        name: p.id,
        kind: p.kind,
        status: p.status,
        durationMs: String(p.durationMs ?? 0),
      };
    }

    // Most templates only need {{appName}} / {{agentName}} — no token
    // counts, no IDs, no durations make it into prose. Those live in
    // DETAILS.
    default:
      return base;
  }
}

// ─── agentName derivation ──────────────────────────────────────────

/**
 * Library-internal subflow id segments that are NOT user-facing
 * agent identities. When walking back through `event.meta.subflowPath`
 * we skip these to find the meaningful agent / stage name.
 */
const COMMENTARY_INTERNAL_SEGMENT_PREFIXES = ['sf-', 'thinking-'] as const;
const COMMENTARY_INTERNAL_SEGMENTS = new Set<string>([
  'sf-injection-engine',
  'sf-system-prompt',
  'sf-messages',
  'sf-tools',
  'sf-route',
  'sf-tool-calls',
  'sf-merge',
  'sf-thinking',
  'sf-cache-decision',
  'final', // route-decider 'final' branch — same exception as SUBFLOW_IDS.FINAL
]);

function isInternalSegment(seg: string): boolean {
  if (COMMENTARY_INTERNAL_SEGMENTS.has(seg)) return true;
  for (const p of COMMENTARY_INTERNAL_SEGMENT_PREFIXES) {
    if (seg.startsWith(p)) return true;
  }
  return false;
}

/**
 * Resolve the agent name from an event's `meta.subflowPath`.
 *
 * Walks the path right-to-left, skipping library-internal segments
 * (slot subflows, agent-routing subflows, thinking handlers), and
 * returns the FIRST meaningful segment with the optional `step-`
 * Sequence prefix stripped. For events with no meaningful path
 * (single-Agent runners, top-level events), falls back to `appName`.
 */
export function extractAgentName(event: AgentfootprintEvent, ctx: CommentaryContext): string {
  const path = event.meta?.subflowPath ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (!seg) continue;
    if (isInternalSegment(seg)) continue;
    return seg.replace(/^step-/, '');
  }
  return ctx.appName;
}

/**
 * Render a template by substituting `{{name}}` placeholders from the
 * vars bag. Missing keys render as empty string — keeps prose
 * forgiving when an optional field isn't present.
 *
 * Non-recursive: a substituted value is NOT itself processed for
 * placeholders. Compose sub-templates upstream (see
 * `extractCommentaryVars`).
 */
export function renderCommentary(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
}
