/**
 * Agent NarrativeRenderer — LLM-optimized narrative for agent loop execution.
 *
 * Designed for LLM follow-up reasoning: the narrative answers "what happened?"
 * so a downstream LLM can ask informed questions about the agent's execution.
 *
 * Key design decisions:
 *   1. Enrichment keys (llmCall, responseType, resolvedTools, promptSummary)
 *      are promoted — their values ARE the narrative, shown directly.
 *   2. Internal keys (memory_*, loopCount, adapter internals) are suppressed.
 *   3. Core keys (messages, result) get smart formatting with counts/previews.
 *   4. Most reads are suppressed — writes tell the story, reads are noise.
 *      Exception: `parsedResponse` reads are shown in tool execution (tool names + args).
 *   5. Stage headers use agent terminology, not generic "The process began."
 *   6. Subflow boundaries use slot names: "Preparing system prompt."
 *   7. Loop/break use agent language: "Tool loop iteration N", "Agent completed."
 *
 * The entry types (stage, step, subflow, loop, break, error, condition, fork,
 * selector) and stageId/subflowId fields are preserved by the recorder — the
 * renderer only controls the text. Time-travel UI sync is unaffected.
 */

import type {
  NarrativeRenderer,
  StageRenderContext,
  OpRenderContext,
  SubflowRenderContext,
  LoopRenderContext,
  BreakRenderContext,
  ErrorRenderContext,
  DecisionRenderContext,
  ForkRenderContext,
  SelectedRenderContext,
} from 'footprintjs/recorders';

// ── Stage name → agent-specific label ────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  Seed: 'Initialized agent state',
  ResolvePrompt: 'Resolved system prompt',
  LoadHistory: 'Loaded conversation history',
  ApplyStrategy: 'Applied message strategy',
  TrackPrepared: 'Tracked prepared messages',
  ResolveTools: 'Resolved available tools',
  AssemblePrompt: 'Assembled final prompt',
  CallLLM: 'Called LLM',
  ParseResponse: 'Parsed LLM response',
  ExecuteToolCalls: 'Executed tool calls',
  HandleResponse: 'Processed response',
  CommitMemory: 'Committed conversation history',
  // Swarm-specific stages
  RouteSpecialist: 'Route to specialist',
  ExecuteExtraTool: 'Executed extra tool',
  Finalize: 'Extract final answer and stop the loop',
};

// ── Subflow name → agent-specific entry label ────────────────────────────────

const SUBFLOW_ENTRY_LABELS: Record<string, string> = {
  SystemPrompt: 'Preparing system prompt',
  Messages: 'Preparing conversation history',
  Tools: 'Resolving available tools',
  PrepareMemory: 'Preparing memory',
  ExecuteTools: 'Executing tool calls',
};

// ── Promoted keys: pre-formatted enrichment summaries ────────────────────────

const PROMOTED_LABELS: Record<string, string> = {
  llmCall: 'LLM',
  responseType: 'Response',
  resolvedTools: 'Tools',
  promptSummary: 'Prompt',
  // SlotDecision labels — shown when non-static (dynamic providers explain their choice)
  promptDecision: 'Chose',
  toolDecision: 'Chose',
  specialistResult: 'Specialist returned',
};

// ── Suppressed keys: true internals that add noise, not insight ──────────────
//
// Design principle: suppress ONLY implementation plumbing. If an LLM reading
// this trace would need the value to answer a follow-up question, don't suppress.

const SUPPRESSED_KEYS = new Set([
  // Loop control (the loop entry itself shows iteration count)
  'loopCount',
  'maxIterations',
  'updatedLoopCount',
  // Memory internals (memory subflow stages already narrate this)
  'memory_preparedMessages',
  'memory_storedHistory',
  'memory_shouldCommit',
  // adapterResult is redundant with parsedResponse
  'adapterResult',
  // adapterRawResponse is now shown — contains LLM reasoning + token usage
  // Swarm internals (the decision is shown by RouteSpecialist, not these keys)
  'specialistMessage',
  'specialistToolCallId',
  // Subflow intermediate state
  'currentMessages',
  // Enrichment summaries (avoid double-reporting — the promoted labels above show these)
  'llmCall',
  'responseType',
  'resolvedTools',
  'promptSummary',
]);

// ── Options ──────────────────────────────────────────────────────────────────

export interface AgentRendererOptions {
  /**
   * When true, shows full values instead of truncated previews.
   * System prompts, tool results, LLM outputs, and parsed responses
   * are shown in full for debugging and grounding analysis.
   * @default false
   */
  verbose?: boolean;
}

