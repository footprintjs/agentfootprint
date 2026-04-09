/**
 * ExplainRecorder — collects grounding evidence + evaluation context during traversal.
 *
 * Data is structured per-iteration for evaluation:
 *   iterations[0] = { context (what LLM had), decisions (tools chosen), sources (results), claim? }
 *   iterations[1] = { context (updated with tool results), decisions, sources, claim (final answer) }
 *
 * An evaluator walks iterations: for each one that has a claim, check if it's
 * grounded in that iteration's sources + all prior sources.
 *
 * Usage:
 *   const explain = new ExplainRecorder();
 *   agent.recorder(explain);
 *   await agent.run('Check order');
 *
 *   const report = explain.explain();
 *   report.iterations;  // per-iteration evaluation units
 *   report.sources;     // flat convenience (all sources)
 *   report.claims;      // flat convenience (all claims)
 *   report.context;     // last context snapshot
 */

import type {
  AgentRecorder,
  LLMCallEvent,
  ToolCallEvent,
  TurnStartEvent,
  TurnCompleteEvent,
} from '../core';

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

/** One iteration of the agent loop — a self-contained evaluation unit. */
export interface EvalIteration {
  /** Loop iteration number (0-based). */
  readonly iteration: number;
  /** Unique execution step identifier for this LLM call. */
  readonly runtimeStageId?: string;
  /** What the LLM had THIS iteration (context changes each loop — messages grow). */
  readonly context: LLMContext;
  /** Tool calls the LLM chose to make (empty if final response). */
  readonly decisions: readonly AgentDecision[];
  /** Tool results returned (empty if no tools called). */
  readonly sources: readonly ToolSource[];
  /** LLM's response — null for tool-calling iterations, string for final answer. */
  readonly claim: LLMClaim | null;
}

/** Structured explanation — everything needed for evaluation. */
export interface Explanation {
  /** Per-iteration evaluation units — the connected data shape. */
  readonly iterations: readonly EvalIteration[];
  /** Flat convenience: all sources across all iterations. */
  readonly sources: readonly ToolSource[];
  /** Flat convenience: all claims across all iterations. */
  readonly claims: readonly LLMClaim[];
  /** Flat convenience: all decisions across all iterations. */
  readonly decisions: readonly AgentDecision[];
  /** Last context snapshot (same as iterations[last].context). */
  readonly context: LLMContext;
  readonly summary: string;
}

export class ExplainRecorder implements AgentRecorder {
  readonly id: string;

  // Per-iteration accumulation
  private iterations: EvalIteration[] = [];
  private currentIterationDecisions: AgentDecision[] = [];
  private currentIterationSources: ToolSource[] = [];

  // Tracking state
  private currentTurn = 0;
  private input?: string;
  private currentIteration = -1;
  private currentRuntimeStageId?: string;
  private currentContext: LLMContext = {};

  constructor(id = 'explain-recorder') {
    this.id = id;
  }

  onTurnStart(event: TurnStartEvent): void {
    this.currentTurn = event.turnNumber;
    this.input = event.message;
  }

  onLLMCall(event: LLMCallEvent): void {
    // Flush previous iteration (if any) — it had no claim (tool-calling response)
    if (this.currentIteration >= 0) {
      this.flushIteration(null);
    }

    this.currentIteration = event.loopIteration;
    this.currentRuntimeStageId = event.runtimeStageId;

    // Snapshot context for THIS iteration
    this.currentContext = {
      input: this.input,
      systemPrompt: event.systemPrompt ?? this.currentContext.systemPrompt,
      availableTools: event.toolDescriptions
        ? [...event.toolDescriptions]
        : this.currentContext.availableTools,
      messages: event.messages ? [...event.messages] : this.currentContext.messages,
      model: event.model,
    };
  }

  onToolCall(event: ToolCallEvent): void {
    const source: ToolSource = {
      toolName: event.toolName,
      args: { ...event.args },
      result: String(event.result.content),
      turnNumber: this.currentTurn,
    };
    this.currentIterationSources.push(source);

    const decision: AgentDecision = {
      toolName: event.toolName,
      args: { ...event.args },
      latencyMs: event.latencyMs,
    };
    this.currentIterationDecisions.push(decision);
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    // Guard: if no onLLMCall fired (e.g., cached response), use iteration 0
    if (this.currentIteration < 0) this.currentIteration = 0;
    const claim: LLMClaim = {
      content: event.content,
      model: this.currentContext.model,
      iteration: this.currentIteration,
    };
    this.flushIteration(claim);
  }

  /** Flush current iteration data into the iterations array. */
  private flushIteration(claim: LLMClaim | null): void {
    this.iterations.push({
      iteration: this.currentIteration,
      runtimeStageId: this.currentRuntimeStageId,
      context: { ...this.currentContext },
      decisions: this.currentIterationDecisions.map((d) => ({ ...d, args: { ...d.args } })),
      sources: [...this.currentIterationSources],
      claim,
    });
    this.currentIterationDecisions = [];
    this.currentIterationSources = [];
  }

  // ── Flat convenience accessors (backward compatible) ────

  getSources(): readonly ToolSource[] {
    return this.iterations.flatMap((it) => it.sources);
  }

  getClaims(): readonly LLMClaim[] {
    return this.iterations.filter((it) => it.claim).map((it) => it.claim!);
  }

  getDecisions(): readonly AgentDecision[] {
    return this.iterations.flatMap((it) =>
      it.decisions.map((d) => ({ ...d, args: { ...d.args } })),
    );
  }

  getContext(): LLMContext {
    return { ...this.currentContext };
  }

  /** Per-iteration evaluation units. */
  getIterations(): readonly EvalIteration[] {
    return this.iterations.map((it) => ({
      ...it,
      context: { ...it.context },
      decisions: it.decisions.map((d) => ({ ...d, args: { ...d.args } })),
      sources: [...it.sources],
    }));
  }

  /** Structured explanation — flat + per-iteration, everything for evaluation. */
  explain(): Explanation {
    const allDecisions = this.getDecisions();
    const toolNames = [...new Set(allDecisions.map((d) => d.toolName))];
    const allSources = this.getSources();
    const summary =
      allSources.length === 0
        ? `Agent responded directly without calling tools.`
        : `Agent called ${toolNames.join(', ')} (${allSources.length} call${
            allSources.length > 1 ? 's' : ''
          }), then responded based on the results.`;

    return {
      iterations: this.getIterations(),
      sources: allSources,
      claims: this.getClaims(),
      decisions: allDecisions,
      context: this.getContext(),
      summary,
    };
  }

  clear(): void {
    this.iterations = [];
    this.currentIterationDecisions = [];
    this.currentIterationSources = [];
    this.currentTurn = 0;
    this.input = undefined;
    this.currentIteration = -1;
    this.currentRuntimeStageId = undefined;
    this.currentContext = {};
  }
}
