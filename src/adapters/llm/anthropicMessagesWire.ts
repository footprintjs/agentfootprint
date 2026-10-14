/**
 * anthropicMessagesWire — the Anthropic Messages body, spoken by more than one
 * transport.
 *
 * Pattern: shared pure helpers (no I/O). Role: outer ring, below the adapters.
 *
 * Two adapters put the SAME body on different wires:
 *   - `browserAnthropic()` — POST api.anthropic.com/v1/messages, with a `model`
 *     field and an `anthropic-version` header;
 *   - `invokeModelGateway()` — POST {gateway}/model/{id}/invoke, with NO `model`
 *     field (the id is in the path) and `anthropic_version` in the body.
 *
 * Everything else — `system` as a top-level field, content blocks, `tool_use` /
 * `tool_result`, thinking blocks, cache markers, the SSE event sequence — is one
 * shape, so it has ONE owner here instead of a copy per adapter. The functions
 * were moved out of `BrowserAnthropicProvider.ts` unchanged; its tests pin them.
 *
 * Deliberately NOT here: the transport (URL, headers, fetch, status handling)
 * and the SSE framing (the browser adapter reads `event:` lines; a gateway that
 * decoded AWS's binary framing may send bare `data:` lines). Each adapter turns
 * its bytes into {@link AnthropicStreamEvent}s and hands them to
 * {@link assembleAnthropicStream}.
 */

import type { LLMChunk, LLMRequest, LLMResponse } from '../types.js';
import { applyCacheMarkers, readCacheUsage } from './anthropicCacheWire.js';
import { anthropicTakesForcedToolChoice } from './anthropicModels.js';
import { UnsupportedToolChoiceError } from '../forcedToolChoice.js';
import { UnsupportedNativeOutputError } from '../nativeOutputSchema.js';
import { anthropicThinkingPlan, type AnthropicThinkingParam } from './anthropicThinkingWire.js';
import type { WireToolManifest } from './wireManifest.js';
import type { ThinkingMode } from '../../thinking/types.js';
import type { MessageReplay, ThinkingReplayOmission } from '../../thinking/replay.js';
import { captureAnthropicResponseReplay, lossyAnthropicReplay } from './anthropicReplayLayout.js';
import { toAnthropicMessages, toAnthropicTool } from './anthropicMessageProjection.js';
import { AnthropicToolArguments } from './anthropicToolArguments.js';
export { toAnthropicMessages, toAnthropicTool } from './anthropicMessageProjection.js';

// ─── Types (Anthropic API shapes) ──────────────────────────────────

