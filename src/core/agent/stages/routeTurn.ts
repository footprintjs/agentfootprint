/**
 * RouteTurn — the turn-start routing cascade stage (SG-C).
 *
 * Runs ONCE per turn, BEFORE the ReAct loop, in the slot PickEntry has always
 * occupied (`STAGE_IDS.PICK_ENTRY` — recorded structures stay stable), so
 * anything async (a classifier, an embedder, one model call) is paid off the
 * hot loop and `nextSkill` stays synchronous. It decides where the turn
 * STARTS and writes the verdict to `scope.turnRoute`; the graph's cursor
 * resolver consumes it on iteration 1 — the exact mechanism
 * `entryScores`/`pendingSkillPick` already use. Iterations 2..N keep today's
 * law byte-for-byte (`userMessage` is fixed for a run).
 *
 * The cascade:
 *   tier 1 — declared start rules (regex / keywords / `when`), declaration
 *            order, binary and decisive;
 *   tier 2 — the configured scorer: the intent classifier (`classify`) over
 *            declared intents, or the entry scorer (`entryBy*`) over
 *            descriptions — judged by `decideTier2` (floor + pairwise
 *            near-tie margin; near-ties FALL THROUGH, never argmax);
 *   tier 3 — a menu through the model's own `read_skill` description (plus
 *            the advisory menu hint), STAY first-class mid-conversation.
 *
 * Mounted only on graphs that run the cascade — `classify` configured, or
 * `continuity: 'conversation'` declared. A 9.16-style graph (scorer or not)
 * keeps its exact prior stage and events: scorer-only graphs keep PickEntry
 * byte-for-byte, and the cascade fires no `turn_routed` there.
 *
 * Mid-conversation (an inherited cursor from `continuity: 'conversation'`):
 * sticky default — the incumbent is scored AS A CANDIDATE, beaten only by a
 * decisive tier-1/tier-2 verdict; ambiguity = stay; genuinely-new-but-
 * unmatched opens the full menu with STAY first-class. An inherited id the
 * mounted graph does not know is DROPPED (cold start), dev-warned, and
 * recorded as `turn_routed.droppedResume` — never silently parked on a node
 * that does not exist.
 *
 * Every verdict lands on `agentfootprint.skill.turn_routed` with the losers
 * (`scores`, ranked), the pairwise runner-up gap, and the policy numbers that
 * judged it. A throwing/misbehaving scorer never aborts the run: cold start
 * falls through to the FULL menu (recorded — never the declaration-order
 * walk), mid-conversation stays put (`by: 'continuity'`), both dev-warned.
 *
 * `strictness: 'rails'` and menus: the model is not allowed to route, so a
 * menu verdict proceeds on the base prompt — recorded as `by: 'none'` WITH
 * the offered set on the EVENT (what happened), while `scope.turnRoute`
 * carries no `offered` (what the loop may act on): no envelope is composed,
 * and no entry loads. That is the honest cost of rails without a resolver,
 * and the README names it.
 */

import { isDevMode } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { InjectionContext } from '../../../lib/injection-engine/types.js';
import type { EntryScoring } from '../../../lib/injection-engine/skillGraph.js';
import type { IntentCandidate, IntentScore } from '../../../lib/injection-engine/intentScorer.js';
import { validateIntentScores } from '../../../lib/injection-engine/intentScorer.js';
import type { TurnRoutingPlan } from '../../../lib/injection-engine/skillIntent.js';
import {
  decideTier2,
  type Tier2Verdict,
  type TurnRoute,
} from '../../../lib/injection-engine/routingPolicy.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { SkillTurnRoutedPayload } from '../../../events/payloads.js';

export interface RouteTurnDeps {
  /** The graph's turn-routing plan — tier-1 rules, intent candidates, the
   *  classifier (when configured) and the resolved tie policy. */
  readonly turnRouting: TurnRoutingPlan;
  /** The entry scorer (`entryBy`/`entryByRelevance`) — tier 2 when no
   *  classifier is configured. Same closure PickEntry consumed. */
  readonly scoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>;
  /** What the cursor spans — `'conversation'` restores + judges the inherited
   *  cursor; `'turn'` mounts this stage only when a classifier exists. */
  readonly continuity: 'turn' | 'conversation';
  /** The mount's routing posture. `'rails'` strips `offered` from the POJO
   *  the loop acts on (see the module header). */
  readonly strictness: 'assist' | 'guard' | 'rails';
  /** Is this id a node of the CURRENTLY mounted graph? (droppedResume). */
  readonly isNode: (id: string) => boolean;
  /** Which skills the caller's role may not see (9.11.0) — excluded from
   *  candidates, scores, menus and the envelope. Fail-closed inside. */
  readonly hiddenSkillIds?: () => Promise<readonly string[]> | readonly string[];
}

