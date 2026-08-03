/**
 * middleware/runChain — INTERNAL. The one place a chain is walked.
 *
 * Pattern: Chain of Responsibility driver.
 * Role:    core/ layer. Both stages (tool dispatch, message boundary) and
 *          the MCP server call in here, so the ordering law, the
 *          throw-is-a-denial law and the ledger row shape are written once
 *          and cannot drift between the three callers.
 * Emits:   N/A — it RETURNS rows; the caller commits and emits them, so a
 *          middleware still never touches scope.
 *
 * ## The rules this file implements
 *
 * **Order is declaration order.** The chain is walked front to back, and
 * each link is handed the previous link's output — so a scrubber placed
 * first is a scrubber every later rule sees the effect of.
 *
 * **The first non-allow answer wins.** A deny or an ask stops the walk;
 * the links behind it do not run. There is no "second opinion" pass,
 * because a refusal that a later middleware could overturn is not a
 * refusal.
 *
 * **A middleware that throws is a denial, never a pass.** The thrown
 * message becomes the reason. This is the same deny-by-default the
 * permission gate has always applied to a checker that throws: a
 * governance layer whose failure mode is "allow" is not a governance
 * layer.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { MemoryIdentity } from '../../../memory/identity/types.js';
import type {
  AskPayload,
  MessageMiddleware,
  MessageOutcome,
  MiddlewareDecision,
  ToolMiddleware,
  ToolOutcome,
} from './types.js';

/** Tool args, as they travel the chain. */
export type ToolArgs = Readonly<Record<string, unknown>>;

/**
 * What to do when a middleware answers `ask` somewhere that cannot pause.
 *
 * `'pause'` — the caller will checkpoint (the normal dispatch path).
 * `'refuse'` — the ask is converted into a deny naming the middleware. Used
 * on the resume path (footprintjs's `PausableHandler.resume` returns void,
 * so a resumed dispatch cannot suspend a second time) and by `mcpServe`
 * (MCP is request/response — there is no pause to carry the ask).
 */
export type AskPolicy = 'pause' | 'refuse';

export type ToolChainResult =
  | { readonly kind: 'allow'; readonly args: ToolArgs; readonly decisions: MiddlewareDecision[] }
  | {
      readonly kind: 'deny';
      readonly reason: string;
      readonly middleware: string;
      readonly args: ToolArgs;
      readonly decisions: MiddlewareDecision[];
    }
  | {
      readonly kind: 'ask';
      readonly payload: AskPayload;
      readonly middleware: string;
      /** Index of the link that asked — resume continues from `index + 1`. */
      readonly index: number;
      /** Args as transformed up to the ask. These ride the checkpoint. */
      readonly args: ToolArgs;
      readonly decisions: MiddlewareDecision[];
    };

export interface ToolChainInput {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly args: ToolArgs;
  readonly history: readonly LLMMessage[];
  readonly identity?: MemoryIdentity;
  readonly signal?: AbortSignal;
  /**
   * Where to start walking. `0` for a fresh dispatch; `n` on resume, to
   * continue the chain AFTER the link that asked without re-running the
   * links whose decisions the checkpoint already carries.
   */
  readonly startIndex?: number;
  readonly askPolicy?: AskPolicy;
}

