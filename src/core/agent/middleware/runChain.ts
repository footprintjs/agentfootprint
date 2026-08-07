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
 *
 * **A middleware that malfunctions is a denial too** (8.18.0). Two ways to
 * malfunction at the message boundary: answer `ask` where no pause exists to
 * carry it, or `allow` a value that is not text. Both used to fall through to
 * the allow branch — the ask filed an allow row for a rule that thought it had
 * paused, and the non-string became `content: undefined` on the wire. Same law,
 * same row: a link whose answer cannot be honoured has not permitted anything.
 *
 * **The result comes back through the onion.** `runToolAfterChain` walks the
 * SAME list in reverse, so the first-declared link gets the first word about
 * the call and the last word about the result. An outer rule is the one that
 * sees what every inner rule already did — which is the only order in which
 * "wrap" means anything.
 *
 * **A link that has no hook for a moment files no row.** It did not decide;
 * saying it allowed would be inventing a decision, and the ledger's whole
 * value is that a row means somebody looked.
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
  ToolResultOutcome,
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
  /** `Tool.source` for the tool being dispatched, when it has one. */
  readonly toolSource?: string;
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
    // A result-only link takes no part in dispatch — and files no row here,
    // because it did not decide anything about this call.
    if (typeof mw.onToolCall !== 'function') continue;
    const row = (extra: Partial<MiddlewareDecision>): MiddlewareDecision => ({
      middleware: mw.name,
      moment: 'before-tool',
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
        // Present only when the tool HAS a source. An `undefined` key is not
        // the same fact as an absent one to a middleware that spells its rule
        // `'toolSource' in call`, and "the agent's own" is an absence.
        ...(input.toolSource !== undefined && { toolSource: input.toolSource }),
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
      // `allow(undefined, why)` — nothing moved, and the link said why it was
      // comfortable. The reason belongs on the row of the call it permitted.
      decisions.push(row(outcome.why ? { why: outcome.why } : {}));
    }
  }

  return { kind: 'allow', args, decisions };
}

// ─── The after-tool moment ───────────────────────────────────────────

export type ToolAfterChainResult =
  | { readonly kind: 'allow'; readonly result: unknown; readonly decisions: MiddlewareDecision[] }
  | {
      readonly kind: 'deny';
      readonly reason: string;
      readonly middleware: string;
      /** The tool's REAL result. The side effect happened; the record says so. */
      readonly result: unknown;
      readonly decisions: MiddlewareDecision[];
    };

export interface ToolAfterChainInput {
  readonly toolName: string;
  readonly toolSource?: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The args the tool ACTUALLY ran with — every before-transform applied. */
  readonly args: ToolArgs;
  readonly result: unknown;
  /** `true` when the tool threw and `result` is the error's message. */
  readonly error?: true;
  readonly history: readonly LLMMessage[];
  readonly identity?: MemoryIdentity;
  readonly signal?: AbortSignal;
}

/**
 * Walk the chain BACKWARDS over a finished call. Never throws — a throwing
 * link becomes a denial, which at this moment means the model reads the
 * reason instead of the result.
 *
 * Only called for a call that actually executed. A call the chain denied, or
 * one still waiting on a person, has no result to decide about, and asking a
 * rule about a result that does not exist would be the same fabrication the
 * outcome union exists to prevent.
 */
