/**
 * PickEntry — the relevance entry router stage (`skillGraph().entryByRelevance`).
 *
 * Runs ONCE per turn, BEFORE the ReAct loop (between seed and the Injection
 * Engine), so the async embedder is paid off the hot loop and `nextSkill` stays
 * synchronous. It scores the entry candidates by relevance to the user's message
 * and writes the winner to `scope.currentSkillId` — which the Injection Engine
 * then reads as the starting cursor (its sync cold-start branch is never hit,
 * because the cursor is already set). The full ranking lands on `scope.entryScores`
 * (snapshot / commit-log accessible — the "Why this skill?" relevance %).
 *
 * A throwing embedder or empty candidate set leaves the cursor unset, so the
 * Injection Engine's cold-start entry pick takes over (graceful fallback).
 */

import { isDevMode } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { InjectionContext } from '../../../lib/injection-engine/types.js';
import type { EntryScoring } from '../../../lib/injection-engine/skillGraph.js';

export function makePickEntryStage(
  scoreEntries: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>,
) {
  return async (scope: TypedScope<AgentState>): Promise<void> => {
    const env = scope.$getEnv();
    const ctx: InjectionContext = {
      iteration: (scope.iteration as number | undefined) ?? 1,
      userMessage: (scope.userMessage as string | undefined) ?? '',
      history: (scope.history as InjectionContext['history'] | undefined) ?? [],
      activatedInjectionIds: (scope.activatedInjectionIds as readonly string[] | undefined) ?? [],
    };

    let scoring: EntryScoring;
    try {
      scoring = await scoreEntries(ctx, env.signal);
    } catch (err) {
      // Graceful fallback — leave the cursor unset; the Injection Engine's
      // cold-start entry pick takes over.
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint entryByRelevance: embedder threw — falling back to the cold-start entry. ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    if (scoring.chosen !== undefined) {
      scope.currentSkillId = scoring.chosen;
    }
    // The relevance ranking — read by the lens / Why-panel off the snapshot.
    scope.entryScores = scoring.ranked;
  };
}