/** The verdict in stage-internal form, before it splits into POJO + event. */
interface CascadeVerdict {
  readonly by: SkillTurnRoutedPayload['by'];
  readonly to?: string;
  readonly offered?: readonly string[];
  readonly stayOffered?: boolean;
  readonly scorer?: string;
  readonly window?: number;
  readonly scores?: ReadonlyArray<{ id: string; score: number; relevance: number }>;
  readonly runnerUp?: { id: string; gap: number };
  readonly decisive?: boolean;
}

export function makeRouteTurnStage(deps: RouteTurnDeps) {
  const plan = deps.turnRouting;
  return async (scope: TypedScope<AgentState>): Promise<void> => {
    const env = scope.$getEnv();
    let inherited = scope.currentSkillId as string | undefined;

    // Deploy honesty: an inherited id that is not a node of the CURRENTLY
    // mounted graph is dropped (cold start), never silently parked on a node
    // that does not exist.
    let droppedResume: SkillTurnRoutedPayload['droppedResume'];
    if (inherited !== undefined && !deps.isNode(inherited)) {
      droppedResume = { id: inherited, reason: 'unknown-skill' };
      scope.currentSkillId = undefined;
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint RouteTurn: the conversation's stored cursor "${inherited}" is not a ` +
            `node of the currently mounted graph (a deploy changed it?) — starting cold. ` +
            `Recorded as turn_routed.droppedResume.`,
        );
      }
      inherited = undefined;
    }

    const ctx: InjectionContext = {
      iteration: (scope.iteration as number | undefined) ?? 1,
      userMessage: (scope.userMessage as string | undefined) ?? '',
      history: (scope.history as InjectionContext['history'] | undefined) ?? [],
      activatedInjectionIds: (scope.activatedInjectionIds as readonly string[] | undefined) ?? [],
      ...(inherited !== undefined && { currentSkillId: inherited }),
    };

    const resolved = await resolveHidden(deps.hiddenSkillIds);
    // Fail CLOSED: a throwing resolver hides EVERY graph candidate this turn
    // (the cascade degrades to continuity-stay / base prompt, all recorded)
    // rather than advertising skills a policy may have meant to hide.
    const hidden = resolved === 'resolver-failed' ? new Set(plan.entryIds) : new Set(resolved);
    if (resolved === 'resolver-failed' && isDevMode()) {
      console.warn(
        'agentfootprint: the hidden-skills resolver threw during turn routing — ' +
          'failing closed (no graph candidates scored or offered this turn). ' +
          'Fix the resolver passed to hiddenSkillIds.',
      );
    }
    const visibleEntryIds = plan.entryIds.filter((id) => !hidden.has(id));

    const verdict = await runCascade(
      deps,
      plan,
      ctx,
      inherited,
      hidden,
      visibleEntryIds,
      env.signal,
    );

    if (verdict === undefined && droppedResume === undefined) {
      // Cold start on a continuity graph with no tier 2 at all: the resolver's
      // cold walk decides exactly as it always has — no verdict, no event.
      return;
    }

    // The shipped ranking surface (defineRelevanceHint, the Why-panel) — the
    // tier-2 numbers, whatever scorer produced them.
    if (verdict?.scores !== undefined && verdict.scorer !== undefined) {
      scope.entryScores = verdict.scores;
      scope.entryScorer = verdict.scorer;
    }

    const policy = plan.policy;
    const effectiveFloor = policy.floor ?? plan.scorer?.floor;
    // Rails × menu: the model may not act on it — record the offer, act on none.
    const rails = deps.strictness === 'rails';
    const eventBy = rails && verdict?.by === 'menu' ? 'none' : verdict?.by ?? 'none';

    typedEmit(scope, 'agentfootprint.skill.turn_routed', {
      by: eventBy,
      ...(inherited !== undefined && { from: inherited }),
      ...(verdict?.to !== undefined && { to: verdict.to }),
      ...(verdict?.scorer !== undefined && { scorer: verdict.scorer }),
      ...(verdict?.scores !== undefined && { scores: verdict.scores.map((s) => ({ ...s })) }),
      ...(verdict?.runnerUp !== undefined && { runnerUp: { ...verdict.runnerUp } }),
      ...(verdict?.decisive !== undefined && { decisive: verdict.decisive }),
      ...(verdict?.offered !== undefined && { offered: [...verdict.offered] }),
      ...(verdict?.stayOffered !== undefined && { stayOffered: verdict.stayOffered }),
      policy: {
        nearTieMargin: policy.nearTieMargin,
        menuSize: policy.menuSize,
        ...(effectiveFloor !== undefined && { floor: effectiveFloor }),
      },
      ...(verdict?.window !== undefined && { window: verdict.window }),
      ...(droppedResume !== undefined && { droppedResume }),
    });

    // The POJO the LOOP acts on — the resolver's iteration-1 input, the
    // envelope's source, the guard gate's window. Under rails a menu carries
    // no `offered` here: nothing downstream may offer what nothing may accept.
    // Written ONLY when the cascade DECIDED something: the resolver suppresses
    // its cold-start walk on the POJO's presence (suppression follows the
    // verdict), so a droppedResume with nothing else to say — a TRUE cold
    // start on a graph whose cold walk still decides — must leave scope
    // untouched, or the drop would silently strand the turn on no entry.
    if (verdict === undefined) return;
    const turnRoute: TurnRoute = {
      by: eventBy,
      ...(inherited !== undefined && { from: inherited }),
      ...(verdict.to !== undefined && { to: verdict.to }),
      ...(!rails && verdict.offered !== undefined && { offered: [...verdict.offered] }),
      ...(!rails && verdict.stayOffered !== undefined && { stayOffered: verdict.stayOffered }),
      ...(!rails &&
        verdict.offered !== undefined &&
        verdict.scores !== undefined && {
          relevance: verdict.scores.map((s) => ({ id: s.id, relevance: s.relevance })),
        }),
    };
    scope.turnRoute = turnRoute;
  };
}