/** Walk the tool chain. Never throws — a throwing link becomes a denial. */
export async function runToolChain(
  chain: readonly ToolMiddleware[],
  input: ToolChainInput,
): Promise<ToolChainResult> {
  const decisions: MiddlewareDecision[] = [];
  const askPolicy = input.askPolicy ?? 'pause';
  let args = input.args;

  for (let i = input.startIndex ?? 0; i < chain.length; i++) {
    const mw = chain[i]!;
    const row = (extra: Partial<MiddlewareDecision>): MiddlewareDecision => ({
      middleware: mw.name,
      at: 'tool',
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      iteration: input.iteration,
      outcome: 'allow',
      changed: false,
      ...extra,
    });

    let outcome: ToolOutcome;
    try {
      outcome = await mw.onToolCall({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        iteration: input.iteration,
        args,
        history: input.history,
        ...(input.identity && { identity: input.identity }),
        ...(input.signal && { signal: input.signal }),
      });
    } catch (err) {
      const reason = `middleware '${mw.name}' threw: ${
        err instanceof Error ? err.message : String(err)
      }`;
      decisions.push(row({ outcome: 'deny', why: reason }));
      return { kind: 'deny', reason, middleware: mw.name, args, decisions };
    }

    if (outcome.kind === 'deny') {
      decisions.push(row({ outcome: 'deny', why: outcome.reason }));
      return { kind: 'deny', reason: outcome.reason, middleware: mw.name, args, decisions };
    }

    if (outcome.kind === 'ask') {
      if (askPolicy === 'refuse') {
        const reason =
          `middleware '${mw.name}' asked a person to decide, and there is no pause here to ` +
          `carry that ask: ${outcome.payload.question}`;
        decisions.push(row({ outcome: 'deny', why: reason }));
        return { kind: 'deny', reason, middleware: mw.name, args, decisions };
      }
      decisions.push(row({ outcome: 'ask', why: outcome.payload.question }));
      return {
        kind: 'ask',
        payload: outcome.payload,
        middleware: mw.name,
        index: i,
        args,
        decisions,
      };
    }

    if (outcome.value !== undefined) {
      const before = args;
      args = outcome.value;
      decisions.push(
        row({ changed: true, ...(outcome.why && { why: outcome.why }), before, after: args }),
      );
    } else {
      decisions.push(row({}));
    }
  }

  return { kind: 'allow', args, decisions };
}

// ─── Message chain ───────────────────────────────────────────────────

export type MessageChainResult =
  | { readonly kind: 'allow'; readonly content: string; readonly decisions: MiddlewareDecision[] }
  | {
      readonly kind: 'deny';
      readonly reason: string;
      readonly middleware: string;
      /** Content as transformed by the links BEFORE the refusal. */
      readonly content: string;
      readonly decisions: MiddlewareDecision[];
    };

export interface MessageChainInput {
  readonly phase: 'input' | 'output';
  readonly content: string;
  readonly history: readonly LLMMessage[];
  /** ReAct iteration for the ledger row. `0` at `'input'` (before iter 1). */
  readonly iteration: number;
  readonly identity?: MemoryIdentity;
  readonly signal?: AbortSignal;
}

/** Walk the message chain. Never throws — a throwing link becomes a denial. */
export async function runMessageChain(
  chain: readonly MessageMiddleware[],
  input: MessageChainInput,
): Promise<MessageChainResult> {
  const decisions: MiddlewareDecision[] = [];
  let content = input.content;

  for (const mw of chain) {
    const row = (extra: Partial<MiddlewareDecision>): MiddlewareDecision => ({
      middleware: mw.name,
      at: 'message',
      phase: input.phase,
      iteration: input.iteration,
      outcome: 'allow',
      changed: false,
      ...extra,
    });

    let outcome: MessageOutcome;
    try {
      outcome = await mw.onMessage({
        phase: input.phase,
        content,
        history: input.history,
        ...(input.identity && { identity: input.identity }),
        ...(input.signal && { signal: input.signal }),
      });
    } catch (err) {
      const reason = `middleware '${mw.name}' threw: ${
        err instanceof Error ? err.message : String(err)
      }`;
      decisions.push(row({ outcome: 'deny', why: reason }));
      return { kind: 'deny', reason, middleware: mw.name, content, decisions };
    }

    if (outcome.kind === 'deny') {
      decisions.push(row({ outcome: 'deny', why: outcome.reason }));
      return { kind: 'deny', reason: outcome.reason, middleware: mw.name, content, decisions };
    }

    if (outcome.value !== undefined) {
      const before = content;
      content = outcome.value;
      decisions.push(
        row({ changed: true, ...(outcome.why && { why: outcome.why }), before, after: content }),
      );
    } else {
      decisions.push(row({}));
    }
  }

  return { kind: 'allow', content, decisions };
}
