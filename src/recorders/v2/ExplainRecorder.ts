/**
 * ExplainRecorder — collects grounding evidence + evaluation context during traversal.
 *
 * Captures:
 *   - Sources (tool results — ground truth)
 *   - Claims (LLM output — to verify)
 *   - Decisions (tool calls — what the LLM chose to do)
 *   - Context (system prompt, tool descriptions, messages — what the LLM had)
 *
 * Everything for evaluation in one recorder: "what did it have?" + "what did it produce?"
 *
 * Usage:
 *   const explain = new ExplainRecorder();
 *   agent.recorder(explain);
 *   await agent.run('Check order');
 *
 *   explain.explain();  // { sources, claims, decisions, context, summary }
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

/** The context the LLM had when making decisions — for evaluation. */
export interface LLMContext {
  /** The user's original question/input. */
  readonly input?: string;
  /** System prompt the LLM received. */
  readonly systemPrompt?: string;
  /** Tool descriptions sent to the LLM (what tools were available). */
  readonly availableTools?: ReadonlyArray<{ name: string; description: string }>;
  /** Messages sent to the LLM (conversation context). */
  readonly messages?: ReadonlyArray<{ role: string; content: unknown }>;
  /** Model used. */
  readonly model?: string;
}

/** Structured explanation of an agent's execution — everything needed for evaluation. */
export interface Explanation {
  readonly sources: readonly ToolSource[];
  readonly claims: readonly LLMClaim[];
  readonly decisions: readonly AgentDecision[];
  /** What the LLM had when it made decisions. */
  readonly context: LLMContext;
  readonly summary: string;
}

export class ExplainRecorder implements AgentRecorder {
  readonly id: string;
  private sources: ToolSource[] = [];
  private claims: LLMClaim[] = [];
  private decisions: AgentDecision[] = [];
  private currentTurn = 0;
  private input?: string;
  private lastModel?: string;
  private lastIteration = 0;
  private lastSystemPrompt?: string;
  private lastToolDescriptions?: ReadonlyArray<{ name: string; description: string }>;
  private lastMessages?: ReadonlyArray<{ role: string; content: unknown }>;

  constructor(id = 'explain-recorder') {
    this.id = id;
  }

  onTurnStart(event: TurnStartEvent): void {
    this.currentTurn = event.turnNumber;
    this.input = event.message;
  }

  onLLMCall(event: LLMCallEvent): void {
    this.lastModel = event.model;
    this.lastIteration = event.loopIteration;
    // Capture evaluation context from the LLM call event
    if (event.systemPrompt) this.lastSystemPrompt = event.systemPrompt;
    if (event.toolDescriptions) this.lastToolDescriptions = event.toolDescriptions;
    if (event.messages) this.lastMessages = event.messages;
  }

  onToolCall(event: ToolCallEvent): void {
    this.sources.push({
      toolName: event.toolName,
      args: { ...event.args },
      result: String(event.result.content),
      turnNumber: this.currentTurn,
    });

    this.decisions.push({
      toolName: event.toolName,
      args: { ...event.args },
      latencyMs: event.latencyMs,
    });
  }

  onTurnComplete(event: TurnCompleteEvent): void {
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

  /** Tool call decisions — what the LLM chose to do. */
  getDecisions(): readonly AgentDecision[] {
    return this.decisions.map((d) => ({ ...d, args: { ...d.args } }));
  }

  /** What the LLM had when it made decisions — for evaluation. */
  getContext(): LLMContext {
    return {
      input: this.input,
      systemPrompt: this.lastSystemPrompt,
      availableTools: this.lastToolDescriptions ? [...this.lastToolDescriptions] : undefined,
      messages: this.lastMessages ? [...this.lastMessages] : undefined,
      model: this.lastModel,
    };
  }

  /** Structured explanation — everything needed for evaluation. */
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
      context: this.getContext(),
      summary,
    };
  }

  clear(): void {
    this.sources = [];
    this.claims = [];
    this.decisions = [];
    this.currentTurn = 0;
    this.input = undefined;
    this.lastModel = undefined;
    this.lastIteration = 0;
    this.lastSystemPrompt = undefined;
    this.lastToolDescriptions = undefined;
    this.lastMessages = undefined;
  }
}