/** The Messages body WITHOUT `model` — each transport adds its own framing. */
export interface AnthropicMessagesBody {
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  stop_sequences?: string[];
  // Present when the request asks to think — in the shape the MODEL takes
  // (anthropicThinkingWire.ts): a budget, or adaptive.
  thinking?: AnthropicThinkingParam;
  // Emitted only when `parallelToolCalls: false`, or for a forced choice.
  tool_choice?: { type: 'auto'; disable_parallel_tool_use: true } | { type: 'tool'; name: string };
  // Emitted only for `LLMRequest.outputFormat` (`.outputSchema(s, { strategy:
  // 'native' })`) — Anthropic's structured outputs. Absent on every other body.
  output_config?: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
}

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string; citations?: null | readonly [] }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
      caller?: { readonly type: 'direct' };
      toolset_name?: null;
    }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // v2.14 — extended-thinking blocks. Round-trip on assistant turns
  // when continuing a tool-using extended-thinking conversation;
  // signature MUST be byte-exact or Anthropic returns HTTP 400.
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string };

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessage {
  id: string;
  model: string;
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    // Cache traffic — present only when the request carried cache_control.
    // Absent means "no caching asked for", never zero. See anthropicCacheWire.
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** One decoded stream event: its name (the SSE `event:` line, or the JSON's `type`) and its data. */
export interface AnthropicStreamEvent {
  readonly event: string;
  readonly data: unknown;
}

// ─── Request ────────────────────────────────────────────────────────

/** How one adapter wants its Messages body built. */
export interface MessagesBodyOptions {
  /** The model the request goes to, the adapter's shorthand already resolved. */
  readonly model: string;
  /**
   * The adapter's ONE mode function — the very one it declares as
   * `LLMProvider.thinkingMode` (`thinkingModeWith`, anthropicThinkingWire.ts) —
   * so the shape sent is the shape the agent checked.
   */
  readonly thinkingMode: (model: string) => ThinkingMode;
  /** The adapter's name, for the refusals the thinking plan raises. */
  readonly provider: string;
  /** `max_tokens` when the request sets none. */
  readonly maxTokensDefault: number;
  /** `false` caps a reply at one tool call. */
  readonly parallelToolCalls?: boolean;
  /**
   * The adapter's declared `supportsNativeOutputSchema` — whether `model`
   * takes `output_config.format`. ABSENT means the adapter does not carry the
   * format at all (`invokeModelGateway()` in this release), so a request that
   * asks for one is refused by name rather than sent without it.
   */
  readonly nativeOutputSchema?: (model: string) => boolean;
}

/**
 * Build the Messages body (minus `model`) from a framework request.
 *
 * ONE owner: `anthropic()`, `browserAnthropic()` and `invokeModelGateway()`
 * all build their body here, so a rule about the body — like which thinking
 * shape a model takes — is written once.
 *
 * @throws UnsupportedThinkingError before anything is sent, when the request
 *   asks to think in a way the model cannot take (see `anthropicThinkingPlan`).
 */
export function buildMessagesBody(
  req: LLMRequest,
  options: MessagesBodyOptions,
): AnthropicMessagesBody {
  // The thinking shape THIS model takes, and the `max_tokens` it needs (kept
  // above the budget). Undefined when the request does not ask to think.
  const thinking = anthropicThinkingPlan(req, options);
  // This wire sends a forced choice only when tools are present. Resolve the
  // same model facts the adapter declares, before any request reaches transport.
  if (
    req.toolChoice !== undefined &&
    (req.tools?.length ?? 0) > 0 &&
    !anthropicTakesForcedToolChoice(options.model)
  ) {
    throw new UnsupportedToolChoiceError({ provider: options.provider, model: options.model });
  }
  // Same rule for the structured-output format: refused before transport,
  // never dropped — a format that quietly vanishes is an unconstrained answer
  // the config says was constrained.
  if (req.outputFormat !== undefined && options.nativeOutputSchema?.(options.model) !== true) {
    throw new UnsupportedNativeOutputError({ provider: options.provider, model: options.model });
  }
  // The map is only needed when a messages marker has to be placed; building
  // it always keeps the transform single-pass and costs one number per message.
  const messageIndexMap: number[] = [];
  const body: AnthropicMessagesBody = {
    max_tokens: thinking?.maxTokens ?? req.maxTokens ?? options.maxTokensDefault,
    messages: toAnthropicMessages(req.messages, messageIndexMap),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toAnthropicTool);
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop_sequences = [...req.stop];
  if (thinking !== undefined) body.thinking = thinking.thinking;
  // One tool per reply, enforced by the API rather than asked for in prose.
  // `auto` leaves the CHOICE of tool (and of calling one at all) with the
  // model — only the COUNT is capped. Guarded on `body.tools`: Anthropic
  // rejects `tool_choice` on a request that carries no tools, and an agent's
  // final answer call often has none.
  if (options.parallelToolCalls === false && body.tools !== undefined && body.tools.length > 0) {
    body.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
  }
  // Forced choice of one named tool (`.outputSchema(s, { strategy:
  // 'tool-forced' })`). Written LAST so it wins over the parallel cap:
  // capping how many tools a reply may use is a preference, constraining
  // WHICH tool answers is the contract the run is built on. Same guard.
  if (req.toolChoice && body.tools !== undefined && body.tools.length > 0) {
    body.tool_choice = { type: 'tool', name: req.toolChoice.name };
  }
  // The structured-output format (`strategy: 'native'`), as the agent built
  // it (`core/agent/nativeOutputFormat.ts`): sent as-is, never re-shaped here.
  // `output_config.format` — the GA field; the deprecated `output_format`
  // needs a beta header and is never sent.
  if (req.outputFormat !== undefined) {
    body.output_config = {
      format: {
        type: 'json_schema',
        schema: req.outputFormat.schema as Record<string, unknown>,
      },
    };
  }
  // Cache markers — applied AFTER body construction so the materialized
  // fields (system / tools / messages) exist to mark. Clamped to the declared
  // `maxBreakpoints` (four) by BreakpointCacheStrategy before we get here.
  if (req.cacheMarkers && req.cacheMarkers.length > 0) {
    applyCacheMarkers(body, req.cacheMarkers, messageIndexMap);
  }
  return body;
}

// ─── Response ───────────────────────────────────────────────────────

export function fromAnthropicResponse(
  message: AnthropicMessage,
  binding?: MessageReplay['binding'],
  argumentFailures?: ReadonlyMap<
    number,
    NonNullable<LLMResponse['toolCalls'][number]['argumentsFailure']>
  >,
): LLMResponse {
  const textParts: string[] = [];
  const toolCalls: LLMResponse['toolCalls'][number][] = [];
  // v2.14 — detect thinking presence so we can pass the full content
  // array through as `rawThinking` for the framework's thinking subflow
  // (handler filters thinking + redacted_thinking blocks; ignores rest).
  let hasThinking = false;
  for (const [index, block] of message.content.entries()) {
    if (block.type === 'text') textParts.push(block.text);
    else if (block.type === 'tool_use') {
      const argumentsFailure = argumentFailures?.get(index);
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input,
        ...(argumentsFailure !== undefined && { argumentsFailure }),
      });
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      hasThinking = true;
    }
  }
  // A server-side router can serve a different model. The request hashes were
  // captured before I/O, but only the returned model identifies their origin.
  const actualModel = typeof message.model === 'string' ? message.model : '';
  const originBinding =
    binding === undefined || binding.model === actualModel
      ? binding
      : { ...binding, model: actualModel };
  const replay = argumentFailures?.size
    ? lossyAnthropicReplay(message.content, message.id, message.stop_reason, originBinding)
    : captureAnthropicResponseReplay(
        message.content,
        message.id,
        message.stop_reason,
        originBinding,
      );
  return {
    content: textParts.join(''),
    toolCalls,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      // Cache traffic, when Anthropic reported it. Absent stays absent —
      // see anthropicCacheWire.readCacheUsage.
      ...readCacheUsage(message.usage),
    },
    stopReason: normalizeStopReason(message.stop_reason),
    ...(message.id && { providerRef: message.id }),
    // Pass the FULL content array — handler filters by type. Undefined
    // when no thinking present so the subflow's early-return kicks in.
    ...(hasThinking && { rawThinking: message.content }),
    ...(replay !== undefined && { replay }),
  };
}

