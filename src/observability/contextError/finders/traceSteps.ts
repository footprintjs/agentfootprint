/**
 * traceSteps — the step-level finder. Traces backward through the agent's steps
 * (tool-calls) from the failure to the most suspicious step, then optionally checks
 * whether correcting that step recovers the outcome. Its UNIT is the STEP: if the
 * root cause is a context element (an injected fact/instruction), that is outside
 * this finder's vocabulary — pair it with rankSuspects/removeAndRetry for elements.
 *
 * Method: dependency-guided backward search + step-recovery counterfactual.
 */
import { scoreInfluence } from '../../../lib/influence-core/index.js';
import type { Finder, FindInput, FindResult } from './types.js';

export const traceSteps: Finder = {
  name: 'traceSteps',
  meta: {
    label: 'Traces backward through the agent steps to the one that led to the wrong answer',
    method: 'dependency-guided backward search + step-recovery counterfactual (step granularity)',
    paper: 'FALAT, Rafi et al. 2026 (arXiv:2606.00765)',
  },
  async find(input: FindInput): Promise<FindResult> {
    if (!input.steps || !input.embedder) throw new Error('traceSteps needs input.steps and input.embedder');
    const evidence = input.steps.map((s) => ({ id: s.id, text: s.text, ancestorTexts: [] as string[] }));
    const ranked = await scoreInfluence({
      evidence,
      finalAnswerText: input.wrongOutput,
      embedder: input.embedder,
    });
    const topId = ranked[0]?.id;
    const step = input.steps.find((s) => s.id === topId);
    let recovers: boolean | undefined;
    let checks = 0;
    if (input.rerun && topId) {
      const r = await input.rerun([topId]);
      recovers = r.recovered;
      checks = 1;
    }
    const explanation = [
      `traceSteps: backward dependency search over ${input.steps.length} agent steps.`,
      `Most suspicious step: ${step?.label ?? topId ?? '(none)'}.`,
      recovers === undefined ? '' : `Correcting that step ${recovers ? 'recovered' : 'did NOT recover'} the outcome.`,
      `Granularity is the STEP — if the root cause is a context element, it is outside this finder's vocabulary.`,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      finder: 'traceSteps',
      suspects: ranked.map((s) => ({ id: s.id, score: s.score })),
      lead: topId,
      shortlist: topId ? [topId] : [],
      evidence: input.rerun ? 'proven' : 'guessed',
      granularity: 'step',
      checks,
      explanation,
    };
  },
};
