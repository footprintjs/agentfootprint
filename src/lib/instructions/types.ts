/**
 * LLMInstruction types — co-located behavioral guidance and structured follow-ups for tools.
 *
 * Instructions fire when a tool returns a matching result. The framework injects
 * the instruction text into the LLM's recency window — right next to the tool result,
 * where the model pays the most attention.
 *
 * Two optional fields — fill in what you need:
 *   `text`: guidance appended to tool result (LLM reads this literally)
 *   `followUp`: structured next-action binding (framework formats as string)
 */

import type { ToolDefinition } from '../../types/tools';

// ── Tool Result Context ─────────────────────────────────────────────────

/**
 * Context passed to instruction predicates — the full tool execution result.
 *
 * Includes the tool's return value, any error state, execution latency,
 * and the original input for context-aware predicates.
 *
 * @example
 * ```typescript
 * // Access result content
 * when: (ctx) => ctx.content.status === 'denied'
 *
 * // Access error state (tool handler threw or returned error)
 * when: (ctx) => ctx.error?.code === 'TIMEOUT'
 *
 * // Access latency (slow tool response)
 * when: (ctx) => ctx.latencyMs > 5000
 *
 * // Access original input
 * when: (ctx) => ctx.input.region === 'eu'
 * ```
 */
export interface InstructionContext<T = unknown> {
  /** Tool result content — the value returned by the handler. */
  readonly content: T;
  /** Error info when the tool handler threw or returned `error: true`. */
  readonly error?: { code?: string; message: string };
  /** Tool execution time in milliseconds. */
  readonly latencyMs: number;
  /** Original input passed to the tool handler. */
  readonly input: Record<string, unknown>;
  /** Tool ID that produced this result. */
  readonly toolId: string;
}

// ── Follow-Up Binding ───────────────────────────────────────────────────

/**
 * Structured follow-up action — pre-resolves the next tool call with exact identifiers.
 *
 * The developer defines WHAT can be done next. The framework generates the
 * LLM-facing text via NarrativeTemplate. The LLM never needs to guess tool IDs
 * or fabricate parameter values.
 *
 * @example
 * ```typescript
 * // Full form
 * followUp: {
 *   toolId: 'get_execution_trace',
 *   params: (ctx) => ({ traceId: ctx.content.traceId }),
 *   description: 'Retrieve detailed denial reasoning',
 *   condition: 'User asks why or wants details',
 * }
 *
 * // With quickBind shorthand
 * followUp: quickBind('get_execution_trace', 'traceId')
 * ```
 */
export interface FollowUpBinding<T = unknown> {
  /** Target tool to call. Must exist in the agent's tool set (validated at build time). */
  readonly toolId: string;

  /**
   * Resolve parameters from the tool result context.
   * The returned object is passed directly to the target tool's handler.
   *
   * @example
   * ```typescript
   * params: (ctx) => ({ traceId: ctx.content.traceId })
   * ```
   */
  readonly params: (ctx: InstructionContext<T>) => Record<string, unknown>;

  /**
   * What this follow-up does — human-readable.
   * The framework uses this to generate injection text for the LLM.
   * Required because the LLM needs to understand the action to decide whether to offer it.
   *
   * @example 'Retrieve detailed denial reasoning'
   */
  readonly description: string;

  /**
   * When the LLM should offer this follow-up — human-readable.
   * Tells the LLM under what user intent to suggest or execute this action.
   *
   * @example 'User asks why their application was denied'
   */
  readonly condition: string;

  /**
   * When true, the framework auto-executes this follow-up when the condition matches,
   * bypassing the LLM for the tool call construction. The LLM is only brought back
   * to interpret the result. Prevents ID corruption on long alphanumeric identifiers.
   *
   * @default false
   */
  readonly strict?: boolean;
}

// ── LLM Instruction ─────────────────────────────────────────────────────

/**
 * An instruction for the LLM, co-located with a tool definition.
 *
 * Evaluated after the tool returns a result. When the `when` predicate matches,
 * the instruction is injected into the LLM's recency window — right next to the
 * tool result, where the model pays the most attention.
 *
 * `text` and `followUp` are optional — fill in what you need:
 *
 * @example
 * ```typescript
 * // Text guidance
 * { id: 'empathy', when: ctx => ctx.content.denied,
 *   text: 'Be empathetic. Do NOT promise reversal.' }
 *
 * // Structured follow-up
 * { id: 'details', when: ctx => ctx.content.denied,
 *   followUp: follow('get_denial_trace', ctx => ({ traceId: ctx.content.traceId }), 'Get details') }
 *
 * // Both text + follow-up
 * { id: 'flagged', when: ctx => ctx.content.flagged,
 *   text: 'Order flagged. Do NOT confirm shipment.',
 *   followUp: follow('get_fraud_report', ctx => ({ orderId: ctx.content.orderId }), 'View report') }
 *
 * // Error handling
 * { id: 'timeout', when: ctx => ctx.error?.code === 'TIMEOUT',
 *   inject: 'Service timed out. Apologize and suggest retry.' }
 *
 * // Safety — always position last in recency window (highest attention)
 * { id: 'pii', when: ctx => ctx.content.hasPII, safety: true,
 *   inject: 'Contains PII. Do NOT repeat raw values.' }
 * ```
 */
