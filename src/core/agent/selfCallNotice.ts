/**
 * The answer a `read_skill` SELF-CALL gets back (9.84.0).
 *
 * A self-call is `read_skill("X")` from a cursor already standing on X. It used
 * to fall through the skill-graph gate's reachability arm — `makeReachableSkills`
 * filters the cursor out of its own successor set (a MOVE to where you already
 * are is not a move) and `openSkillIds()` excludes every graph-wired skill, so
 * the cursor's own id is in neither half of `hops ∪ open`. The model was told:
 *
 *     read_skill("X") is not reachable from here. Reachable skills: …
 *
 * while X's body was in its system prompt and X's tools were in that very call's
 * tool list. Read as a statement about AVAILABILITY — which is how a model reads
 * "not reachable" — that is a flat contradiction of the request it arrived in,
 * and the observed behaviour was to stop and answer that it could not help.
 *
 * ── THE LAW THIS FILE IS WRITTEN AGAINST ──────────────────────────────────
 *
 * A TOOL RESULT IS NOT READ ONCE. It is composed during iteration N, written
 * into `history`, and then read by the model on call N+1 AND ON EVERY CALL
 * AFTER IT for the rest of the turn — including the out-of-budget WRAP-UP,
 * which `callLLM` serves with an EMPTY tool list under a user message saying
 * "Do not request tools".
 *
 * The consequence is the whole design: NO COMPOSE-TIME CHECK CAN MAKE A
 * FORWARD-LOOKING SENTENCE SAFE. A budget test, a posture test, a cursor test
 * — each is true at the instant it runs and each is outlived by the sentence
 * it admitted. Three rounds of this file fixed one clause at a time and each
 * time a different clause was still false, because every one of them was a
 * PREDICTION and the fix was always a better prediction.
 *
 * So the notice makes no predictions at all. Every clause is a fact about ONE
 * already-finished event — the call the model made `read_skill` on — and every
 * clause is anchored to that call by name ("that call"), never by deixis ("the
 * call you just made", which denotes a different call each time it is re-read).
 * A past fact about a named call cannot be falsified by anything that happens
 * afterwards: not by the budget running out, not by a posture refusing a hop,
 * not by a sibling tool in the same batch moving the cursor.
 *
 * ── WHAT WAS DELETED, AND WHY THE NOTICE STILL DOES ITS JOB ───────────────
 *
 * Gone: the exhortation ("Go ahead and act on the request"), the move offer
 * ("read_skill MOVES you somewhere else — from here that would be: beta"), the
 * open-skill offer ("These activate without moving you: gamma"), and the
 * budget clause that was added to gate them. Each was false somewhere:
 *
 *   • the exhortation, on the wrap-up call, beside "Do not request tools";
 *   • the move offer, on the wrap-up call (a hop is a tool call), under
 *     `strictness: 'rails'` (every model hop refused) and under `'guard'` on a
 *     decisively-routed turn (every hop not on an outstanding menu refused) —
 *     where the sibling posture arm answers a taken-up offer with "read_skill
 *     here reaches only the open skills: gamma", contradicting the notice from
 *     the arm immediately above it, and spending escalation budget to do so;
 *   • the budget clause, because a budget read at compose time is a claim
 *     about a call that has not happened.
 *
 * The notice's JOB is to stop a model concluding its capability is gone. It
 * does that by stating what it held, not by promising what it may do: you were
 * standing in this skill, its instructions were in that call's prompt, its
 * tools were on that call's wire, and asking took nothing away. A model that
 * reads those four facts has no ground left for "I cannot help".
 *
 * The forward-looking half had a rightful owner all along, and it is not a
 * tool result: the `read_skill` DESCRIPTION is recomposed on every single call,
 * so it can safely speak in the present ("You are in 'beta'."), it is filtered
 * for per-role visibility at source, and it is absent from the wrap-up because
 * the whole tool list is. One owner for the present tense, one for the past,
 * and they can no longer disagree — which is the only property that survived
 * every round of this bug.
 */

import type { ActiveInjection } from '../../lib/injection-engine/types.js';
import type { LLMToolSchema } from '../../adapters/types.js';

/** What the current skill's tools did on the call the model made `read_skill` on. */
export interface SelfSkillTools {
  /** Every tool the skill declares — `[]` for a skill that declares none. */
  readonly declared: readonly string[];
  /** Those actually on that call's wire. A subset of `declared`. */
  readonly served: readonly string[];
}

/**
 * The skill's tools, as of the call the model just made — or `undefined` when
 * that cannot be established, which is not the same answer and must not be
 * reported as one.
 *
 * `undefined` means the notice says nothing about tools at all. It happens when
 * the tools slot composed no per-iteration list (`reactMode: 'classic'` caches
 * the slot, and `callLLM` falls back to its build-time schemas), or when the
 * cursor's skill is not in the active set. Silence is the only honest output
 * there: the alternative is a sentence naming tools the model may not have.
 *
 * The out-of-budget wrap-up is NOT one of these cases and must not be modelled
 * as one. Its empty tool list belongs to a LATER call; the wire read here is
 * always the one the model was really handed on the call being answered, and
 * the notice speaks of that call and only that call.
 */
