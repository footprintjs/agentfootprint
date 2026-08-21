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
import {
  ARTIFACT_OP_PHRASES,
  ARTIFACT_REFUSAL_PHRASES,
  ARTIFACT_SWEEP_PHRASES,
  humanizeBytes,
  humanizeChars,
  phraseFor,
} from './artifactPhrases.js';

/** Flat map of template keys to template strings. Keys use a dotted
 *  hierarchy mirroring event types + payload branches
 *  (`'stream.llm_start.iter1'`, `'context.injected.rag'`). Values may
 *  contain `{{name}}` placeholders that `renderCommentary` substitutes. */
export type CommentaryTemplates = Readonly<Record<string, string>>;

/**
 * ONE sentence, two records (9.28.0). A tier-1 DATA-matcher route is witnessed
 * on the cascade's verdict (`skill.turn_routed`) AND on the hop that carried it
 * (`context.evaluated.cursorMove`) — and a graph with NO cascade has only the
 * second, which is why the because-clause used to reach cascade readers alone.
 * Both keys ship this one string by construction, so the two records can never
 * drift into two stories about the same fact. They stay two KEYS, because
 * consumers override by key and each record is still its own line.
 */
const ENTRY_WITNESS_LINE =
  'A declared start rule routed this turn to `{{to}}` because the message said “{{witness}}”.';

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

  // A mid-call report (9.54.0). The teaching voice says THAT the call broke
  // its silence, never what the author's payload said: `payload` is
  // `unknown`, and a sentence that quoted it would be a field dump wearing
  // prose. The words a person is meant to read live on the STATUS surface,
  // where the author opted into them by naming a `message`.
  'stream.tool_progress': 'The `{{toolName}}` tool reported progress while it was still running.',

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

  // Turn-start routing cascade (SG-C, 9.17.0) — one verdict per turn on
  // cascade graphs, keyed by the tier that decided. The numbers (scores,
  // runner-up gap, thresholds) stay on the event payload for richer consumers;
  // this prose says who decided and where the turn starts.
  'skill.turn_routed.continuity':
    '{{appName}} picked up where the conversation left off — still in `{{to}}`.',
  // Near-tie hold (9.17.0): tier 2 ran but did not clear the margin, so the
  // incumbent kept the turn. The two closest relevance shares ride the prose —
  // the ONE case where the verdict is only honest with its numbers.
  'skill.turn_routed.continuity.nearTie':
    'Near-tie between `{{tieA}}` ({{tieAShare}}) and `{{tieB}}` ({{tieBShare}}) — ' +
    '{{appName}} stayed put, continuing in `{{to}}`.',
  'skill.turn_routed.intent':
    'The new message decisively matched `{{to}}`{{scoreClause}}{{scorerClause}}, so the turn starts there.',
  // Pre-rendered into {{scoreClause}} only when the event carries `scores` —
  // an event without the ranked list renders the sentence without numbers.
  'skill.turn_routed.intent.scored': ' — scored {{topScore}} vs {{runnerUpScore}} runner-up',
  'skill.turn_routed.intent.scoredSolo': ' — scored {{topScore}}',
  'skill.turn_routed.entry': 'A declared start rule routed this turn to `{{to}}`.',
  // The same verdict, with its EVIDENCE (9.28.0): a DATA matcher (regex /
  // keywords / all) knows the text that made it true, so the sentence quotes
  // the user's own words instead of asserting "a rule matched". Rendered ONLY
  // when the event carries `witness` — a `when` predicate is opaque code and
  // keeps the sentence above, byte-for-byte. Shared with `context.entry_witness`
  // (the same route, seen from the hop): see ENTRY_WITNESS_LINE.
  'skill.turn_routed.entry.witness': ENTRY_WITNESS_LINE,
  'skill.turn_routed.menu':
    'No declared intent clearly claimed this message — {{appName}} was offered ' +
    '{{offeredCount}} option{{offeredPlural}}{{stayClause}} and chooses for itself.',
  'skill.turn_routed.dropped':
    'The conversation remembered being in `{{droppedId}}`, but this graph no longer has ' +
    'it — started fresh.',
  'skill.turn_routed.none': 'The turn-start router decided nothing — the turn proceeds as-is.',
  // `by: 'none'` WITH a recorded offer = the rails posture: the menu is on the
  // record but the model is never allowed to answer it, so the turn ran on the
  // base prompt. WHY it ended in a menu is stated only when the event carries
  // the evidence (`selectCommentaryKey` branches on decisive/scores/floor):
  //   • near-tie — intent DID match, more than once, too closely to call;
  //     `offered` is the tied set;
  //   • unmatched — nothing cleared the floor; `offered` is the FULL menu,
  //     so "close candidates" would be a lie there;
  //   • no numbers → the posture-only sentence claims no reason at all.
  'skill.turn_routed.none.rails':
    'Routing ended in a menu, but this graph does not let the model route — the turn ran ' +
    'on the base prompt. On the record: {{candidates}}.',
  'skill.turn_routed.none.rails.nearTie':
    'This message matched {{candidates}} too closely to call, and this graph does not let ' +
    'the model break the tie — the turn ran on the base prompt.',
  'skill.turn_routed.none.rails.unmatched':
    'No start rule or intent matched this message strongly enough, and this graph does not ' +
    'let the model route — the turn ran on the base prompt. The full menu stayed on the ' +
    'record: {{candidates}}.',
  // The tier-3 decider resolved the menu out-of-band (9.19.0). A 'stay'
  // verdict lands under the continuity key — the event's `decider` field
  // still says who answered.
  'skill.turn_routed.decider':
    'A dedicated decider model ({{deciderModel}}) read the menu and chose `{{to}}`.',

  // Escalate-on-evidence (9.19.0): the declared refusal threshold tripped
  // and the rest of the turn runs on the bigger brain. Once per turn.
  // The count is pre-pluralized (`refusalPlural`) — one refusal is a real
  // configuration (`afterRefusals: 1`), and "1 refused routing attempts" is
  // the kind of small wrongness that makes a reader distrust the rest.
  'skill.escalated':
    'After {{refusals}} refused routing attempt{{refusalPlural}}, the rest of the turn ' +
    'escalated from {{fromModel}} to {{toModel}}.',

  // Typed tool effects (9.19.0) — the effects channel's own prose, keyed by
  // kind + outcome. A refusal names itself teaching; the full sentence rides
  // the event payload (`refusalReason`) for richer consumers.
  // `reason` (the proposal's own words) and `refusalReason` (the teaching
  // sentence) are both OPTIONAL on the payload, so both ride pre-rendered
  // clauses. Through 9.26.0 the accepted line spelled the reason inline and an
  // effect that carried none rendered a pair of empty quotes — the sentence
  // claiming words that were never spoken.
  'tools.effect.transition.accepted':
    '`{{toolName}}` proposed moving to the `{{targetSkillId}}` skill{{reasonClause}} and ' +
    'the graph accepted it.',
  'tools.effect.transition.refused':
    '`{{toolName}}` proposed moving to `{{targetSkillId}}` and the graph refused ' +
    'it{{refusalClause}} — the teaching refusal is on the record.',
  'tools.effect.transition.superseded':
    '`{{toolName}}` proposed moving to `{{targetSkillId}}`, but an earlier proposal in the ' +
    'same batch had already won the move.',
  'tools.effect.instruction.accepted':
    '`{{toolName}}` pushed the `{{instructionId}}` instruction into the coming ' +
    'iteration(s) ({{deliveryLease}} lease).',
  'tools.effect.instruction.refused':
    '`{{toolName}}` asked to push the `{{instructionId}}` instruction and was ' +
    'refused{{refusalClause}} — the teaching refusal is on the record.',
  'tools.effect.reason': ' (“{{reason}}”)',
  'tools.effect.refusalReason': ' (“{{refusalReason}}”)',

  // A tool's result was too big to hand back (9.20.0). The oversized payload
  // entered no channel at all — not history, not the event — so the prose can
  // only say HOW BIG it was and what the model was told to do about it. The
  // size is in CHARACTERS because that is what the ceiling counts.
  'tools.result_refused':
    '`{{toolName}}` returned more than it is allowed to hand back ({{size}}, against a limit ' +
    'of {{limit}}) — the model got no data, only a note on how to ask for less{{narrowClause}}.',
  'tools.result_refused.narrowOne': ' (narrowing by `{{narrowBy}}` would help)',
  'tools.result_refused.narrowMany': ' (narrowing by {{narrowBy}} would help)',

  // The nudge moment (9.26.0): same call, same answer, and the model was told
  // so in a note appended to the result. Nothing was refused and nothing was
  // withheld — the prose must not imply either. The fingerprints that prove
  // sameness are digests, and digests are DETAILS, never prose.
  'tools.repeated_call':
    '`{{toolName}}` was called with the same inputs and gave back the same answer as ' +
    'before — that makes {{occurrences}} identical calls this turn, and the model was told so.',
  // The arguments-only variant (9.62.0): this tool declared `repeatedWhen:
  // 'arguments'`, so the match was on the request alone — the sentence must
  // not claim the ANSWER matched too, because for a tool like this it may
  // well not have (a screen tool's version stamp, a timestamp, a cursor).
  'tools.repeated_call.argsOnly':
    '`{{toolName}}` was called with the same arguments as before — this tool does not ' +
    'compare its result — that makes {{occurrences}} identical calls this turn, and the ' +
    'model was told so.',

  // artifacts.* — the claim-check lifecycle (9.21.0–9.23.0). One law runs
  // through every line here: META ONLY. Sizes are humanized ("41.2 KB"), kinds
  // and labels are the consumer's own vocabulary, and the payload itself is
  // never in the sentence — nor is the ref, which is an identifier for the
  // DETAILS panel, not something a reader reads.
  'artifacts.minted':
    '`{{tool}}` checked {{subject}} into the store{{derivedClause}} — the model got a ' +
    'one-line ticket, not the data.',
  'artifacts.minted.subject.labeled': '“{{label}}” ({{kind}}, {{size}})',
  'artifacts.minted.subject.plain': 'a {{kind}} artifact ({{size}})',
  'artifacts.minted.derived': ', built from {{parentCount}} earlier artifact{{parentPlural}}',

  'artifacts.presented':
    'The model handed {{subject}} to the screen to show as `{{as}}` — the screen fetches ' +
    'the data itself.',
  'artifacts.presented.subject.labeled': '“{{label}}” ({{kind}}, {{size}})',
  'artifacts.presented.subject.plain': 'a {{kind}} artifact ({{size}})',

  // `head` describes without paying for the payload; `get` pays. That is the
  // render-by-ref decision, so it gets two sentences rather than one hedge.
  'artifacts.resolved.head':
    '{{actor}} looked up what a ticket describes — a {{kind}} artifact ({{size}}) — ' +
    'without reading the data.',
  'artifacts.resolved.get':
    '{{actor}} redeemed a ticket and read the {{kind}} artifact ({{size}}).',

  // `tool` is absent when the hop came through the hosting door instead of a
  // tool call (9.23.0) — a screen redeeming a ref over the wire under its own
  // identity. Naming a phantom tool there would be a lie a dashboard groups by.
  'artifacts.actor.tool': '`{{tool}}`',
  'artifacts.actor.host': 'The app itself (not a tool)',

  'artifacts.refused': '{{actor}} was refused {{opPhrase}} — {{reasonPhrase}}.',
  // `op: 'dispatch'` is the framework's own door: the tool never ran, because
  // the data it declared it wanted could not be delivered.
  'artifacts.refused.dispatch':
    '`{{tool}}` never ran — the artifact it asked for could not be delivered ' +
    '({{reasonPhrase}}), and the model was told what it can ask for instead.',

  'artifacts.expired':
    'A {{kind}} artifact ({{size}}) left the store {{reasonPhrase}}{{noticedClause}} — a ' +
    'ticket for it no longer resolves.',
  'artifacts.expired.noticed': ', noticed while `{{tool}}` was checking something in',

  // One parallel tool batch, N matched edges, different targets (9.16.0).
  // Call order decides; the suppressed hop(s) stay on the record — this line is
  // that record's prose. Grammar branches (was/were) are pre-rendered clauses so
  // the key itself never has to split, and the head COUNTS the results
  // (winner + losers) instead of hard-coding "Two" — a 3-result batch says so.
  'skill.route_conflict':
    '{{conflictCount}} tool results wanted different next skills — `{{winnerTool}}` → `{{winnerTarget}}` ' +
    'won (first in the batch){{losersClause}}.',
  'skill.route_conflict.suppressedOne': '; {{losers}} was suppressed and is on the record',
  'skill.route_conflict.suppressedMany': '; {{losers}} were suppressed and are on the record',

  // Posture refusals on `skill.rejected` (SG-C `strictness`, 9.17.0). ONLY the
  // posture cases get prose here — a plain reachability rejection keeps its
  // existing fall-through (the default humanizer renders the raw event, never
  // drops it), so nothing that narrated before reads differently now.
  'skill.rejected.guard':
    'The model asked for the `{{requestedId}}` skill, but that choice was not on the menu ' +
    'it was offered — {{appName}} refused the jump and re-prompted with the allowed options.',
  'skill.rejected.rails':
    'The model asked for the `{{requestedId}}` skill, but this graph does not let the model ' +
    'route — {{appName}} refused the jump; start rules and declared routes decide moves.',

  // The cursor moved by MODEL PICK and the event says how the offer went
  // (`cursorMove.offered` / `cursorMove.declinedOffer`, 9.17.0) — assist-posture
  // divergence as data. Every clause renders only from fields the event carries:
  // no menu on the event → no menu in the sentence.
  'context.model_pick':
    'The model chose the `{{to}}` skill{{menuClause}}{{offMenuClause}}{{stayClause}}.',
  'context.model_pick.menu': ' from the {{offeredCount}}-option menu it was offered',
  'context.model_pick.offMenu':
    ' — a pick that was not on the menu it was offered; the divergence is on the record',
  'context.model_pick.stay': '; staying put was offered and declined',

  // The cursor moved by a declared START RULE and the hop carries the words that
  // made the rule true (`cursorMove.witness`, 9.28.0). A graph WITHOUT a cascade
  // never fires `skill.turn_routed`, so this record is the only place that
  // evidence exists — and the sentence is the cascade's, verbatim (one fact, one
  // sentence, whichever record carried it). No witness on the hop → the routed
  // line below, byte-for-byte.
  'context.entry_witness': ENTRY_WITNESS_LINE,

  // Skill-GRAPH routing (proposal 002): a decision tree or declared edge picked a
  // skill this turn. Narrates WHICH skill + WHY (the matched decision) + what it
  // unlocked. The full decision path + tool list rides the `context.evaluated`
  // event payload (`routing`) for the lens; this prose stays concise.
  'context.routed':
    '{{appName}} routed to the `{{skillId}}` skill{{matchClause}} — {{toolClause}} now available.',
  'context.routed.matched': ' (matched “{{matchedLabel}}”)',
  'context.routed.default': ' (no specific intent — default)',

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

  // ONE key, and an `outcome` clause the extractor pre-renders — because the
  // sentence has to branch and the key must not. Through 8.13.0 this said
  // "hit a cost limit and stopped", which was false for every agent that had
  // one: a `costBudget` warned and the run carried on. Splitting the key into
  // `.warn` / `.halt` would have read better and silently orphaned every
  // consumer who had overridden `cost.limit_hit`.
  'cost.limit_hit':
    '{{appName}} reached its {{limitNoun}} ({{actual}} of {{limit}}) — {{outcome}}.',
  'cost.limit_hit.stopped': 'the run stopped there',
  'cost.limit_hit.continued': 'the run carried on, because this limit only warns',
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
    case 'agentfootprint.stream.tool_progress':
      return 'stream.tool_progress';
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

    case 'agentfootprint.skill.turn_routed': {
      // A dropped resume outranks the (cold) verdict it forced — the reader's
      // question is "why did my conversation forget where it was?".
      if (event.payload.droppedResume) return 'skill.turn_routed.dropped';
      switch (event.payload.by as string) {
        case 'continuity':
          // A near-tie hold is only a hold because the numbers were close —
          // when the event carries them, the prose says so.
          return event.payload.decisive === false && (event.payload.scores?.length ?? 0) >= 2
            ? 'skill.turn_routed.continuity.nearTie'
            : 'skill.turn_routed.continuity';
        case 'intent':
          return 'skill.turn_routed.intent';
        case 'entry':
        case 'rule': // era tolerance — 'rule' is the same tier-1 verdict, older/newer vocabulary
          // Evidence when the tier-1 matcher was DATA and recorded what it
          // matched; today's sentence when it was a `when` predicate.
          return typeof event.payload.witness?.text === 'string' &&
            event.payload.witness.text.length > 0
            ? 'skill.turn_routed.entry.witness'
            : 'skill.turn_routed.entry';
        case 'decider': // the tier-3 out-of-band resolver (9.19.0)
          return 'skill.turn_routed.decider';
        case 'menu':
        case 'model-pick': // era tolerance — a menu the model resolves
          return 'skill.turn_routed.menu';
        default: {
          // `by: 'none'` with the offer on the record = the rails posture.
          // WHY the cascade ended in a menu is stated only when the event
          // carries the evidence: `decisive: false` with a floor-clearing top
          // score is a near-tie (intent DID match — more than once); a top
          // score at/below the recorded floor is honestly unmatched (the
          // offer is the FULL menu). No numbers → the posture-only sentence.
          const p = event.payload;
          if ((p.offered?.length ?? 0) === 0) return 'skill.turn_routed.none';
          const top = p.scores?.[0]?.score;
          const floor = p.policy?.floor;
          const cleared =
            top !== undefined && Number.isFinite(top) && (floor === undefined || top > floor);
          if (p.decisive === false && (p.scores?.length ?? 0) >= 2 && cleared)
            return 'skill.turn_routed.none.rails.nearTie';
          if (top !== undefined && !cleared) return 'skill.turn_routed.none.rails.unmatched';
          return 'skill.turn_routed.none.rails';
        }
      }
    }

    case 'agentfootprint.skill.route_conflict':
      return 'skill.route_conflict';

    case 'agentfootprint.skill.escalated':
      return 'skill.escalated';

    case 'agentfootprint.tools.effect': {
      // Kind + outcome pick the sentence; 'superseded' exists only for
      // transitions (an instruction lease is never outrun).
      const p = event.payload;
      const family = p.kind === 'propose-transition' ? 'transition' : 'instruction';
      const outcome = p.outcome === 'superseded' ? 'superseded' : p.outcome;
      return `tools.effect.${family}.${outcome}`;
    }

    case 'agentfootprint.tools.result_refused':
      return 'tools.result_refused';

    case 'agentfootprint.tools.repeated_call':
      // Same event, two truths it can tell (9.62.0): the default match
      // compared the result too, so the sentence can say "gave back the
      // same answer"; an arguments-only match (the tool declared
      // `repeatedWhen: 'arguments'`) must not claim that, because it never
      // looked.
      return event.payload.mode === 'arguments'
        ? 'tools.repeated_call.argsOnly'
        : 'tools.repeated_call';

    case 'agentfootprint.artifacts.minted':
      return 'artifacts.minted';
    case 'agentfootprint.artifacts.presented':
      return 'artifacts.presented';
    case 'agentfootprint.artifacts.resolved':
      // `head` and `get` are different decisions, not a detail of one event:
      // one describes the parcel, the other pays for it.
      return event.payload.via === 'get' ? 'artifacts.resolved.get' : 'artifacts.resolved.head';
    case 'agentfootprint.artifacts.expired':
      return 'artifacts.expired';
    case 'agentfootprint.artifacts.refused':
      // The dispatch door has its own sentence — but only when the event names
      // the tool that never ran. Without it, the generic refusal is the honest
      // line (it says who/what without inventing an actor).
      return event.payload.op === 'dispatch' && event.payload.tool
        ? 'artifacts.refused.dispatch'
        : 'artifacts.refused';

    case 'agentfootprint.skill.rejected':
      // Posture refusals (SG-C) narrate; the plain reachability rejection keeps
      // its pre-9.17 fall-through to the caller's default humanizer (raw render,
      // never dropped).
      switch (event.payload.posture) {
        case 'guard':
          return 'skill.rejected.guard';
        case 'rails':
          return 'skill.rejected.rails';
        default:
          return undefined;
      }

    case 'agentfootprint.context.evaluated': {
      // A model pick that resolved a turn-start menu (or diverged from it) is
      // the iteration's routing verdict — it fires on exactly ONE iteration
      // (`cursorMove.offered` / `declinedOffer` are stamped only then, 9.17.0)
      // and outranks the generic routed line for that iteration. Old-era events
      // never carry the decorations, so they keep reading exactly as before.
      const cm = event.payload.cursorMove;
      if (
        cm?.by === 'model-pick' &&
        cm.to &&
        ((cm.offered?.length ?? 0) > 0 || cm.declinedOffer === true)
      ) {
        return 'context.model_pick';
      }
      // A tier-1 DATA-matcher hop that carries its own evidence (9.28.0). On a
      // rules-only graph (no cascade) NOTHING fires `skill.turn_routed`, so this
      // is the only record that can say WHY the turn started where it did — and
      // it says it in the cascade's own words. `'rule'` is era tolerance, the
      // same tolerance the `turn_routed` switch keeps. An absent or empty
      // witness falls through to the routed line unchanged.
      const witnessedTo = cm?.to;
      const witnessText = cm?.witness?.text;
      if (
        (cm?.by === 'entry' || cm?.by === 'rule') &&
        witnessedTo &&
        typeof witnessText === 'string' &&
        witnessText.length > 0
      ) {
        return 'context.entry_witness';
      }
      // Narrate ONLY when a skillGraph() routed a skill this turn (decision tree
      // or declared edge). Otherwise stay silent — bare injection evaluation is
      // plumbing, not pedagogy (matches the slot-mechanics skips below).
      return event.payload.routing && event.payload.routing.length > 0 ? 'context.routed' : null;
    }

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
 * Who redeemed / was refused at an artifact door. A tool names itself; the
 * hosting door (9.23.0 — a screen resolving a ref over the wire under its own
 * identity) has no tool name, and gets a sentence that says exactly that
 * instead of a blank or an invented actor.
 */
