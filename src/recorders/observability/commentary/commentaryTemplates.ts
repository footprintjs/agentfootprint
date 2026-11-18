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

export type { CommentaryTemplates, CommentaryContext } from './commentaryTemplates/types.js';
export { defaultCommentaryTemplates } from './commentaryTemplates/templates.js';
export { selectCommentaryKey } from './commentaryTemplates/routing.js';
export { extractCommentaryVars } from './commentaryTemplates/vars.js';
export { extractAgentName } from './commentaryTemplates/agentName.js';
export { renderCommentary } from './commentaryTemplates/render.js';
