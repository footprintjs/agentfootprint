/**
 * toolChoice/pick — ask the classifier which tool, and decide what is served.
 *
 * Pattern: a pure question builder (`toolChoiceQuestion`) + one async asker
 *          that never throws (`pickTools`) + one pure narrowing decision
 *          (`narrowServed`) — the `findings/judge.ts` split, with the
 *          serving half kept pure so every skip reason is testable without
 *          a run.
 * Role:    core/ layer. Reached ONLY from `slots/buildToolsSlot.ts ·
 *          composeStage` through `import()` under `.toolChoice()` — the
 *          optional-family law of docs-next's site budget (the
 *          `toolCalls.ts · judgeLanded` precedent): an agent that never
 *          asked never loads this module.
 *
 * WHAT IS ASKED. One `choice` question, id `TOOL_CHOICE_QUESTION`, whose
 * criteria are the OFFERED tools by name with their own descriptions —
 * declared before the call, the same law as declared tags and routes. The
 * state is the user's message and, when a skill is active, its id; nothing
 * the library wrote. The doors are not candidates: a door is served whatever
 * the classifier says, so asking about it would only dilute the distribution.
 *
 * WHAT IS DECIDED. `narrowServed` serves the top-N of the provider's ranking
 * plus the doors, in the merged wire's order, and the full wire — with the
 * reason on the row — when the classifier failed or scored fewer than N
 * names (`unavailable`), when fewer than N + 1 candidates were offered
 * (`too-few` — there is nothing to leave out), on the call right after a
 * miss (`after-miss` — the model just showed the ranking was wrong), and on
 * the wrap-up call (`wrap-up` — every tool comes off at assembly anyway).
 */

import type { Classifier, ClassifyRequest, ClassifyResult } from '../../../classify/types.js';
import { ClassifierError } from '../../../classify/types.js';
import {
  ALWAYS_SERVED_TOOLS,
  TOOL_CHOICE_QUESTION,
  type NarrowSkipReason,
  type ToolChoiceEntry,
  type ToolChoiceScore,
} from './types.js';

const TOOL_CHOICE_INSTRUCTIONS =
  'The state is the request the agent is working on and, when one is set, the id of the skill ' +
  'it is currently following. Pick the ONE tool, by name, whose description answers the current ' +
  'step of this request. Pick by what each description says the tool does, not by its name.';

/** One offered tool as the classifier reads it. */
export interface ToolCandidate {
  readonly name: string;
  readonly description: string;
}

/**
 * Build the classifier request for one call. Pure. `criteria` is `{ name:
 * description }` over the candidates in offered order; an empty description
 * is sent as the empty string, never invented.
 */
export function toolChoiceQuestion(
  userMessage: string,
  currentSkillId: string | undefined,
  candidates: readonly ToolCandidate[],
): ClassifyRequest {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.name] = c.description;
  return {
    state: { message: userMessage, ...(currentSkillId !== undefined && { skill: currentSkillId }) },
    questions: {
      [TOOL_CHOICE_QUESTION]: {
        type: 'choice',
        instructions: TOOL_CHOICE_INSTRUCTIONS,
        criteria,
      },
    },
  };
}

/** The classifier's answer for one call, before the serving decision — or the failure. */
export type Pick =
  | {
      readonly ok: true;
      readonly classifier: { readonly name: string; readonly model: string };
      readonly ranked: readonly ToolChoiceScore[];
      readonly chosen?: string;
      readonly confidence: number;
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
      readonly latencyMs: number;
    }
  | {
      readonly ok: false;
      readonly classifier: { readonly name: string };
      readonly status?: number;
      readonly message: string;
      readonly latencyMs: number;
    };

/**
 * Ask the classifier once. Never throws: a provider failure, a network
 * error, an abort, a reply with no `choice` answer under the question id —
 * all come back as `ok: false` with the latency spent, because the pick is
 * advisory and its absence must never cost the run its answer.
 */
