/**
 * ExplainRecorder — collects grounding evidence during traversal.
 *
 * Captures sources (tool results), claims (LLM output), and decisions
 * as they happen — no post-processing of narrative entries.
 *
 * Usage:
 *   const explain = new ExplainRecorder();
 *   agent.recorder(explain);
 *   await agent.run('Check order');
 *
 *   explain.getSources();    // tool results (ground truth)
 *   explain.getClaims();     // LLM responses (to verify)
 *   explain.getDecisions();  // tool call decisions (what the LLM chose to do)
 *   explain.explain();       // structured summary
 */

import type {
  AgentRecorder,
  LLMCallEvent,
  ToolCallEvent,
  TurnStartEvent,
  TurnCompleteEvent,
} from '../../core';

/** A source of truth — data returned by a tool. */
export interface ToolSource {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
  readonly turnNumber?: number;
}

/** A claim made by the LLM in its response. */
export interface LLMClaim {
  readonly content: string;
  readonly model?: string;
  readonly iteration: number;
}

/** A decision the LLM made (tool call). */
export interface AgentDecision {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly latencyMs: number;
}

/** Structured explanation of an agent's execution. */
export interface Explanation {
  readonly sources: readonly ToolSource[];
  readonly claims: readonly LLMClaim[];
  readonly decisions: readonly AgentDecision[];
  readonly summary: string;
}

export class ExplainRecorder implements AgentRecorder {
  readonly id: string;
  private sources: ToolSource[] = [];
  private claims: LLMClaim[] = [];
  private decisions: AgentDecision[] = [];
  private currentTurn = 0;

  constructor(id = 'explain-recorder') {
    this.id = id;
  }

  onTurnStart(event: TurnStartEvent): void {
    this.currentTurn = event.turnNumber;
  }

  private lastModel?: string;
  private lastIteration = 0;

  onLLMCall(event: LLMCallEvent): void {
    // Track model/iteration for claim attribution
    this.lastModel = event.model;
    this.lastIteration = event.loopIteration;
  }

  onToolCall(event: ToolCallEvent): void {
    // Tool result = source of truth (shallow clone args to prevent mutation)
    this.sources.push({
      toolName: event.toolName,
      args: { ...event.args },
      result: String(event.result.content),
      turnNumber: this.currentTurn,
    });

    // Tool call = decision the LLM made
    this.decisions.push({
      toolName: event.toolName,
      args: { ...event.args },
      latencyMs: event.latencyMs,
    });
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    // Capture the final LLM response as a claim — always, regardless of prior events
    this.claims.push({
      content: event.content,
      model: this.lastModel,
      iteration: this.lastIteration,
    });
  }

  /** Tool results — the ground truth data. */
  getSources(): readonly ToolSource[] {
    return [...this.sources];
  }

  /** LLM responses — what it claimed. */
  getClaims(): readonly LLMClaim[] {
    return [...this.claims];
  }

  /** Tool call decisions — what the LLM chose to do. Returns snapshot-safe copies. */
  getDecisions(): readonly AgentDecision[] {
    return this.decisions.map((d) => ({ ...d, args: { ...d.args } }));
  }

  /** Structured explanation of the agent's execution. */
  explain(): Explanation {
    const toolNames = [...new Set(this.decisions.map((d) => d.toolName))];
    const summary =
      this.sources.length === 0
        ? `Agent responded directly without calling tools.`
        : `Agent called ${toolNames.join(', ')} (${this.sources.length} call${
            this.sources.length > 1 ? 's' : ''
          }), then responded based on the results.`;

    return {
      sources: this.getSources(),
      claims: this.getClaims(),
      decisions: this.getDecisions(),
      summary,
    };
  }

  clear(): void {
    this.sources = [];
    this.claims = [];
    this.decisions = [];
    this.currentTurn = 0;
    this.lastModel = undefined;
    this.lastIteration = 0;
  }
}