export function normalizeStopReason(raw: string): string {
  switch (raw) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return raw;
  }
}

// ─── Stream ─────────────────────────────────────────────────────────

/** A tool call whose streamed argument JSON did not parse. */
export interface MalformedToolArgs {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  /** The accumulated `partial_json` text. */
  readonly raw: string;
}

export interface StreamAssemblyOptions {
  /** Capture binding from the actual sent body once the response identity is known. */
  readonly bindingFactory?: (id: string) => MessageReplay['binding'];
  /** Omissions already reported by the leaf before this attempt was sent. */
  readonly replayOmissions?: readonly ThinkingReplayOmission[];
  /** Read off the request body that was sent — see wireManifest.ts. */
  readonly wireManifest: WireToolManifest;
  /**
   * What to do with tool arguments that do not parse: return the args to use,
   * or throw. A returned placeholder is always accompanied by finite failure
   * evidence, so it cannot authorize execution. The gateway keeps its stronger
   * whole-response refusal.
   */
  readonly onMalformedToolArgs: (call: MalformedToolArgs) => Record<string, unknown>;
}

function isBlockIndex(index: unknown): index is number {
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0;
}

/**
 * Anthropic's streaming event sequence → `LLMChunk`s.
 *
 * message_start (input usage) → content_block_start (tool_use id + name, or a
 * thinking block) → content_block_delta (`text_delta` yielded as a chunk;
 * `input_json_delta` / `thinking_delta` / `signature_delta` accumulated per
 * content-block INDEX, since blocks can interleave) → content_block_stop (the
 * block is finished and parsed) → message_delta (stop reason, output usage).
 *
 * The TERMINAL chunk (`done: true`) carries the assembled `response` — always,
 * because consumers read `chunk.response` for tool calls and usage.
 */
