/**
 * The answer account — "Explain this answer", as a pure read-time Fold over one
 * answer's recording. See ./README.md.
 *
 * Public (via `agentfootprint/observe`): `accountForAnswer` and three types.
 * `showLeaves` and the allow-list are the hosting op's (af-3), not a door.
 */

export { accountForAnswer } from './account.js';
export type { AnswerAccount, AnswerAccountDeclarations, AnswerAccountShownLeaf } from './types.js';
