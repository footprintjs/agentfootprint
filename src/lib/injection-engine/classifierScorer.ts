/**
 * classifierScorer — an {@link EntryScorer} whose ranking IS a calibrated
 * classifier's distribution (9.104.0; docs/design/2026-09-scored-choice.md
 * step 2, opened when a provider that scores came in reach).
 *
 * `keywordScorer` and `embeddingScorer` compute a raw score per candidate
 * and let `rankEntries` soften it into a `relevance` share. This scorer has
 * no raw score to soften: the classifier is asked ONE `choice` question
 * over the candidates — criteria `{ id: description }`, declared before the
 * call, the same law as declared tags and routes — and answers with a
 * probability per candidate and a pick. Both are the provider's data and
 * both land on `EntryScoring` unchanged: `ranked[].score` and
 * `ranked[].relevance` are the SAME number (the probability as sent, never
 * renormalised), and `chosen` is the provider's `choice`, not an argmax the
 * library took — a provider whose pick differs from its own argmax is
 * recorded as it answered, which is a fact about the provider.
 *
 * A provider failure is NOT a guess: the scorer returns
 * `scorer: 'classifier:unavailable'`, an EMPTY ranking and no `chosen`.
 * `stages/pickEntry.ts` leaves the cursor unset on an undefined `chosen`
 * and the Injection Engine's cold-start entry pick takes over — the
 * fallback that already exists for a throwing embedder, reached here
 * through the honest empty result rather than a throw.
 *
 * Pure core of the skill-graph fence: the only import outside the folder
 * is the `Classifier` port type (`src/classify/types.ts`, a zero-import leaf).
 */

import type { Classifier, ClassifyRequest } from '../../classify/types.js';
import type { EntryScore, EntryScorer, EntryScorerInput, EntryScoring } from './entryScorer.js';

export interface ClassifierScorerOptions {
  /** The instruction on the choice question. Default: pick the skill the message is for. */
  readonly instructions?: string;
}

/** The question id every scoring asks under — fixed, so a record reader can find it. */
export const CLASSIFIER_SCORER_QUESTION = 'entry' as const;
/** The `scorer` name on an unavailable result. */
export const CLASSIFIER_SCORER_UNAVAILABLE = 'classifier:unavailable' as const;

const DEFAULT_INSTRUCTIONS =
  'The state is a user message and nothing else. Pick the ONE skill, by id, whose description ' +
  'best fits what the message asks for.';

/**
 * `classifierScorer(classifier)` — plug into `skillGraph().entryBy(...)`.
 * `scorer` on a scoring is `'classifier:' + the provider's model string`
 * (`'classifier:jev-1.13.0'`), so the "Why this skill?" panel names the
 * exact model that ranked.
 */
export function classifierScorer(
  classifier: Classifier,
  options: ClassifierScorerOptions = {},
): EntryScorer {
  const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
  return {
    name: 'classifier',
    async score(input: EntryScorerInput, signal?: AbortSignal): Promise<EntryScoring> {
      const { userMessage, candidates } = input;
      if (candidates.length === 0) return { scorer: 'classifier', chosen: undefined, ranked: [] };
      const request = requestFor(userMessage, candidates, instructions);
      let result;
      try {
        result = await classifier.classify(request, signal);
      } catch {
        return { scorer: CLASSIFIER_SCORER_UNAVAILABLE, chosen: undefined, ranked: [] };
      }
      const answer = result.answers[CLASSIFIER_SCORER_QUESTION];
      if (answer === undefined || answer.type !== 'choice') {
        return { scorer: CLASSIFIER_SCORER_UNAVAILABLE, chosen: undefined, ranked: [] };
      }
      // The ranking IS the provider's distribution, never padded: a
      // candidate the provider did not score is ABSENT from `ranked` (the
      // `JudgmentRow.probabilities` law — a score is data only when the
      // provider produced it, and a 0 nobody sent would be one the library
      // inferred). Candidate order is kept for the ones it did score.
      const ranked: EntryScore[] = [];
      for (const c of candidates) {
        const p = answer.probabilities[c.id];
        if (p !== undefined) ranked.push({ id: c.id, score: p, relevance: p });
      }
      const known = candidates.some((c) => c.id === answer.choice);
      return {
        scorer: `classifier:${result.model}`,
        // The provider's pick — never an argmax the library took. A pick
        // outside the declared candidates is nobody's entry: no chosen.
        chosen: known ? answer.choice : undefined,
        ranked,
      };
    },
  };
}

function requestFor(
  userMessage: string,
  candidates: EntryScorerInput['candidates'],
  instructions: string,
): ClassifyRequest {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.id] = c.description;
  return {
    state: { message: userMessage },
    questions: { [CLASSIFIER_SCORER_QUESTION]: { type: 'choice', instructions, criteria } },
  };
}