/** Resolve the role-hidden set. A throwing resolver returns the sentinel so the
 *  caller can fail CLOSED (hide every candidate) — a menu built on a question
 *  nobody answered would advertise what policy hides. */
async function resolveHidden(
  hiddenSkillIds: RouteTurnDeps['hiddenSkillIds'],
): Promise<readonly string[] | 'resolver-failed'> {
  if (!hiddenSkillIds) return [];
  try {
    const asked = hiddenSkillIds();
    return asked instanceof Promise ? await asked : asked;
  } catch {
    return 'resolver-failed';
  }
}

/** The cascade proper. Returns undefined when the stage has nothing to decide
 *  (cold start, no classifier, no scorer — the resolver's law). */
async function runCascade(
  deps: RouteTurnDeps,
  plan: TurnRoutingPlan,
  ctx: InjectionContext,
  inherited: string | undefined,
  hidden: ReadonlySet<string>,
  visibleEntryIds: readonly string[],
  signal: AbortSignal | undefined,
): Promise<CascadeVerdict | undefined> {
  const cold = inherited === undefined;

  // Tier 1 — declared rules, declaration order. Binary: a rule match is
  // decisive by definition, cold or mid-conversation.
  const ruleWin = plan.firstRuleMatch(ctx);
  if (ruleWin !== undefined) {
    return { by: 'entry', to: ruleWin, decisive: true };
  }

  // Tier 2 — the classifier over declared intents…
  if (plan.scorer !== undefined) {
    const scorer = plan.scorer;
    const candidates: IntentCandidate[] = [...plan.intentCandidates(hidden)];
    if (!cold && !hidden.has(inherited!) && !candidates.some((c) => c.id === inherited)) {
      // The incumbent is judged by the same numbers as its challengers — its
      // intent is its description when it is not an intent entry.
      candidates.push(plan.incumbentCandidate(inherited!));
    }
    if (candidates.length === 0) {
      return cold
        ? menuVerdict(visibleEntryIds, false, scorer.name, scorer.window)
        : { by: 'continuity', to: inherited!, scorer: scorer.name };
    }
    let scores: readonly IntentScore[];
    try {
      const input = {
        message: ctx.userMessage,
        ...(scorer.window !== undefined && {
          recentTurns: recentTurnsOf(ctx.history, scorer.window),
        }),
      };
      const raw = await scorer.score(input, candidates, signal);
      scores = validateIntentScores(scorer.name, candidates, raw);
    } catch (err) {
      return scorerFellThrough(err, scorer.name, cold, inherited, visibleEntryIds, scorer.window);
    }
    const v = decideTier2(scores, cold ? undefined : inherited, plan.policy, {
      ...(scorer.floor !== undefined && { floor: scorer.floor }),
      ...(scorer.categorical !== undefined && { categorical: scorer.categorical }),
    });
    return mapTier2(v, scorer.name, cold, inherited, visibleEntryIds, scorer.window);
  }

  // …or the entry scorer over descriptions (entryBy/entryByRelevance graphs
  // that opted into the cascade via continuity).
  if (deps.scoreEntries !== undefined) {
    let scoring: EntryScoring;
    try {
      scoring = await deps.scoreEntries(ctx, signal);
    } catch (err) {
      return scorerFellThrough(err, 'entry-scorer', cold, inherited, visibleEntryIds, undefined);
    }
    // Role-hidden candidates never appear in scores, menus or the envelope.
    let ranked = scoring.ranked.filter((r) => !hidden.has(r.id));
    if (!cold && !hidden.has(inherited!) && !ranked.some((r) => r.id === inherited)) {
      // The incumbent was not a when-passing entry candidate this turn — score
      // floor-less zero so the same verdict function judges it. (An entry
      // scorer declares no floor, so 0 is a rank, not "unmatched".)
      ranked = [...ranked, { id: inherited!, score: 0, relevance: 0 }];
    }
    if (ranked.length === 0)
      return cold
        ? menuVerdict(visibleEntryIds, false, scoring.scorer, undefined)
        : { by: 'continuity', to: inherited!, scorer: scoring.scorer };
    const v = decideTier2(
      ranked.map((r) => ({ id: r.id, score: r.score })),
      cold ? undefined : inherited,
      plan.policy,
      {},
    );
    return mapTier2(v, scoring.scorer, cold, inherited, visibleEntryIds, undefined);
  }

  // No tier 2 at all: mid-conversation the inherited cursor holds (sticky,
  // recorded); cold start is the resolver's cold walk — nothing to decide.
  if (!cold) return { by: 'continuity', to: inherited! };
  return undefined;
}