export async function* assembleAnthropicStream(
  events: AsyncIterable<AnthropicStreamEvent>,
  options: StreamAssemblyOptions,
): AsyncIterable<LLMChunk> {
  let tokenIndex = 0;
  // ONE source of response order, shared across text, thinking and tool blocks.
  // A block completing early never moves it before an earlier response index.
  const contentByIndex = new Map<number, AnthropicContentBlock>();
  const openBlocks = new Set<number>();
  const toolArguments = new AnthropicToolArguments();
  const textParts = new Map<number, string[]>();
  const thinkingParts = new Map<number, string[]>();
  const signatureParts = new Map<number, string[]>();
  const receivedText: string[] = [];
  let hasUnindexedText = false;
  let messageId = '';
  let model = '';
  let stopReason: string | undefined;
  let sawMessageStop = false;
  let usage: AnthropicMessage['usage'] = { input_tokens: 0, output_tokens: 0 };
  let completeLayout = true;
  let observedThinking = false;

  for await (const event of events) {
    // The fetch framing owner already selected the canonical event name.
    toolArguments.observe({
      ...(typeof event.data === 'object' && event.data !== null ? event.data : {}),
      type: event.event,
    });
    if (event.event === 'message_start') {
      const msg = (event.data as { message?: AnthropicMessage }).message;
      if (msg) {
        messageId = msg.id ?? '';
        model = msg.model ?? '';
        usage = { ...usage, ...msg.usage };
      }
    } else if (event.event === 'message_delta') {
      const data = event.data as {
        delta?: { stop_reason?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
      usage = { ...usage, ...data.usage };
    } else if (event.event === 'content_block_start') {
      const data = event.data as { index?: number; content_block?: AnthropicContentBlock };
      const block = data.content_block;
      const index = data.index;
      if (block?.type === 'thinking' || block?.type === 'redacted_thinking')
        observedThinking = true;
      if (!isBlockIndex(index) || !block) {
        completeLayout = false;
        continue;
      }
      if (contentByIndex.has(index)) completeLayout = false;
      contentByIndex.set(index, { ...block });
      openBlocks.add(index);
      if (block.type === 'text') textParts.set(index, [block.text]);
      if (block.type === 'thinking') {
        thinkingParts.set(index, [block.thinking]);
        signatureParts.set(index, block.signature === undefined ? [] : [block.signature]);
      }
    } else if (event.event === 'content_block_delta') {
      const data = event.data as {
        index?: number;
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
          thinking?: string;
          signature?: string;
        };
      };
      const delta = data.delta;
      if (delta?.type === 'thinking_delta' || delta?.type === 'signature_delta')
        observedThinking = true;
      const index = data.index;
      const validIndex = isBlockIndex(index);
      if (!validIndex) completeLayout = false;
      const block = validIndex ? contentByIndex.get(index) : undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        receivedText.push(delta.text);
        if (!validIndex) hasUnindexedText = true;
        if (validIndex) {
          if (block?.type === 'text') {
            textParts.get(index)?.push(delta.text);
          } else if (block === undefined) {
            // Legacy event fixtures omit the start. Keep their text, but never
            // claim that an incomplete event sequence proved full fidelity.
            contentByIndex.set(index, { type: 'text', text: delta.text });
            textParts.set(index, [delta.text]);
            completeLayout = false;
          } else completeLayout = false;
        }
        if (delta.text.length > 0) {
          yield { tokenIndex, content: delta.text, done: false };
          tokenIndex++;
        }
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        // The shared argument owner retains and parses this text at completion.
        if (block?.type !== 'tool_use') completeLayout = false;
      } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        if (validIndex && block?.type === 'thinking') {
          thinkingParts.get(index)?.push(delta.thinking);
        } else completeLayout = false;
      } else if (delta?.type === 'signature_delta' && typeof delta.signature === 'string') {
        if (validIndex && block?.type === 'thinking') {
          signatureParts.get(index)?.push(delta.signature);
        } else completeLayout = false;
      } else completeLayout = false;
    } else if (event.event === 'content_block_stop') {
      const data = event.data as { index?: number };
      const index = data.index;
      if (!isBlockIndex(index)) {
        completeLayout = false;
        continue;
      }
      if (!openBlocks.delete(index)) completeLayout = false;
    } else if (event.event === 'message_stop') {
      sawMessageStop = true;
    }
  }
  toolArguments.assertTerminal();
  const entries = [...contentByIndex.entries()].sort(([a], [b]) => a - b);
  const argumentFailures = new Map<
    number,
    NonNullable<LLMResponse['toolCalls'][number]['argumentsFailure']>
  >();
  if (
    openBlocks.size > 0 ||
    stopReason === undefined ||
    !sawMessageStop ||
    entries.some(([index], position) => index !== position)
  )
    completeLayout = false;
  const binding = messageId ? options.bindingFactory?.(messageId) : undefined;
  const response = fromAnthropicResponse(
    {
      id: messageId,
      model,
      role: 'assistant',
      content: entries.map(([index, block], position) => {
        if (block.type === 'tool_use') {
          const checked = toolArguments.finish(index, block);
          if (checked.failure) {
            completeLayout = false;
            argumentFailures.set(position, checked.failure);
            return {
              ...block,
              input: options.onMalformedToolArgs({
                id: block.id,
                name: block.name,
                index,
                raw: checked.raw,
              }),
            };
          }
          return { ...block, input: checked.input };
        }
        if (block.type === 'text')
          return { ...block, text: textParts.get(index)?.join('') ?? block.text };
        if (block.type === 'thinking') {
          const signatures = signatureParts.get(index) ?? [];
          return {
            ...block,
            thinking: thinkingParts.get(index)?.join('') ?? block.thinking,
            ...(signatures.length > 0 && { signature: signatures.join('') }),
          };
        }
        return block;
      }),
      stop_reason: stopReason ?? 'stop',
      usage,
    },
    binding,
    argumentFailures,
  );
  // Interrupted/malformed content is durable negative evidence, not unknown
  // caller history. Only a witnessed terminal event may certify completion.
  if (!completeLayout)
    (response as { replay?: MessageReplay }).replay = lossyAnthropicReplay(
      entries.map(([, block]) => block),
      messageId,
      sawMessageStop ? stopReason ?? '' : '',
      response.replay?.binding,
      observedThinking,
    );
  // Preserve the old text-only compatibility behavior for incomplete custom
  // stream transports, without certifying any order they did not provide.
  if (hasUnindexedText) (response as { content: string }).content = receivedText.join('');
  yield {
    tokenIndex,
    content: '',
    done: true,
    response: {
      ...response,
      wireManifest: options.wireManifest,
      ...(options.replayOmissions?.length && { replayOmissions: options.replayOmissions }),
    },
  };
}
