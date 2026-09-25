/**
 * The answer account — "Explain this answer", as a pure read-time Fold over one
 * answer's recording. See ./README.md.
 *
 * Public (via `agentfootprint/observe`): `accountForAnswer`, three types, and
 * `answerAccountPointerKey` — the key of the `shown` map the hosting op returns.
 * `showLeaves` and the allow-list are the hosting op's, not a door.
 */

export { accountForAnswer } from './account.js';
export { answerAccountPointerKey } from './pointerKey.js';
export type { AnswerAccount, AnswerAccountDeclarations, AnswerAccountShownLeaf } from './types.js';
