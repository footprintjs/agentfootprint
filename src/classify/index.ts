/**
 * classify/ — the calibrated-classifier port and its adapters.
 *
 * The implementation barrel behind `agentfootprint/classify`
 * (`src/doors/classify.ts`), the same shape as `llm-providers.ts` behind
 * `agentfootprint/providers`. The scorer strategy that USES a classifier
 * (`classifierScorer`) lives beside `keywordScorer` on
 * `agentfootprint/skill-graph`, not here — a door that carries no run entry
 * point and no agent loop.
 */

export {
  ClassifierError,
  type Classifier,
  type ClassifyAnswer,
  type ClassifyChoiceAnswer,
  type ClassifyChoiceQuestion,
  type ClassifyNoulAnswer,
  type ClassifyNoulQuestion,
  type ClassifyQuestion,
  type ClassifyRequest,
  type ClassifyResult,
  type ClassifyScoreAnswer,
  type ClassifyScoreQuestion,
} from './types.js';
export { typesafe, type TypesafeClassifierOptions } from './typesafe.js';
export { mockClassifier, type MockClassifier, type MockClassifierScript } from './mock.js';
