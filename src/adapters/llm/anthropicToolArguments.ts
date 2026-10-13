/**
 * Role: one completed-JSON owner for Anthropic streamed tool arguments.
 * Consumes already-decoded events; it neither frames SSE nor assembles a
 * message. Original block positions, not provider IDs, associate evidence.
 */
import type { LLMResponse } from '../types.js';

type Failure = NonNullable<LLMResponse['toolCalls'][number]['argumentsFailure']>;
type ToolBlock = { readonly id: string; readonly name: string; readonly input: unknown };
interface ArgumentsBlock {
  readonly id: string;
  readonly name: string;
  readonly initial: unknown;
  readonly parts: string[];
  closed: boolean;
  invalid: boolean;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse once at the completed block boundary; schema validation remains upstream. */
function completedArguments(
  parts: readonly string[],
  initial: unknown,
): {
  input: Record<string, unknown>;
  failure?: Failure;
} {
  let input: unknown = initial;
  if (parts.length > 0) {
    try {
      input = JSON.parse(parts.join(''));
    } catch {
      return { input: {}, failure: { reason: 'invalid-json' } };
    }
  }
  if (!object(input)) return { input: {}, failure: { reason: 'invalid-argument-shape' } };
  return { input };
}

/** Per-response raw argument evidence, shared by SDK and fetch adapters. */
export class AnthropicToolArguments {
  private readonly blocks = new Map<number, ArgumentsBlock>();
  private readonly starts = new Set<number>();
  private observedTool = false;
  private ended = false;
  private invalid = false;

  /** Record only the protocol facts needed to judge a tool's completed JSON. */
  observe(event: unknown): void {
    if (!object(event)) return;
    if (event.type === 'message_stop') {
      if (this.ended) this.invalid = true;
      this.ended = true;
      return;
    }
    if (
      !['content_block_start', 'content_block_delta', 'content_block_stop'].includes(
        String(event.type),
      )
    )
      return;
    if (
      event.type === 'content_block_start' &&
      object(event.content_block) &&
      event.content_block.type === 'tool_use'
    )
      this.observedTool = true;
    const index = event.index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      this.invalid = true;
      return;
    }
    if (this.ended) this.invalid = true;
    if (event.type === 'content_block_start') {
      if (this.starts.has(index)) {
        this.invalid = true;
        return;
      }
      this.starts.add(index);
      const block = event.content_block;
      if (
        object(block) &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        this.blocks.set(index, {
          id: block.id,
          name: block.name,
          initial: block.input,
          parts: [],
          closed: false,
          invalid: false,
        });
      }
      return;
    }
    const block = this.blocks.get(index);
    if (event.type === 'content_block_stop') {
      if (!this.starts.has(index)) this.invalid = true;
      if (block) {
        if (block.closed) block.invalid = true;
        block.closed = true;
      }
      return;
    }
    const delta = event.delta;
    if (object(delta) && delta.type === 'input_json_delta') {
      if (!block) {
        this.invalid = true;
        return;
      }
      if (block.closed || typeof delta.partial_json !== 'string') block.invalid = true;
      else block.parts.push(delta.partial_json);
    } else if (
      block &&
      object(delta) &&
      ['text_delta', 'thinking_delta', 'signature_delta', 'citations_delta'].includes(
        String(delta.type),
      )
    )
      block.invalid = true;
  }

  /** EOF/abort is not a completed response, even if an SDK exposes a partial object. */
  assertTerminal(hasFinalTools = false): void {
    if (!this.ended && (hasFinalTools || this.observedTool))
      throw new Error(
        'Anthropic stream ended without message_stop; no completed response is available.',
      );
  }

  /** A finite refusal, never an SDK's partial/repaired object, for unsafe input. */
  finish(
    index: number,
    tool: ToolBlock,
  ): { input: Record<string, unknown>; failure?: Failure; raw: string } {
    const block = this.blocks.get(index);
    const raw = block?.parts.join('') ?? '';
    if (
      this.invalid ||
      !block ||
      !block.closed ||
      block.invalid ||
      block.id !== tool.id ||
      block.name !== tool.name
    ) {
      return { input: {}, failure: { reason: 'incomplete-stream' }, raw };
    }
    return { ...completedArguments(block.parts, block.initial), raw };
  }
}