export async function pickTools(
  classifier: Classifier,
  input: {
    readonly userMessage: string;
    readonly currentSkillId?: string;
    readonly candidates: readonly ToolCandidate[];
  },
  signal?: AbortSignal,
): Promise<Pick> {
  const request = toolChoiceQuestion(input.userMessage, input.currentSkillId, input.candidates);
  const startedAt = Date.now();
  try {
    const result = await classifier.classify(request, signal);
    return pickFrom(result, classifier.name, input.candidates);
  } catch (err) {
    return {
      ok: false,
      classifier: { name: classifier.name },
      ...(err instanceof ClassifierError && err.status !== undefined && { status: err.status }),
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * The provider's answer as a pick — field for field. The ranking IS the
 * distribution, highest first, ties in offered order; a candidate the
 * provider did not score is absent (the `classifierScorer` law — a 0 nobody
 * sent would be one the library inferred). `chosen` is the provider's
 * `choice` when it names an offered tool, never an argmax the library took.
 */
function pickFrom(
  result: ClassifyResult,
  classifierName: string,
  candidates: readonly ToolCandidate[],
): Pick {
  const answer = result.answers[TOOL_CHOICE_QUESTION];
  if (answer === undefined || answer.type !== 'choice') {
    throw new ClassifierError(
      `toolChoice: no 'choice' answer under '${TOOL_CHOICE_QUESTION}' in the reply`,
    );
  }
  const scored: { name: string; score: number; offeredAt: number }[] = [];
  candidates.forEach((c, offeredAt) => {
    const p = answer.probabilities[c.name];
    if (p !== undefined) scored.push({ name: c.name, score: p, offeredAt });
  });
  // Highest first; `offeredAt` breaks ties so the order is the offer's, not the sort's.
  scored.sort((a, b) => b.score - a.score || a.offeredAt - b.offeredAt);
  const ranked: ToolChoiceScore[] = scored.map(({ name, score }) => ({ name, score }));
  const known = candidates.some((c) => c.name === answer.choice);
  return {
    ok: true,
    classifier: { name: classifierName, model: result.model },
    ranked,
    ...(known && { chosen: answer.choice }),
    confidence: answer.confidence,
    ...(result.usage !== undefined && { usage: result.usage }),
    latencyMs: result.latencyMs,
  };
}

/** What `narrowServed` decides for one call. */
export interface Narrowing {
  /** The names to commit, in the merged wire's order. */
  readonly served: readonly string[];
  readonly narrowed: boolean;
  readonly narrowedSkipped?: NarrowSkipReason;
}

/**
 * Decide what is served for one call. Pure. `wire` is the merged list's
 * names in order; `doors` every name that is served whatever the ranking
 * says (`ALWAYS_SERVED_TOOLS` plus the app's own); `top` is N, or
 * `undefined` for an advisory-only agent (the full wire, `narrowed: false`,
 * no reason — nothing was skipped because nothing was asked).
 */
export function narrowServed(input: {
  readonly wire: readonly string[];
  readonly doors: ReadonlySet<string>;
  readonly pick: Pick;
  readonly top: number | undefined;
  /** This call's iteration — `after-miss` reads the outcome row at `iteration - 1`, never merely the last row on the record. */
  readonly iteration: number;
  /** The rows already on the record — the immediately-prior iteration's outcome is read for `after-miss`. */
  readonly prior: readonly ToolChoiceEntry[];
  readonly wrapUpAsked: boolean;
}): Narrowing {
  const { wire, doors, pick, top, iteration, prior, wrapUpAsked } = input;
  if (top === undefined) return { served: wire, narrowed: false };
  const skip = (reason: NarrowSkipReason): Narrowing => ({
    served: wire,
    narrowed: false,
    narrowedSkipped: reason,
  });
  if (wrapUpAsked) return skip('wrap-up');
  if (outcomeAt(prior, iteration - 1)?.miss !== undefined) return skip('after-miss');
  const candidates = wire.filter((name) => !doors.has(name));
  if (candidates.length < top + 1) return skip('too-few');
  if (!pick.ok || pick.ranked.length < top) return skip('unavailable');
  const keep = new Set(pick.ranked.slice(0, top).map((r) => r.name));
  return {
    served: wire.filter((name) => doors.has(name) || keep.has(name)),
    narrowed: true,
  };
}

/**
 * The outcome row filed for exactly `iteration`, or nothing — either no
 * call has run there yet, or that call had no pick and so filed no outcome
 * (an intervening no-pick iteration must never resurrect an older miss).
 */
function outcomeAt(rows: readonly ToolChoiceEntry[], iteration: number) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row?.kind === 'outcome' && row.iteration === iteration) return row;
  }
  return undefined;
}

/** Every name served whatever the ranking says: the framework's doors plus the app's own. */
export function alwaysServedNames(extra: readonly string[] | undefined): ReadonlySet<string> {
  return new Set([...ALWAYS_SERVED_TOOLS, ...(extra ?? [])]);
}