export interface LLMInstruction<T = unknown> {
  /** Unique instruction identifier. Used by InstructionRecorder and overrides. */
  readonly id: string;

  /**
   * Human-readable description of this instruction.
   * Used for: narrative, API docs, `previewInstructions()`, `generateToolGuide()`.
   * NOT injected into LLM — the `text` field is what the LLM sees.
   *
   * @example 'Guide LLM to be empathetic when loan is denied'
   */
  readonly description?: string;

  /**
   * Predicate: does this instruction apply to the tool result?
   * Must be synchronous and side-effect-free.
   * Receives the full InstructionContext (content, error, latency, input, toolId).
   *
   * When omitted, the instruction always fires (unconditional).
   */
  readonly when?: (ctx: InstructionContext<T>) => boolean;

  /**
   * Text appended to the tool result in the LLM's recency window.
   * Write actionable, specific guidance — the LLM reads this literally.
   *
   * Good: "Item out of stock. Suggest alternatives from the same category.
   *        Do NOT promise availability or restock dates."
   * Bad:  "Handle this appropriately."
   */
  readonly text?: string;

  /** Structured follow-up action the LLM can take. */
  readonly followUp?: FollowUpBinding<T>;

  /**
   * Priority for injection ordering. Lower number = injected first.
   * When multiple instructions fire, they are sorted by priority.
   * Ties are broken by array order in the `instructions` field.
   *
   * @default 0
   */
  readonly priority?: number;

  /**
   * When true, this instruction is never truncated by token budget
   * and is positioned LAST in the injection (closest to LLM generation,
   * highest attention weight). Use for safety-critical instructions.
   *
   * @default false
   */
  readonly safety?: boolean;
}

// ── Runtime Instructions ────────────────────────────────────────────────

/**
 * Runtime follow-up — returned by tool handler with pre-resolved params.
 *
 * Unlike build-time FollowUpBinding (which has a `params` function),
 * runtime follow-ups have already-resolved parameter values.
 *
 * @example
 * ```typescript
 * handler: async (input) => {
 *   const result = await service.evaluate(input);
 *   return {
 *     content: JSON.stringify(result),
 *     followUps: result.traceId ? [{
 *       toolId: 'get_trace',
 *       params: { traceId: result.traceId },
 *       description: 'Full denial reasoning trace',
 *       condition: 'User asks why',
 *     }] : [],
 *   };
 * }
 * ```
 */
export interface RuntimeFollowUp {
  readonly toolId: string;
  readonly params: Record<string, unknown>;
  readonly description: string;
  readonly condition: string;
  readonly strict?: boolean;
}

/**
 * Extended tool result that can carry runtime instructions and follow-ups.
 *
 * Tool handlers can return this instead of plain `ToolResult` to attach
 * context-aware guidance based on live system state.
 *
 * @example
 * ```typescript
 * handler: async (input) => {
 *   const result = await orderService.check(input);
 *   return {
 *     content: JSON.stringify(result),
 *     instructions: result.status === 'delayed'
 *       ? ['Delivery is delayed. Apologize and offer tracking link.']
 *       : [],
 *     followUps: result.trackingId ? [{
 *       toolId: 'track_package',
 *       params: { trackingId: result.trackingId },
 *       description: 'Track package location',
 *       condition: 'User asks about delivery status',
 *     }] : [],
 *   };
 * }
 * ```
 */
export interface InstructedToolResult {
  /** Tool result content (string for LLM consumption). */
  readonly content: string;
  /** Optional error flag. */
  readonly error?: boolean;
  /** Runtime behavioral instructions — injected as-is into recency window. */
  readonly instructions?: readonly string[];
  /** Runtime follow-up bindings with pre-resolved params. */
  readonly followUps?: readonly RuntimeFollowUp[];
}

// ── quickBind ───────────────────────────────────────────────────────────