function artifactActor(tool: string | undefined, templates: CommentaryTemplates): string {
  const named = (tool ?? '').trim();
  return named
    ? renderCommentary(templates['artifacts.actor.tool'] ?? '', { tool: named })
    : templates['artifacts.actor.host'] ?? '';
}

/** Count words for the `route_conflict` head (index = the count). Beyond the
 *  list the digit itself reads fine ("7 tool results wanted…"). */
const CONFLICT_COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'] as const;

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

    case 'agentfootprint.stream.tool_progress':
      return { ...base, toolName: event.payload.toolName };

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
      // CompositionExitPayload carries `name` (since v2.14.5);
      // fall back to `id` for older emitters that didn't pass name.
      return {
        ...base,
        name: p.name ?? p.id,
        kind: p.kind,
        status: p.status,
        durationMs: String(p.durationMs ?? 0),
      };
    }

    case 'agentfootprint.context.injected': {
      const p = event.payload;
      // Feed the injection's content summary into `descClause` so an
      // instruction/rule line reads "added a rule: <summary>" instead of an
      // empty ": .". (The instructions/onToolReturn/alwaysOn templates all use
      // {{descClause}}.) Empty summary → empty clause, handled by the templates.
      return { ...base, descClause: (p.contentSummary ?? '').trim() };
    }

    case 'agentfootprint.context.evaluated': {
      // Narrate the first skill-graph route (a decision tree activates exactly
      // one leaf). The matched predicate = the deciding `yes` on the path; for an
      // all-`no` path (the default leaf) there's none → "default" clause. The
      // full path + every route ride the event payload for richer consumers.
      // Model-pick decoration vars (`context.model_pick`) — computed whenever
      // the event carries them; harmless extras for the `context.routed` key.
      const cm = event.payload.cursorMove;
      const pickVars: Record<string, string> = {};
      if (cm?.by === 'model-pick' && cm.to) {
        const offeredCount = cm.offered?.length ?? 0;
        pickVars.to = cm.to;
        pickVars.menuClause =
          cm.declinedOffer !== true && offeredCount > 0
            ? renderCommentary(templates['context.model_pick.menu'] ?? '', {
                offeredCount: String(offeredCount),
              })
            : '';
        pickVars.offMenuClause =
          cm.declinedOffer === true ? templates['context.model_pick.offMenu'] ?? '' : '';
        // "Staying put was offered and declined" is derivable, not invented:
        // the current cursor was ON the menu and the accepted pick left it.
        pickVars.stayClause =
          cm.declinedOffer !== true &&
          cm.from !== undefined &&
          cm.to !== cm.from &&
          (cm.offered ?? []).includes(cm.from)
            ? templates['context.model_pick.stay'] ?? ''
            : '';
      }
      // Start-rule witness vars (`context.entry_witness`) — the hop's own
      // evidence, computed on the same terms the key selection uses. Harmless
      // extras for every other key: an absent witness contributes nothing, so
      // the routed line renders exactly as it always did.
      const witnessedTo = cm?.to;
      const witnessText = cm?.witness?.text ?? '';
      if ((cm?.by === 'entry' || cm?.by === 'rule') && witnessedTo && witnessText.length > 0) {
        pickVars.to = witnessedTo;
        pickVars.witness = witnessText;
      }

      const r = event.payload.routing?.[0];
      if (!r) return { ...base, ...pickVars };
      const toolCount = r.tools?.length ?? 0;
      const toolClause =
        toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? '' : 's'}` : 'no new tools';
      const matchedLabel = r.path?.find((s) => s.branch === 'yes')?.label ?? r.label;
      const matchClause = matchedLabel
        ? renderCommentary(templates['context.routed.matched'] ?? '', { matchedLabel })
        : r.via === 'tree'
        ? templates['context.routed.default'] ?? ''
        : '';
      return { ...base, skillId: r.injectionId, toolClause, matchClause, ...pickVars };
    }

    case 'agentfootprint.skill.turn_routed': {
      const p = event.payload;
      const offeredCount = p.offered?.length ?? 0;
      // The verdict's numbers, rendered ONLY when the event carries them. Raw
      // scores read to 2 decimals; `relevance` is the full-softmax share, so it
      // reads as a percentage. An event without `scores` renders no numbers.
      const scores = p.scores ?? [];
      const fmtScore = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      const fmtShare = (r: number): string => `${Math.round(r * 100)}%`;
      const scoreClause =
        scores.length >= 2
          ? renderCommentary(templates['skill.turn_routed.intent.scored'] ?? '', {
              topScore: fmtScore(scores[0].score),
              runnerUpScore: fmtScore(scores[1].score),
            })
          : scores.length === 1
          ? renderCommentary(templates['skill.turn_routed.intent.scoredSolo'] ?? '', {
              topScore: fmtScore(scores[0].score),
            })
          : '';
      return {
        ...base,
        // Continuity verdicts hold the inherited cursor — when an emitter left
        // `to` off (the cursor didn't move), `from` names where the turn stays.
        to: p.to ?? (p.by === 'continuity' ? p.from ?? '' : ''),
        from: p.from ?? '',
        droppedId: p.droppedResume?.id ?? '',
        scorerClause: p.scorer !== undefined ? ` (judged by the '${p.scorer}' scorer)` : '',
        offeredCount: String(offeredCount),
        offeredPlural: offeredCount === 1 ? '' : 's',
        stayClause: p.stayOffered === true ? ' (including staying put)' : '',
        scoreClause,
        tieA: scores[0]?.id ?? '',
        tieAShare: scores[0] ? fmtShare(scores[0].relevance) : '',
        tieB: scores[1]?.id ?? '',
        tieBShare: scores[1] ? fmtShare(scores[1].relevance) : '',
        candidates: (p.offered ?? []).map((id) => `\`${id}\``).join(', '),
        // The tier-1 matcher's evidence — already bounded + whitespace-collapsed
        // at capture, so the sentence quotes it verbatim.
        witness: p.witness?.text ?? '',
        // The tier-3 decider's identity (9.19.0) — model when named, else
        // the provider (a decider always has at least that).
        deciderModel: p.decider?.model ?? p.decider?.provider ?? '',
      };
    }

    case 'agentfootprint.skill.escalated': {
      const p = event.payload;
      return {
        ...base,
        refusals: String(p.refusals),
        refusalPlural: p.refusals === 1 ? '' : 's',
        fromModel: p.from.model,
        // The escalation brain may inherit its model down the chain (same
        // provider) — the provider name is then the honest identity.
        toModel: p.to.model ?? p.to.provider,
      };
    }

    case 'agentfootprint.tools.effect': {
      const p = event.payload;
      // Both reasons are optional on the payload, so both are clauses: an
      // effect that carried no words says nothing in their place.
      const reason = (p.reason ?? '').trim();
      const refusalReason = (p.refusalReason ?? '').trim();
      return {
        ...base,
        toolName: p.toolName,
        targetSkillId: p.targetSkillId ?? '',
        reason,
        instructionId: p.instructionId ?? '',
        deliveryLease: p.deliveryLease ?? '',
        reasonClause: reason
          ? renderCommentary(templates['tools.effect.reason'] ?? '', { reason })
          : '',
        refusalClause: refusalReason
          ? renderCommentary(templates['tools.effect.refusalReason'] ?? '', { refusalReason })
          : '',
      };
    }

    case 'agentfootprint.tools.result_refused': {
      const p = event.payload;
      const narrowBy = p.narrowBy ?? [];
      const narrowClause =
        narrowBy.length === 0
          ? ''
          : narrowBy.length === 1
          ? renderCommentary(templates['tools.result_refused.narrowOne'] ?? '', {
              narrowBy: narrowBy[0],
            })
          : renderCommentary(templates['tools.result_refused.narrowMany'] ?? '', {
              narrowBy: narrowBy.map((n) => `\`${n}\``).join(' or '),
            });
      return {
        ...base,
        toolName: p.toolName,
        size: humanizeChars(p.sizeChars),
        limit: humanizeChars(p.maxChars),
        narrowClause,
      };
    }

    case 'agentfootprint.tools.repeated_call': {
      const p = event.payload;
      // The fingerprints stay off the prose deliberately — they answer "is this
      // the same?" and a reader already has that answer in the sentence.
      return { ...base, toolName: p.toolName, occurrences: String(p.occurrences) };
    }

    case 'agentfootprint.artifacts.minted': {
      const p = event.payload;
      const label = (p.label ?? '').trim();
      const size = humanizeBytes(p.bytes);
      const subject = label
        ? renderCommentary(templates['artifacts.minted.subject.labeled'] ?? '', {
            label,
            kind: p.kind,
            size,
          })
        : renderCommentary(templates['artifacts.minted.subject.plain'] ?? '', {
            kind: p.kind,
            size,
          });
      const parentCount = p.parentRefs?.length ?? 0;
      return {
        ...base,
        tool: p.tool,
        kind: p.kind,
        size,
        subject,
        derivedClause:
          parentCount > 0
            ? renderCommentary(templates['artifacts.minted.derived'] ?? '', {
                parentCount: String(parentCount),
                parentPlural: parentCount === 1 ? '' : 's',
              })
            : '',
      };
    }

    case 'agentfootprint.artifacts.presented': {
      const p = event.payload;
      const label = (p.snapshot.label ?? '').trim();
      const size = humanizeBytes(p.snapshot.bytes);
      const subject = label
        ? renderCommentary(templates['artifacts.presented.subject.labeled'] ?? '', {
            label,
            kind: p.snapshot.kind,
            size,
          })
        : renderCommentary(templates['artifacts.presented.subject.plain'] ?? '', {
            kind: p.snapshot.kind,
            size,
          });
      // `as` is the model's own consumer vocabulary, stored as data — rendered
      // exactly as spoken, never normalized into a word we prefer.
      return { ...base, subject, as: p.as, kind: p.snapshot.kind, size };
    }

    case 'agentfootprint.artifacts.resolved': {
      const p = event.payload;
      return {
        ...base,
        actor: artifactActor(p.tool, templates),
        kind: p.kind,
        size: humanizeBytes(p.bytes),
      };
    }

    case 'agentfootprint.artifacts.refused': {
      const p = event.payload;
      // `detail` (the thrown refusal sentence) stays out of prose on purpose:
      // it is an error string, and error strings are the one place a secret has
      // ever ridden into a log. The typed `reason` says enough to act on.
      return {
        ...base,
        actor: artifactActor(p.tool, templates),
        tool: p.tool ?? '',
        opPhrase: phraseFor(ARTIFACT_OP_PHRASES, p.op, 'an artifact request'),
        reasonPhrase: phraseFor(
          ARTIFACT_REFUSAL_PHRASES,
          p.reason,
          'the store did not say why in words this build knows',
        ),
      };
    }

    case 'agentfootprint.artifacts.expired': {
      const p = event.payload;
      const tool = (p.tool ?? '').trim();
      return {
        ...base,
        kind: p.kind,
        size: humanizeBytes(p.bytes),
        reasonPhrase: phraseFor(
          ARTIFACT_SWEEP_PHRASES,
          p.reason,
          'for a reason this build does not have words for',
        ),
        noticedClause: tool
          ? renderCommentary(templates['artifacts.expired.noticed'] ?? '', { tool })
          : '',
      };
    }

    case 'agentfootprint.skill.route_conflict': {
      const p = event.payload;
      const losers = p.losers ?? [];
      const loserList = losers.map((l) => `\`${l.toolName}\` → \`${l.target}\``).join(' and ');
      // The head counts EVERY result in the conflict (winner + losers) — a
      // 3-result batch says "Three", never a hard-coded "Two". An event that
      // lists no losers can only honestly say "Multiple" (a conflict implies
      // more than one result by definition; the emitter always lists them).
      const count = losers.length + 1;
      const conflictCount =
        losers.length === 0
          ? 'Multiple'
          : count < CONFLICT_COUNT_WORDS.length
          ? CONFLICT_COUNT_WORDS[count]
          : String(count);
      // Pre-rendered was/were clause so the outer key never has to split.
      const losersClause =
        losers.length === 0
          ? ''
          : renderCommentary(
              templates[
                losers.length === 1
                  ? 'skill.route_conflict.suppressedOne'
                  : 'skill.route_conflict.suppressedMany'
              ] ?? '',
              { losers: loserList },
            );
      return {
        ...base,
        conflictCount,
        winnerTool: p.winner.toolName,
        winnerTarget: p.winner.target,
        losersClause,
      };
    }

    case 'agentfootprint.skill.rejected':
      return {
        ...base,
        requestedId: event.payload.requestedId,
        currentSkillId: event.payload.currentSkillId ?? '',
      };

    case 'agentfootprint.cost.limit_hit': {
      const p = event.payload;
      // The sentence has to say whether the run STOPPED, and only `action`
      // knows: a `costBudget` may warn or halt, and `max_iterations` always
      // stops. Pre-rendered here as a clause so the template stays one flat
      // key that a consumer's existing override still resolves.
      const outcome =
        p.action === 'abort'
          ? templates['cost.limit_hit.stopped'] ?? ''
          : templates['cost.limit_hit.continued'] ?? '';
      const limitNoun =
        p.kind === 'max_iterations'
          ? 'iteration limit'
          : p.kind === 'max_cost'
          ? 'cost limit'
          : p.kind === 'max_tokens'
          ? 'token limit'
          : 'time limit';
      return {
        ...base,
        limitNoun,
        limit: String(p.limit),
        actual: String(p.actual),
        outcome,
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
  'sf-cache', // v2.14 — cache decision wrapper (and its inner stages)
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