export async function runToolAfterChain(
  chain: readonly ToolMiddleware[],
  input: ToolAfterChainInput,
): Promise<ToolAfterChainResult> {
  const decisions: MiddlewareDecision[] = [];
  const real = input.result;
  let result = real;

  // Reverse: first-declared saw the call first, so it sees the result last.
  for (let i = chain.length - 1; i >= 0; i--) {
    const mw = chain[i]!;
    const hook = mw.onToolResult;
    if (typeof hook !== 'function') continue;
    const row = (extra: Partial<MiddlewareDecision>): MiddlewareDecision => ({
      middleware: mw.name,
      moment: 'after-tool',
      at: 'tool',
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      iteration: input.iteration,
      outcome: 'allow',
      changed: false,
      ...extra,
    });

    let outcome: ToolResultOutcome;
    try {
      outcome = await hook.call(mw, {
        toolName: input.toolName,
        ...(input.toolSource !== undefined && { toolSource: input.toolSource }),
        toolCallId: input.toolCallId,
        iteration: input.iteration,
        args: input.args,
        result,
        ...(input.error === true && { error: true as const }),
        history: input.history,
        ...(input.identity && { identity: input.identity }),
        ...(input.signal && { signal: input.signal }),
      });
    } catch (err) {
      const reason = `middleware '${mw.name}' threw: ${
        err instanceof Error ? err.message : String(err)
      }`;
      decisions.push(
        row({ outcome: 'deny', changed: true, why: reason, before: result, after: reason }),
      );
      return { kind: 'deny', reason, middleware: mw.name, result: real, decisions };
    }

    if (outcome.kind === 'deny') {
      // `changed: true` on purpose: unlike a refusal before dispatch, this one
      // DOES replace something. The real result rides `before` — often the
      // only copy of it in the run.
      decisions.push(
        row({
          outcome: 'deny',
          changed: true,
          why: outcome.reason,
          before: result,
          after: outcome.reason,
        }),
      );
      return { kind: 'deny', reason: outcome.reason, middleware: mw.name, result: real, decisions };
    }

    if (outcome.value !== undefined) {
      const before = result;
      result = outcome.value;
      decisions.push(
        row({ changed: true, ...(outcome.why && { why: outcome.why }), before, after: result }),
      );
    } else {
      decisions.push(row(outcome.why ? { why: outcome.why } : {}));
    }
  }

  return { kind: 'allow', result, decisions };
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
      moment: input.phase,
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

    // `ask` at a message boundary (8.18.0). `MessageOutcome` has no ask arm, so
    // TypeScript refuses this at the call site — but a JS consumer, an `as any`,
    // or a shared link written for the TOOL chain reaches here at runtime, and
    // an ask used to fall straight through the value test below and file an
    // ALLOW row. A rule that believed it had paused for a person had in fact
    // approved the message, and the ledger agreed with the rule. The message
    // boundary is a plain stage with no pause to carry an ask, so the honest
    // answer is the one `askPolicy: 'refuse'` already gives the tool chain: a
    // denial, naming the middleware.
    if ((outcome as { kind?: string }).kind === 'ask') {
      const question = (outcome as unknown as { payload?: { question?: string } }).payload
        ?.question;
      const reason =
        `middleware '${mw.name}' asked a person to decide about the ${input.phase} message, ` +
        `and there is no pause at the message boundary to carry that ask` +
        `${question ? `: ${question}` : ''}. Ask at a TOOL moment (onToolCall), where a pause ` +
        `exists, or decide here with allow()/deny().`;
      decisions.push(row({ outcome: 'deny', why: reason }));
      return { kind: 'deny', reason, middleware: mw.name, content, decisions };
    }

    if (outcome.value !== undefined) {
      // A transform must produce a message. A link that returns a non-string
      // is malfunctioning, not permitting — and this file's law for a
      // malfunctioning link is already written: a middleware that throws is a
      // denial, never a pass. Before 8.18.0 the value was assigned anyway and
      // became `content: undefined`/an object on the wire, surfacing as
      // `s.slice is not a function` at the input phase and as an unattributed
      // "unexpected result shape" at the output phase.
      // Cast through `unknown`: the TYPE says `string`, which is exactly why
      // the check is here — the values that get this far are the ones the type
      // could not stop.
      if (typeof (outcome.value as unknown) !== 'string') {
        const reason =
          `middleware '${mw.name}' returned allow(${describeValue(outcome.value)}) at the ` +
          `${input.phase} message boundary, and a message is text. Return allow(someString, why) ` +
          `to rewrite it, allow() to pass it through unchanged, or deny(reason) to refuse it.`;
        decisions.push(row({ outcome: 'deny', why: reason }));
        return { kind: 'deny', reason, middleware: mw.name, content, decisions };
      }
      const before = content;
      content = outcome.value;
      decisions.push(
        row({ changed: true, ...(outcome.why && { why: outcome.why }), before, after: content }),
      );
    } else {
      decisions.push(row(outcome.why ? { why: outcome.why } : {}));
    }
  }

  return { kind: 'allow', content, decisions };
}

/** Name the SHAPE of a middleware's return for a refusal — never its contents. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
