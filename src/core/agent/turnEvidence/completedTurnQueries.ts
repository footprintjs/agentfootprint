import type { TurnEvidenceResult } from './completedTurnBudget.js';
import type { CompletedAgentTurn, CompletedTurnNode } from './completedTurnHandle.js';

type Report = TurnEvidenceResult<unknown> | { readonly gaps: readonly string[] };

interface CompletedTurnQueries {
  why(
    owner: object,
    node: CompletedTurnNode,
    turn: CompletedAgentTurn | undefined,
  ): Promise<Report>;
  whatWasNotRead(owner: object, turn: CompletedAgentTurn | undefined): Promise<Report>;
}

const refusal = async (): Promise<Report> => ({ gaps: ['turn-unavailable'] });

let queries: CompletedTurnQueries = { why: refusal, whatWasNotRead: refusal };

/** The two read-only projections load through the Agent's published door. */
export function registerCompletedTurnQueries(readers: CompletedTurnQueries): void {
  queries = readers;
}

export function why(
  this: { readonly runner: object },
  node: CompletedTurnNode,
  turn?: CompletedAgentTurn,
): Promise<Report> {
  return queries.why(this.runner, node, turn);
}

export function whatWasNotRead(
  this: { readonly runner: object },
  turn?: CompletedAgentTurn,
): Promise<Report> {
  return queries.whatWasNotRead(this.runner, turn);
}