// ── Truncation config ────────────────────────────────────────────────────────

interface TruncationLimits {
  result: number;
  systemPrompt: number;
  parsedContent: number;
  toolResult: number;
  toolArgs: number;
  message: number;
}

const DEFAULT_LIMITS: TruncationLimits = {
  result: 100,
  systemPrompt: 200,
  parsedContent: 100,
  toolResult: 80,
  toolArgs: 60,
  message: 100,
};

const VERBOSE_LIMITS: TruncationLimits = {
  result: Infinity,
  systemPrompt: Infinity,
  parsedContent: Infinity,
  toolResult: Infinity,
  toolArgs: Infinity,
  message: Infinity,
};

function truncate(value: string, max: number): string {
  if (max === Infinity || value.length <= max) return value;
  return value.slice(0, max) + '...';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMessages(rawValue: unknown): string {
  if (!Array.isArray(rawValue)) return 'Messages: (empty)';
  const messages = rawValue as Array<{ role?: string }>;
  const count = messages.length;
  if (count === 0) return 'Messages: (empty)';

  const roles = new Map<string, number>();
  for (const m of messages) {
    const role = m.role ?? 'unknown';
    roles.set(role, (roles.get(role) ?? 0) + 1);
  }
  const breakdown = [...roles.entries()].map(([r, n]) => `${n} ${r}`).join(', ');
  return `Messages: ${count} (${breakdown})`;
}

function formatResult(rawValue: unknown, limits: TruncationLimits): string {
  if (typeof rawValue !== 'string') return 'Result: (non-string)';
  if (rawValue.length === 0) return 'Result: (empty)';
  return `Result: "${truncate(rawValue, limits.result)}"`;
}

function formatSystemPrompt(rawValue: unknown, limits: TruncationLimits): string {
  if (typeof rawValue !== 'string' || rawValue.length === 0) return 'System prompt: (none)';
  return `System prompt: "${truncate(rawValue, limits.systemPrompt)}"`;
}

function formatToolDescriptions(rawValue: unknown): string {
  if (!Array.isArray(rawValue) || rawValue.length === 0) return 'Tools: (none)';
  const names = rawValue.map((t: { name?: string }) => t.name ?? '?').join(', ');
  return `Tools: [${names}]`;
}

function formatParsedResponse(rawValue: unknown, limits: TruncationLimits): string {
  if (!rawValue || typeof rawValue !== 'object') return 'Parsed: (unknown)';
  const r = rawValue as {
    hasToolCalls?: boolean;
    content?: string;
    toolCalls?: Array<{ name?: string; arguments?: Record<string, unknown> }>;
  };
  if (r.hasToolCalls && Array.isArray(r.toolCalls)) {
    const toolSummaries = r.toolCalls.map((tc) => {
      const name = tc.name ?? '?';
      if (tc.arguments && Object.keys(tc.arguments).length > 0) {
        const argsStr = JSON.stringify(tc.arguments);
        return `${name}(${truncate(argsStr, limits.toolArgs)})`;
      }
      return name;
    });
    return `Parsed: tool_calls → [${toolSummaries.join(', ')}]`;
  }
  if (typeof r.content === 'string') {
    return `Parsed: final → "${truncate(r.content, limits.parsedContent)}"`;
  }
  return 'Parsed: (unknown)';
}

function formatToolResultMessages(rawValue: unknown, limits: TruncationLimits): string {
  if (!Array.isArray(rawValue) || rawValue.length === 0) return 'Tool results: (none)';
  const results = rawValue as Array<{ content?: string; role?: string }>;
  const summaries = results.map((msg) => {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return `"${truncate(content, limits.toolResult)}"`;
  });
  return `Tool results: ${summaries.join('; ')}`;
}

function formatAdapterRawResponse(rawValue: unknown, limits: TruncationLimits): string {
  if (!rawValue || typeof rawValue !== 'object') return 'LLM response: (unknown)';
  const r = rawValue as {
    content?: string;
    toolCalls?: Array<{ name?: string }>;
    usage?: { inputTokens?: number; outputTokens?: number };
    model?: string;
  };

  const parts: string[] = [];

  // Model + tokens
  if (r.model || r.usage) {
    const model = r.model ?? 'unknown';
    const usage = r.usage
      ? `${r.usage.inputTokens ?? '?'}in / ${r.usage.outputTokens ?? '?'}out`
      : '';
    parts.push(`LLM: ${model}${usage ? ` (${usage})` : ''}`);
  }

  // LLM reasoning text (the key insight — why it chose to call tools)
  if (r.content && r.content.length > 0) {
    parts.push(`Reasoning: "${truncate(r.content, limits.parsedContent)}"`);
  }

  // Tool calls summary
  if (r.toolCalls && r.toolCalls.length > 0) {
    const names = r.toolCalls.map((tc) => tc.name ?? '?').join(', ');
    parts.push(`→ tool_calls: [${names}]`);
  }

  return parts.join('\n  ');
}

// ── Renderer factory ─────────────────────────────────────────────────────────

/**
 * Create an agent-optimized NarrativeRenderer.
 *
 * Usage:
 * ```typescript
 * import { createAgentRenderer } from 'agentfootprint';
 *
 * executor.enableNarrative({ renderer: createAgentRenderer() });
 * ```
 *
 * Or with the narrative() factory:
 * ```typescript
 * import { narrative } from 'footprintjs/recorders';
 * import { createAgentRenderer } from 'agentfootprint';
 *
 * const rec = narrative({ renderer: createAgentRenderer() });
 * ```
 */
export function createAgentRenderer(options?: AgentRendererOptions): NarrativeRenderer {
  const limits = options?.verbose ? VERBOSE_LIMITS : DEFAULT_LIMITS;

  return {
    renderStage(ctx: StageRenderContext): string {
      const label = STAGE_LABELS[ctx.stageName];
      if (label) return `[${ctx.stageName}] ${label}`;
      // Unknown stage — use description if available
      if (ctx.description) return `[${ctx.stageName}] ${ctx.description}`;
      return `[${ctx.stageName}]`;
    },

    renderOp(ctx: OpRenderContext): string | null {
      const { key, type, rawValue, operation } = ctx;

      // Suppress all reads — writes tell the story.
      // parsedResponse is already shown at the ParseResponse write stage.
      if (type === 'read') return null;

      // Suppress internal keys
      if (SUPPRESSED_KEYS.has(key)) return null;

      // Promoted keys: their value IS the narrative
      if (PROMOTED_LABELS[key]) {
        // Suppress when value is undefined/null (e.g., static providers don't set decision keys)
        if (rawValue == null) return null;
        return `${PROMOTED_LABELS[key]}: ${String(rawValue)}`;
      }

      // Delete operation
      if (operation === 'delete') return `Cleared ${key}`;

      // ── Key-specific formatters (actual values for LLM context) ──
      if (key === 'messages') return formatMessages(rawValue);
      if (key === 'result') return formatResult(rawValue, limits);
      if (key === 'systemPrompt') return formatSystemPrompt(rawValue, limits);
      if (key === 'toolDescriptions') return formatToolDescriptions(rawValue);
      if (key === 'parsedResponse') return formatParsedResponse(rawValue, limits);
      if (key === 'toolResultMessages') return formatToolResultMessages(rawValue, limits);
      if (key === 'adapterRawResponse') return formatAdapterRawResponse(rawValue, limits);

      // message (singular): user input in subflow mode
      if (key === 'message' && typeof rawValue === 'string') {
        return `User: "${truncate(rawValue, limits.message)}"`;
      }

      // Default: simple write summary
      return `${operation === 'update' ? 'Updated' : 'Set'} ${key} = ${ctx.valueSummary}`;
    },

    renderSubflow(ctx: SubflowRenderContext): string {
      if (ctx.direction === 'exit') return `Done: ${ctx.name}`;
      return SUBFLOW_ENTRY_LABELS[ctx.name] ?? `Entering ${ctx.name}`;
    },

    renderLoop(ctx: LoopRenderContext): string {
      return `Tool loop iteration ${ctx.iteration}: re-calling LLM`;
    },

    renderBreak(ctx: BreakRenderContext): string {
      return `Agent completed at ${ctx.stageName}`;
    },

    renderError(ctx: ErrorRenderContext): string {
      let text = `Error at ${ctx.stageName}: ${ctx.message}`;
      if (ctx.validationIssues) text += ` (${ctx.validationIssues})`;
      return text;
    },

    renderDecision(ctx: DecisionRenderContext): string {
      // Keep it concise — the stage header already has the description.
      // Only add rationale if it differs from the description.
      if (ctx.rationale && ctx.rationale !== ctx.description) {
        return `Chose ${ctx.chosen} (${ctx.rationale})`;
      }
      return `Chose ${ctx.chosen}`;
    },

    renderFork(ctx: ForkRenderContext): string {
      return `Parallel: ${ctx.children.join(', ')}`;
    },

    renderSelected(ctx: SelectedRenderContext): string {
      return `Selected ${ctx.selected.length}/${ctx.total}: ${ctx.selected.join(', ')}`;
    },
  };
}
