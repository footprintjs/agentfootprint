/**
 * rankSuspects — the free, instant finder. Ranks context pieces by embedding
 * influence on the wrong answer and says when it cannot confidently pick one
 * (escalate). Zero model tokens (embeddings only); a guess, not a verdict.
 *
 * Method: four-signal embedding-influence composite + ranking-confidence escalation.
 * Thin adapter over `scoreInfluence` / `rankingConfidence` (influence-core).
 */
import { rankingConfidence, scoreInfluence } from '../../../lib/influence-core/index.js';
import type { Finder, FindInput, FindResult } from './types.js';

export const rankSuspects: Finder = {
  name: 'rankSuspects',
  meta: {
    label: 'Ranks context pieces by how much each resembles the wrong answer (free)',
    method: 'four-signal embedding-influence composite + ranking-confidence escalation',
    paper: 'this work',
  },
  async find(input: FindInput): Promise<FindResult> {
    if (!input.embedder) throw new Error('rankSuspects needs input.embedder');
    const evidence = input.suspects.map((s) => ({
      id: s.id,
      text: s.text,
      ancestorTexts: [] as string[],
    }));
    const scores = await scoreInfluence({
      evidence,
      finalAnswerText: input.wrongOutput,
      embedder: input.embedder,
    });
    const conf = rankingConfidence(scores);
    const explanation = [
      `rankSuspects: scored ${scores.length} context pieces by embedding influence on the wrong answer.`,
      conf.clearWinner
        ? `Clear lead: ${conf.lead ?? '(none)'}.`
        : `No clear winner → escalate; shortlist: ${conf.shortlist.join(', ') || '(none)'}.`,
      `This is a guess (similarity proxy), not proof — confirm with removeAndRetry.`,
    ].join('\n');
    return {
      finder: 'rankSuspects',
      suspects: scores.map((s) => ({ id: s.id, score: s.score })),
      lead: conf.lead,
      shortlist: [...conf.shortlist],
      evidence: 'guessed',
      granularity: 'piece',
      checks: 0,
      explanation,
    };
  },
};
