import { dispositionTemplates } from './dispositions.js';
import type { CommentaryTemplates } from './types.js';

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
  'skill.rejected': 'The requested skill was refused.',
  ...dispositionTemplates,
  'event.unknown': 'An additional event was recorded.',
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

  // A call the paused batch never dispatched (9.113.0) — its `tool_start`
  // carries `notDispatched`. A NEW key, not a split of `stream.tool_start`:
  // every bracket that routed there before still does, so no override goes
  // unconsulted (rule 5), and the shipped sentence ("called the tool") would
  // be false here in any locale. One line per fact: its `tool_end` is skipped.
  'stream.tool_start.notDispatched':
    '{{agentName}} did not call the `{{toolName}}` tool. The LLM asked for it together with ' +
    '`{{pausedToolName}}`, and the run paused at `{{pausedToolName}}` before reaching it.',

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
  // No tool minted it — the run's own recording, or a host filing for its turn
  // (`HostReply.turnArtifacts`). The same actor wording the resolved/refused
  // lines use, and no claim about the model: no model was handed this ticket.
  'artifacts.minted.host': '{{actor}} checked {{subject}} into the store{{derivedClause}}.',
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

  // The app's own filing for a turn (`HostReply.turnArtifacts`) did not go
  // cleanly. Class only in the data; the sentence says what happened and that
  // the person's reply was unaffected.
  'artifacts.hand_over_failed':
    'The app’s own filing for a turn {{causePhrase}}{{opClause}} — the reply was delivered ' +
    'regardless.',
  'artifacts.hand_over_failed.op': ' ({{opPhrase}})',

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
