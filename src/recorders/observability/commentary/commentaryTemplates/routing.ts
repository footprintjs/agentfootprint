import { eventDispositions } from './dispositions.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';

/**
 * Pick the template key for an event. Branches encoded in the key
 * suffix (no conditional logic in the templates themselves).
 *
 *   `null`      → explicit skip (baseline injections, low-signal events)
 *   `undefined` → fall through to caller's default humanizer
 *   `string`    → render `templates[key]` with `extractCommentaryVars`
 */
function routedCommentaryKey(event: AgentfootprintEvent): string | null | undefined {
  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return 'agent.turn_start';
    case 'agentfootprint.agent.turn_end':
      return null;

    case 'agentfootprint.stream.llm_start':
      return event.payload.iteration === 1 ? 'stream.llm_start.iter1' : 'stream.llm_start.iterN';

    case 'agentfootprint.stream.llm_end':
      return event.payload.toolCallCount > 0 ? 'stream.llm_end.tools' : 'stream.llm_end.terminal';

    // A bracket carrying `notDispatched` (9.113.0) is a call that never ran:
    // its start gets the settled key, its end is skipped (the start said it).
    case 'agentfootprint.stream.tool_start':
      return event.payload.notDispatched !== undefined
        ? 'stream.tool_start.notDispatched'
        : 'stream.tool_start';
    case 'agentfootprint.stream.tool_progress':
      return 'stream.tool_progress';
    case 'agentfootprint.stream.tool_end':
      return event.payload.notDispatched !== undefined ? null : 'stream.tool_end';

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
      // A mint no tool made has its own sentence — the tool one would print
      // an empty tool name and credit a model with a ticket it never got.
      return event.payload.tool ? 'artifacts.minted' : 'artifacts.minted.host';
    case 'agentfootprint.artifacts.presented':
      return 'artifacts.presented';
    case 'agentfootprint.artifacts.resolved':
      // `head` and `get` are different decisions, not a detail of one event:
      // one describes the parcel, the other pays for it.
      return event.payload.via === 'get' ? 'artifacts.resolved.get' : 'artifacts.resolved.head';
    case 'agentfootprint.artifacts.expired':
      return 'artifacts.expired';
    case 'agentfootprint.artifacts.hand_over_failed':
      return 'artifacts.hand_over_failed';
    case 'agentfootprint.artifacts.refused':
      // The dispatch door has its own sentence — but only when the event names
      // the tool that never ran. Without it, the generic refusal is the honest
      // line (it says who/what without inventing an actor).
      return event.payload.op === 'dispatch' && event.payload.tool
        ? 'artifacts.refused.dispatch'
        : 'artifacts.refused';

    case 'agentfootprint.skill.rejected':
      // Posture-specific keys stay stable. A plain reachability refusal gets
      // fixed prose too, so a consumer never needs a raw event fallback.
      switch (event.payload.posture) {
        case 'guard':
          return 'skill.rejected.guard';
        case 'rails':
          return 'skill.rejected.rails';
        default:
          return 'skill.rejected';
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

/** Every registered kind has prose or an explicit internal exclusion. */
export function selectCommentaryKey(event: AgentfootprintEvent): string | null | undefined {
  const key = routedCommentaryKey(event);
  if (key !== undefined) return key;
  const disposition = Object.hasOwn(eventDispositions, event.type)
    ? (eventDispositions as Readonly<Record<string, string | null>>)[event.type]
    : undefined;
  return disposition === null
    ? null
    : disposition === undefined
    ? 'event.unknown'
    : `event.${event.type}`;
}
