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

  'stream.llm_start.iter1': '{{appName}} sent the question to the LLM.',
  'stream.llm_start.iterN': "{{appName}} sent the tool's result to the LLM for reasoning.",

  'stream.llm_end.tools':    'The LLM said it needs to use a tool. {{appName}} will do that next.',
  'stream.llm_end.terminal': 'The LLM gave the final answer. {{appName}} returned it to the user.',

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
  'stream.thinking':       '{{appName}} is thinking…',
  'stream.token.partial':  '{{appName}} is responding: {{partial}}',

  'stream.tool_start':         '{{appName}} called the `{{toolName}}` tool{{descClause}}. The LLM asked for it, and {{appName}} figured out the inputs from the conversation.',
  'stream.tool_start.desc':    ' — registered as "{{desc}}"',
  'stream.tool_start.noDesc':  '',

  'stream.tool_end': 'The tool returned its result. {{appName}} will share it with the LLM next.',

  'context.injected.rag':          '{{appName}} retrieved relevant content and added it to the conversation.',
  'context.injected.skill':        '{{appName}} activated a skill — its body went into the system prompt, and its tools became available to the LLM.',
  'context.injected.memory':       '{{appName}} pulled prior content from memory and added it to the conversation.',
  'context.injected.instructions': '{{appName}} added a tool-specific instruction to the system prompt after that tool returned.',
  'context.injected.custom':       '{{appName}} injected a custom piece of context.',

  'skill.activated':   '{{appName}} turned on a skill — its tools and instructions are now available.',
  'skill.deactivated': '{{appName}} turned off a skill.',

  'composition.fork_start': '{{appName}} fanned out into parallel branches.',
  'composition.merge_end':  '{{appName}} merged the parallel branches back into one.',

  'pause.request': '{{appName}} paused — waiting for input from a human or external system.',
  'pause.resume':  '{{appName}} resumed.',

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
export function selectCommentaryKey(
  event: AgentfootprintEvent,
): string | null | undefined {
  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return 'agent.turn_start';
    case 'agentfootprint.agent.turn_end':
      return null;

    case 'agentfootprint.stream.llm_start':
      return event.payload.iteration === 1
        ? 'stream.llm_start.iter1'
        : 'stream.llm_start.iterN';

    case 'agentfootprint.stream.llm_end':
      return event.payload.toolCallCount > 0
        ? 'stream.llm_end.tools'
        : 'stream.llm_end.terminal';

    case 'agentfootprint.stream.tool_start':
      return 'stream.tool_start';
    case 'agentfootprint.stream.tool_end':
      return 'stream.tool_end';

    case 'agentfootprint.context.injected':
      switch (event.payload.source) {
        case 'rag':          return 'context.injected.rag';
        case 'skill':        return 'context.injected.skill';
        case 'memory':       return 'context.injected.memory';
        case 'instructions': return 'context.injected.instructions';
        case 'custom':       return 'context.injected.custom';
        // Baseline injections (LLM API natives, not engineering
        // decisions): drop from prose.
        case 'user':
        case 'tool-result':
        case 'assistant':
        case 'base':
        case 'registry':
          return null;
        default: return 'context.injected.custom';
      }

    case 'agentfootprint.skill.activated':   return 'skill.activated';
    case 'agentfootprint.skill.deactivated': return 'skill.deactivated';

    case 'agentfootprint.agent.iteration_start':
    case 'agentfootprint.agent.iteration_end':
    case 'agentfootprint.agent.route_decided':
      return null; // implicit in surrounding llm.start/end narrative

    case 'agentfootprint.composition.fork_start': return 'composition.fork_start';
    case 'agentfootprint.composition.merge_end':  return 'composition.merge_end';

    case 'agentfootprint.pause.request': return 'pause.request';
    case 'agentfootprint.pause.resume':  return 'pause.resume';

    case 'agentfootprint.cost.limit_hit': return 'cost.limit_hit';

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
  const base = { appName: ctx.appName };

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
        ? renderCommentary(templates['stream.tool_start.desc'] ?? '', { desc: desc! })
        : (templates['stream.tool_start.noDesc'] ?? '');
      return { ...base, toolName, descClause };
    }

    // Most templates only need {{appName}} — no token counts, no IDs,
    // no durations make it into prose. Those live in DETAILS.
    default:
      return base;
  }
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
export function renderCommentary(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
}