export function selfSkillTools(
  skillId: string,
  activeInjections: readonly ActiveInjection[] | undefined,
  wire: readonly LLMToolSchema[] | undefined,
): SelfSkillTools | undefined {
  if (wire === undefined || activeInjections === undefined) return undefined;
  const mine = activeInjections.find((i) => i.id === skillId);
  if (mine === undefined) return undefined;
  const declared = (mine.inject.tools ?? []).map((t) => t.schema.name);
  const onWire = new Set(wire.map((s) => s.name));
  return { declared, served: declared.filter((n) => onWire.has(n)) };
}

/**
 * The self-call's tool result.
 *
 * NOT a refusal to the MODEL, and deliberately so. The gate's other two arms
 * refuse because the model asked for something it may not have; a self-call
 * asks for a body it already holds, and the useful reply is the fact — where
 * you stood, and what rode that call — not a decline. It is still counted as a
 * refusal by the ESCALATION BUDGET (`noteSkillRefusal`, beside the emit), and
 * those two facts do not fight: the budget is not measuring how the sentence
 * reads, it is measuring a model that keeps asking the graph where it is
 * instead of working, which is exactly the stuck run the budget escalates.
 *
 * It still OVERWRITES the tool's own result the way every other arm does,
 * because that overwrite is what puts the authoritative sentence in front of
 * the governance rules, the refusal cap and the after-tool moment, on both
 * channels, before the model reads anything.
 *
 * The one thing not overwritten is a BODY. The live case is `surfaceMode:
 * 'both'` — `'tool-only'` cannot arise here, because `skillBodyDelivery`
 * refuses it at BUILD time for anything but an `llm-activated` skill and only a
 * graph-wired skill can be the cursor. Under `'both'` the body is in the system
 * prompt AND rides the tool result, and the second copy is the whole point of
 * the mode: recency-first delivery, the body at the end of the window rather
 * than only at the top of the prompt. Dropping it here would quietly demote
 * `'both'` to `'system-prompt'` on the one call that asked to re-read.
 *
 * TENSE IS LOAD-BEARING, AND SO IS DEIXIS. Every clause below is past tense
 * about a single named call, and every reference to that call is "that call" —
 * bound by the opening clause, which says which call it was. "The call you just
 * made" was the earlier wording and it is not safe: re-read four calls later it
 * denotes call four, and the tools it names rode call one.
 *
 * There are exactly two present-tense phrases in the output and both are
 * timeless rather than temporal: "It declares no tools of its own" (a
 * declaration is fixed when the skill is defined and cannot vary within a run)
 * and "Its instructions are repeated below" (the body is appended to this very
 * string, so the sentence is true wherever the string is read).
 */
export function selfCallNotice(args: {
  readonly skillId: string;
  /** `undefined` when the wire could not be established — see `selfSkillTools`. */
  readonly tools: SelfSkillTools | undefined;
  readonly body?: string;
}): string {
  const { skillId, tools, body } = args;
  // "were in that call's system prompt" is a claim about the prompt, and the
  // evidence for it is that the skill was in the ACTIVE set for that call —
  // which is exactly what `tools !== undefined` establishes (see
  // `selfSkillTools`). With no body to append and no proof it was mounted, the
  // notice says nothing about the instructions rather than asserting where
  // they were.
  const bodyClause =
    body !== undefined
      ? `Its instructions are repeated below. `
      : tools !== undefined
      ? `Its instructions were in that call's system prompt. `
      : '';
  const toolClause =
    tools === undefined
      ? ''
      : tools.declared.length === 0
      ? `It declares no tools of its own. `
      : tools.served.length > 0
      ? `Its own tools were on that call's tool list: ${tools.served.join(', ')}.`
      : `None of its own tools were on that call's tool list (${tools.declared.join(', ')} ` +
        `${tools.declared.length === 1 ? 'was' : 'were'} withheld).`;
  // The opening clause is what binds "that call" for every clause after it, so
  // it names the event rather than the state: not where the cursor IS, but
  // where it stood when this call was made. A sibling tool in the SAME batch
  // can fire a step edge and move the cursor before the model reads this — the
  // read_skill description in that request will then say "You are in 'beta'",
  // and the two must not contradict each other. Only one of them is entitled
  // to the present tense, and it is the one recomposed on every call.
  const notice =
    `read_skill("${skillId}") named the skill you were already standing in when you ` +
    `made that call, so the cursor did not move — nothing was activated, and nothing ` +
    `was taken away. ${bodyClause}${toolClause}`;
  const trimmed = notice.trimEnd();
  return body === undefined ? trimmed : `${trimmed}\n\n${body}`;
}