/** Map a `decideTier2` verdict into the stage's recorded shape. */
function mapTier2(
  v: Tier2Verdict,
  scorerName: string,
  cold: boolean,
  inherited: string | undefined,
  visibleEntryIds: readonly string[],
  window: number | undefined,
): CascadeVerdict {
  const numbers = {
    scorer: scorerName,
    scores: v.ranked.map((r) => ({ id: r.id, score: r.score, relevance: r.relevance })),
    ...(v.runnerUp !== undefined && { runnerUp: { ...v.runnerUp } }),
    decisive: v.decisive,
    ...(window !== undefined && { window }),
  };
  switch (v.kind) {
    case 'move':
      return { by: 'intent', to: v.to, ...numbers };
    case 'stay':
      // Incumbent won or near-tie held it — `continuity`, with the numbers.
      return { by: 'continuity', to: inherited!, ...numbers };
    case 'menu':
      return { by: 'menu', offered: v.offered, ...(!cold && { stayOffered: true }), ...numbers };
    case 'unmatched':
      // Genuinely new but unmatched: the FULL entry menu, STAY first-class
      // mid-conversation.
      return {
        by: 'menu',
        offered: visibleEntryIds,
        ...(!cold && { stayOffered: true }),
        ...numbers,
      };
  }
}

/** The recorded fallback for a throwing/misbehaving scorer: cold → the full
 *  menu (never the declaration-order walk); mid → stay. Dev-warned. */
function scorerFellThrough(
  err: unknown,
  scorerName: string,
  cold: boolean,
  inherited: string | undefined,
  visibleEntryIds: readonly string[],
  window: number | undefined,
): CascadeVerdict {
  if (isDevMode()) {
    // eslint-disable-next-line no-console
    console.warn(
      `agentfootprint RouteTurn: the '${scorerName}' scorer failed — ${
        cold
          ? 'offering the full entry menu (recorded)'
          : 'staying on the inherited cursor (recorded)'
      }. Scorers are a tier, never a correctness dependency. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return cold
    ? menuVerdict(visibleEntryIds, false, scorerName, window)
    : {
        by: 'continuity',
        to: inherited!,
        scorer: scorerName,
        ...(window !== undefined && { window }),
      };
}

function menuVerdict(
  offered: readonly string[],
  stayOffered: boolean,
  scorerName: string | undefined,
  window: number | undefined,
): CascadeVerdict {
  return {
    by: 'menu',
    offered,
    ...(stayOffered && { stayOffered }),
    ...(scorerName !== undefined && { scorer: scorerName }),
    ...(window !== undefined && { window }),
  };
}

/** The prior conversational turns a windowed scorer sees — user/assistant
 *  roles only, the CURRENT user message excluded, newest last. */
function recentTurnsOf(
  history: InjectionContext['history'],
  window: number,
): ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> {
  const prior = history.slice(0, Math.max(0, history.length - 1));
  return prior
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    .slice(-window);
}
