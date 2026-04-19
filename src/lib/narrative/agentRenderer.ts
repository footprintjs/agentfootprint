/**
 * Agent NarrativeFormatter — LLM-optimized narrative for agent loop execution.
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

// Note: imports `NarrativeRenderer` (the deprecated alias) instead of
// `NarrativeFormatter` because the currently-installed footprintjs version
// does not yet export the new name. Migrate to `NarrativeFormatter` when
// the next footprintjs release is consumed (the two types are identical —
// `NarrativeRenderer` is a `type NarrativeRenderer = NarrativeFormatter`
// alias in footprintjs, marked `@deprecated`).
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
  EmitRenderContext,
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
  // Tool results can contain diagnostic fields the library injects for
  // debuggers — `expectedSchema`, `receivedArguments`, `escalation`,
  // `repeatedFailures`. Truncating at 80 hides those after the opening
  // `{"error":true,"message":"..."}` prefix, making it look like the LLM
  // is being fed a bare error when in fact it has all the context it needs
  // to self-correct. Bump to 400 so the fields are visible in BTS. Consumers
  // who want the raw content use `verbose: true` (Infinity).
  toolResult: 400,
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

/**
 * Format a single tool call as `name({...})` — always including the paren
 * group so that empty arguments render as `name({})` rather than `name`.
 *
 * This matters for debugging: when the LLM calls a tool with missing
 * required fields, the bug signal is precisely that `arguments` is `{}`
 * (or contains the wrong keys). Hiding that behind a bare `name` used to
 * make every failing-loop narrative look like a healthy one — you couldn't
 * tell that the args were empty until you dug into the raw snapshot.
 */
function formatToolCallSignature(
  tc: { name?: string; arguments?: Record<string, unknown> },
  limits: TruncationLimits,
): string {
  const name = tc.name ?? '?';
  const args = tc.arguments ?? {};
  const argsStr = JSON.stringify(args);
  return `${name}(${truncate(argsStr, limits.toolArgs)})`;
}

function formatParsedResponse(rawValue: unknown, limits: TruncationLimits): string {
  if (!rawValue || typeof rawValue !== 'object') return 'Parsed: (unknown)';
  const r = rawValue as {
    hasToolCalls?: boolean;
    content?: string;
    toolCalls?: Array<{ name?: string; arguments?: Record<string, unknown> }>;
  };
  if (r.hasToolCalls && Array.isArray(r.toolCalls)) {
    const toolSummaries = r.toolCalls.map((tc) => formatToolCallSignature(tc, limits));
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
    toolCalls?: Array<{ name?: string; arguments?: Record<string, unknown> }>;
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

  // Tool calls summary — include arguments so the reader can see at a glance
  // whether the LLM actually passed required fields. Previously this showed
  // only names, which hid the common failure mode where the LLM retries the
  // same call with empty / wrong arguments.
  if (r.toolCalls && r.toolCalls.length > 0) {
    const signatures = r.toolCalls.map((tc) => formatToolCallSignature(tc, limits)).join(', ');
    parts.push(`→ tool_calls: [${signatures}]`);
  }

  return parts.join('\n  ');
}

// ── Renderer factory ─────────────────────────────────────────────────────────

/**
 * Create an agent-optimized narrative formatter.
 *
 * Returns the `NarrativeRenderer` type (structurally identical to
 * footprintjs's new `NarrativeFormatter`). Once a newer footprintjs
 * release is consumed here, migrate the return type to
 * `NarrativeFormatter` — no behavioural change.
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

    /**
     * Custom render for agentfootprint's emit-channel events. Recognizes the
     * adapter-level request/response events and produces compact, diagnostic
     * narrative lines that surface the exact shape of what the adapter sent
     * and received — the key visibility for debugging LLM behavior like
     * "why is the model calling with empty args?".
     *
     * Returns `undefined` for unrecognized event names so the default
     * library template handles them.
     */
    renderEmit(ctx: EmitRenderContext): string | null | undefined {
      if (ctx.name === 'agentfootprint.llm.request') {
        const p = ctx.payload as {
          iteration: number;
          messageCount: number;
          messageRoles: string[];
          toolCount: number;
          toolNames: string[];
          toolsWithRequired: Array<{ name: string; description: string; required: string[] }>;
        };
        const toolsDetail = p.toolsWithRequired
          .map((t) => {
            const req = t.required.length ? ` required:[${t.required.join(',')}]` : '';
            return `${t.name}${req}`;
          })
          .join(', ');
        return (
          `LLM request (iter ${p.iteration}): ${p.messageCount} msgs [${p.messageRoles.join(
            ',',
          )}], ` + `${p.toolCount} tools — ${toolsDetail}`
        );
      }

      if (ctx.name === 'agentfootprint.llm.response') {
        const p = ctx.payload as {
          iteration: number;
          model?: string;
          stopReason?: string;
          usage?: { inputTokens?: number; outputTokens?: number };
          content?: string;
          toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
          latencyMs: number;
        };
        const usage = p.usage
          ? `${p.usage.inputTokens ?? '?'}in/${p.usage.outputTokens ?? '?'}out`
          : '';
        const stop = p.stopReason ? ` stop=${p.stopReason}` : '';
        const toolCallsDetail = p.toolCalls.length
          ? ` calls=[${p.toolCalls
              .map((tc) => `${tc.name}(${JSON.stringify(tc.arguments)})`)
              .join(', ')}]`
          : '';
        const contentPreview =
          p.content && p.content.length > 0
            ? ` content="${p.content.length > 60 ? p.content.slice(0, 57) + '...' : p.content}"`
            : '';
        return (
          `LLM response (iter ${p.iteration}, ${p.latencyMs}ms, ${usage}${stop}):` +
          `${contentPreview}${toolCallsDetail}`
        );
      }

      // Unrecognized event — fall back to default library template.
      return undefined;
    },
  };
}