/**
 * One-liner shorthand for common follow-up bindings.
 *
 * Most follow-ups follow a simple pattern: extract a field from the tool result
 * and pass it to a target tool with the same parameter name. `quickBind`
 * eliminates the boilerplate.
 *
 * @param toolId - Target tool to call
 * @param paramNames - Field name(s) to extract from `ctx.content` and pass to target tool.
 *   Single string or array of strings. The field name in the result must match
 *   the parameter name in the target tool.
 * @param options - Optional description and condition overrides.
 *
 * @example
 * ```typescript
 * // Single param — extract traceId from result, pass to get_trace
 * followUp: quickBind('get_execution_trace', 'traceId')
 *
 * // Equivalent to:
 * followUp: {
 *   toolId: 'get_execution_trace',
 *   params: (ctx) => ({ traceId: ctx.content.traceId }),
 *   description: 'Follow up with get_execution_trace',
 *   condition: 'User asks for more details',
 * }
 *
 * // Multiple params
 * followUp: quickBind('get_step_log', ['executionId', 'stepName'])
 *
 * // Custom description and condition
 * followUp: quickBind('get_trace', 'traceId', {
 *   description: 'Retrieve denial reasoning',
 *   condition: 'User asks why their application was denied',
 * })
 * ```
 */
export function quickBind(
  toolId: string,
  paramNames: string | string[],
  options?: { description?: string; condition?: string },
): FollowUpBinding {
  const names = Array.isArray(paramNames) ? paramNames : [paramNames];

  return {
    toolId,
    params: (ctx: InstructionContext) => {
      const result: Record<string, unknown> = {};
      const content = ctx.content as Record<string, unknown>;
      for (const name of names) {
        result[name] = content?.[name];
      }
      return result;
    },
    description: options?.description ?? `Follow up with ${toolId}`,
    condition: options?.condition ?? 'User asks for more details',
  };
}

/**
 * Create a FollowUp binding with explicit params function.
 *
 * Preferred over `quickBind` for computed parameters.
 *
 * @example
 * ```typescript
 * followUp: follow('get_trace', ctx => ({ traceId: ctx.content.traceId }), 'Get denial details')
 * ```
 */
export function follow<T = unknown>(
  toolId: string,
  params: (ctx: InstructionContext<T>) => Record<string, unknown>,
  description: string,
  condition?: string,
): FollowUpBinding<T> {
  return {
    toolId,
    params,
    description,
    condition: condition ?? 'User asks for more details',
  };
}

// ── Extended ToolDefinition ─────────────────────────────────────────────

/**
 * Tool definition with LLM instructions.
 *
 * Extends the base ToolDefinition with an optional `instructions` field
 * for co-located behavioral guidance and structured follow-ups.
 *
 * @example
 * ```typescript
 * const orderTool = defineTool({
 *   id: 'check_order',
 *   description: 'Check order status',
 *   inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
 *   handler: async ({ orderId }) => {
 *     const order = await orderService.get(orderId);
 *     return { content: JSON.stringify(order) };
 *   },
 *   instructions: [
 *     { id: 'cancelled', when: ctx => ctx.content.status === 'cancelled',
 *       text: 'Order cancelled. Be empathetic. Offer alternatives.' },
 *     { id: 'shipped', when: ctx => ctx.content.status === 'shipped',
 *       followUp: follow('track_package', ctx => ({ trackingId: ctx.content.trackingId }), 'Track package') },
 *     { id: 'pii', when: ctx => ctx.content.hasPII, safety: true,
 *       text: 'Contains PII. Do NOT repeat raw values to user.' },
 *   ],
 * });
 * ```
 */
/**
 * Tool definition with LLM instructions.
 * Extends base ToolDefinition — handler can return InstructedToolResult
 * with runtime instructions and follow-ups.
 */
export interface InstructedToolDefinition extends ToolDefinition {
  readonly instructions?: readonly LLMInstruction[];
}

// ── Instruction Overrides ───────────────────────────────────────────────

/**
 * Agent-level instruction override for a shared tool.
 *
 * Tools are shared across agents, npm packages, and teams. The tool author's
 * instructions are the baseline. Agent builders can suppress, add, or replace
 * instructions without modifying the tool definition.
 *
 * @example
 * ```typescript
 * Agent.create({ provider })
 *   .tool(sharedInventoryTool)
 *   .instructionOverride('check_inventory', {
 *     suppress: ['low-stock'],        // hide this instruction
 *     add: [{                          // add agent-specific instruction
 *       id: 'premium-oos',
 *       when: (ctx) => ctx.content.quantity === 0 && ctx.content.isPremium,
 *       inject: 'Premium item. Offer to notify when back in stock.',
 *     }],
 *     replace: {                       // change an existing instruction's inject text
 *       'out-of-stock': {
 *         inject: 'Unavailable. Suggest the B2B bulk channel instead.',
 *       },
 *     },
 *   })
 *   .build();
 * ```
 */
export interface InstructionOverride {
  /** Instruction IDs to suppress (remove from evaluation). */
  readonly suppress?: readonly string[];
  /** New instructions to add (evaluated after tool's own instructions). */
  readonly add?: readonly LLMInstruction[];
  /** Partial overrides for existing instructions (merge by ID). */
  readonly replace?: Readonly<Record<string, Partial<LLMInstruction>>>;
}
