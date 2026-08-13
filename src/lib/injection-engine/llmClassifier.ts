/**
 * llmClassifier — an {@link IntentScorer} that asks a model which declared
 * intent the new message is (SG-C tier 2). ONE call per turn, off the hot
 * loop, in the RouteTurn stage — never inside the ReAct iterations.
 *
 * **Constrained enum, never free text.** The pick runs through
 * {@link constrainedEnumPick} (extracted from this module in 9.19.0 so the
 * tier-3 decider shares the same discipline): on a provider that declares
 * `carriesForcedToolChoice` it rides a forced synthetic tool whose single
 * argument is `enum: [...candidateIds, 'none']` (the same machinery the
 * `'tool-forced'` output strategy uses); on any other provider it is a
 * strict single-line parse validated against the enum, ONE structured
 * re-ask, then `'none'`. An off-enum answer is a parse failure, not a route
 * — this scorer can never emit an id it wasn't given.
 *
 * Output maps to scores the framework can judge: picked id → 1, others → 0;
 * `'none'` → all 0. `floor: 0` (so `'none'` is honestly "unmatched") and
 * `categorical: true` (one id or none — a pick is decisive by construction,
 * never diluted by the near-tie margin; see `routingPolicy.ts`).
 *
 * One of the two injection-engine scorer modules that import
 * `adapters/types` (the other is `constrainedEnumPick`, its machinery) —
 * kept out of `entryScorer.ts` so the keyword/embedding paths stay
 * adapter-free.
 */

import type { LLMProvider } from '../../adapters/types.js';
import { constrainedEnumPick } from './constrainedEnumPick.js';
import type {
  IntentCandidate,
  IntentScore,
  IntentScorer,
  IntentScorerInput,
} from './intentScorer.js';

export interface LlmClassifierOptions {
  /** Model to classify with. Name it for any real provider — left unset, the
   *  request carries an empty model id, which only the mock tolerates. */
  readonly model?: string;
  /** Recent-turns window (count of prior conversational turns shown to the
   *  classifier). Absent = current message only. */
  readonly window?: number;
  /** Prompt budget: examples listed per intent. Default 5. */
  readonly maxExamplesPerIntent?: number;
}

const PICK_TOOL = 'pick_intent';
const NONE = 'none';

/** Build the classifier. See the module header for the enum discipline. */
export function llmClassifier(
  provider: LLMProvider,
  options: LlmClassifierOptions = {},
): IntentScorer {
  const maxExamples = options.maxExamplesPerIntent ?? 5;
  return {
    name: 'llm-classifier',
    floor: 0,
    categorical: true,
    ...(options.window !== undefined && { window: options.window }),
    async score(input, candidates, signal): Promise<readonly IntentScore[]> {
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      const allowed = [...ids, NONE];
      const picked = await constrainedEnumPick({
        provider,
        ...(options.model !== undefined && { model: options.model }),
        systemPrompt: systemPromptFor(candidates, maxExamples),
        messages: messagesFor(input),
        allowed,
        fallback: NONE,
        pickTool: {
          name: PICK_TOOL,
          description: `Report which declared intent the user's message expresses ('${NONE}' if none).`,
          argName: 'intent',
          argDescription: 'The picked intent id.',
        },
        ...(signal !== undefined && { signal }),
      });
      return ids.map((id) => ({ id, score: picked === id ? 1 : 0 }));
    },
  };
}

/** The intent catalog as prompt lines — id, sentence, up to N examples. */
function catalogLines(candidates: readonly IntentCandidate[], maxExamples: number): string {
  return candidates
    .map((c) => {
      const examples = c.examples.slice(0, maxExamples);
      const exampleClause =
        examples.length > 0
          ? `\n  examples: ${examples.map((e) => JSON.stringify(e)).join(' | ')}`
          : '';
      return `- ${c.id}: ${c.intent}${exampleClause}`;
    })
    .join('\n');
}

function systemPromptFor(candidates: readonly IntentCandidate[], maxExamples: number): string {
  return (
    `You classify ONE user message against a fixed list of declared intents.\n` +
    `Intents:\n${catalogLines(candidates, maxExamples)}\n\n` +
    `Pick the single intent id that the message decisively expresses. If none of the ` +
    `declared intents fits, pick '${NONE}'. Never invent an id.`
  );
}

function messagesFor(
  input: IntentScorerInput,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns = (input.recentTurns ?? []).map((t) => ({ role: t.role, content: t.content }));
  return [...turns, { role: 'user' as const, content: input.message }];
}
