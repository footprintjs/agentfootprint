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

import type { LLMChunk, LLMMessage, LLMRequest, LLMResponse, LLMToolSchema } from '../types.js';
import { applyCacheMarkers, readCacheUsage } from './anthropicCacheWire.js';
import type { WireToolManifest } from './wireManifest.js';

// ─── Types (Anthropic API shapes) ──────────────────────────────────

/** The Messages body WITHOUT `model` — each transport adds its own framing. */
export interface AnthropicMessagesBody {
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  stop_sequences?: string[];
  // v2.14 — extended-thinking activation. Presence of `thinking`
  // tells Anthropic to emit reasoning blocks.
  thinking?: { type: 'enabled'; budget_tokens: number };
  // Emitted only when `parallelToolCalls: false`, or for a forced choice.
  tool_choice?: { type: 'auto'; disable_parallel_tool_use: true } | { type: 'tool'; name: string };
}

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // v2.14 — extended-thinking blocks. Round-trip on assistant turns
  // when continuing a tool-using extended-thinking conversation;
  // signature MUST be byte-exact or Anthropic returns HTTP 400.
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; signature?: string };

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

/**
 * Build the Messages body (minus `model`) from a framework request.
 * `maxTokens` is the adapter's default when the request sets none.
 */
export function buildMessagesBody(
  req: LLMRequest,
  maxTokensDefault: number,
  parallelToolCalls?: boolean,
): AnthropicMessagesBody {
  // v2.14 — auto-bump max_tokens when thinking would violate Anthropic's
  // `max_tokens > thinking.budget_tokens` invariant. See the matching
  // logic in AnthropicProvider.buildParams; identical heuristic.
  let maxTokens = req.maxTokens ?? maxTokensDefault;
  if (req.thinking && maxTokens <= req.thinking.budget) {
    maxTokens = req.thinking.budget + 1024;
  }
  // The map is only needed when a messages marker has to be placed; building
  // it always keeps the transform single-pass and costs one number per message.
  const messageIndexMap: number[] = [];
  const body: AnthropicMessagesBody = {
    max_tokens: maxTokens,
    messages: toAnthropicMessages(req.messages, messageIndexMap),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toAnthropicTool);
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop_sequences = [...req.stop];
  if (req.thinking) {
    body.thinking = { type: 'enabled', budget_tokens: req.thinking.budget };
  }
  // One tool per reply — Anthropic rejects `tool_choice` on a request that
  // carries no tools.
  if (parallelToolCalls === false && body.tools !== undefined && body.tools.length > 0) {
    body.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
  }
  // Forced choice wins over the parallel cap — see the Node provider.
  if (req.toolChoice && body.tools !== undefined && body.tools.length > 0) {
    body.tool_choice = { type: 'tool', name: req.toolChoice.name };
  }
  // Cache markers — applied AFTER body construction so the materialized
  // fields (system / tools / messages) exist to mark. Clamped to the declared
  // `maxBreakpoints` (four) by BreakpointCacheStrategy before we get here.
  if (req.cacheMarkers && req.cacheMarkers.length > 0) {
    applyCacheMarkers(body, req.cacheMarkers, messageIndexMap);
  }
  return body;
}

/**
 * Framework messages → Anthropic messages.
 *
 * `role: 'system'` is DROPPED: this wire takes the system prompt as a separate
 * top-level field (`LLMRequest.systemPrompt`). That is why every adapter on it
 * carries only `['user', 'assistant']` in messages. A `role: 'tool'` result
 * becomes a `tool_result` block on a user turn, coalesced with the results of
 * the same batch. An `assistant` turn with no thinking blocks, no text and no
 * tool calls is DROPPED too — the API refuses empty content anywhere but a
 * final prefill.
 *
 * ONE owner: `anthropic()`, `browserAnthropic()` and `invokeModelGateway()`
 * all build their messages here.
 */
export function toAnthropicMessages(
  messages: readonly LLMMessage[],
  indexMap?: number[],
): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      indexMap?.push(-1);
      continue;
    }
    if (m.role === 'user') {
      indexMap?.push(result.length);
      result.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      // v2.14 — thinking blocks come FIRST per Anthropic's wire format
      // ordering rule. Out-of-order = HTTP 400. Signature passes through
      // BYTE-EXACT — no String() coercion, no JSON-roundtrip, no trim.
      if (m.thinkingBlocks && m.thinkingBlocks.length > 0) {
        for (const tb of m.thinkingBlocks) {
          if (tb.type === 'redacted_thinking') {
            blocks.push({
              type: 'redacted_thinking',
              ...(tb.signature !== undefined && { signature: tb.signature }),
            });
          } else {
            blocks.push({
              type: 'thinking',
              thinking: tb.content,
              ...(tb.signature !== undefined && { signature: tb.signature }),
            });
          }
        }
      }
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: { ...tc.args } });
        }
      }
      // A turn with no thinking, no text and no tool calls has nothing to
      // say, and the wire refuses it: `content: ''` is accepted only on a
      // FINAL assistant message (a prefill), so one mid-history fails the
      // whole request with a 400 that no retry can mend. Dropped like a
      // system message (`-1` — a cache marker cannot land on it). The turns
      // either side may now share a role; the Messages API combines
      // consecutive same-role turns, and a dropped system message has always
      // left the same adjacency. The library sends no prefill, and an empty
      // one would prefill nothing.
      if (blocks.length === 0) {
        indexMap?.push(-1);
        continue;
      }
      indexMap?.push(result.length);
      result.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (m.role === 'tool') {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        // Coalesced into the user turn already open — several request messages
        // share one body index.
        indexMap?.push(result.length - 1);
        last.content.push(block);
      } else {
        indexMap?.push(result.length);
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }
  }
  return result;
}

export function toAnthropicTool(schema: LLMToolSchema): AnthropicTool {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: { ...schema.inputSchema },
  };
}

// ─── Response ───────────────────────────────────────────────────────

export function fromAnthropicResponse(message: AnthropicMessage): LLMResponse {
  const textParts: string[] = [];
  const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
  // v2.14 — detect thinking presence so we can pass the full content
  // array through as `rawThinking` for the framework's thinking subflow
  // (handler filters thinking + redacted_thinking blocks; ignores rest).
  let hasThinking = false;
  for (const block of message.content) {
    if (block.type === 'text') textParts.push(block.text);
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      hasThinking = true;
    }
  }
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
    providerRef: message.id,
    // Pass the FULL content array — handler filters by type. Undefined
    // when no thinking present so the subflow's early-return kicks in.
    ...(hasThinking && { rawThinking: message.content }),
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
  /** Read off the request body that was sent — see wireManifest.ts. */
  readonly wireManifest: WireToolManifest;
  /**
   * What to do with tool arguments that do not parse: return the args to use,
   * or throw. Each adapter decides — the browser adapter has always used `{}`;
   * the gateway adapter refuses rather than run a tool with its arguments lost.
   */
  readonly onMalformedToolArgs: (call: MalformedToolArgs) => Record<string, unknown>;
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
  const accumulatedText: string[] = [];
  // Tool-use blocks arrive in two waves: `content_block_start` carries
  // {id, name, input: {}} (input is ALWAYS empty there), then a series
  // of `content_block_delta` events with `delta.type === 'input_json_delta'`
  // ship the JSON args as string fragments, parsed at `content_block_stop`.
  const toolUseByIndex = new Map<number, { id: string; name: string; partialJson: string[] }>();
  const completedToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  // v2.14 — thinking blocks arrive across several events (start, thinking_delta,
  // signature_delta, stop). Accumulated per index; ORDER preserved.
  const thinkingByIndex = new Map<
    number,
    { type: 'thinking' | 'redacted_thinking'; thinking: string[]; signature: string[] }
  >();
  const completedThinking: Array<
    | { type: 'thinking'; thinking: string; signature?: string }
    | { type: 'redacted_thinking'; signature?: string }
  > = [];
  // Usage rides two places: message_start (input first) and message_delta
  // (running output). message_stop carries none.
  let messageId: string | undefined;
  let stopReason: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheUsage: { cacheRead?: number; cacheWrite?: number } = {};

  for await (const event of events) {
    if (event.event === 'message_start') {
      const msg = (event.data as { message?: AnthropicMessage }).message;
      if (msg) {
        messageId = msg.id;
        inputTokens = msg.usage?.input_tokens ?? 0;
        outputTokens = msg.usage?.output_tokens ?? 0;
        cacheUsage = readCacheUsage(msg.usage);
      }
    } else if (event.event === 'message_delta') {
      const data = event.data as {
        delta?: { stop_reason?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
      if (data.usage?.output_tokens !== undefined) outputTokens = data.usage.output_tokens;
      if (data.usage?.input_tokens !== undefined) inputTokens = data.usage.input_tokens;
    } else if (event.event === 'content_block_start') {
      const data = event.data as { index?: number; content_block?: AnthropicContentBlock };
      const block = data.content_block;
      if (block?.type === 'tool_use' && typeof data.index === 'number') {
        toolUseByIndex.set(data.index, { id: block.id, name: block.name, partialJson: [] });
      } else if (
        (block?.type === 'thinking' || block?.type === 'redacted_thinking') &&
        typeof data.index === 'number'
      ) {
        thinkingByIndex.set(data.index, {
          type: block.type,
          thinking: [],
          signature: block.signature !== undefined ? [block.signature] : [],
        });
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
      if (delta?.type === 'text_delta' && delta.text) {
        accumulatedText.push(delta.text);
        yield { tokenIndex, content: delta.text, done: false };
        tokenIndex++;
      } else if (
        delta?.type === 'input_json_delta' &&
        typeof data.index === 'number' &&
        typeof delta.partial_json === 'string'
      ) {
        const tu = toolUseByIndex.get(data.index);
        if (tu) tu.partialJson.push(delta.partial_json);
      } else if (
        delta?.type === 'thinking_delta' &&
        typeof data.index === 'number' &&
        typeof delta.thinking === 'string'
      ) {
        const t = thinkingByIndex.get(data.index);
        if (t) t.thinking.push(delta.thinking);
      } else if (
        delta?.type === 'signature_delta' &&
        typeof data.index === 'number' &&
        typeof delta.signature === 'string'
      ) {
        const t = thinkingByIndex.get(data.index);
        if (t) t.signature.push(delta.signature);
      }
    } else if (event.event === 'content_block_stop') {
      const data = event.data as { index?: number };
      if (typeof data.index === 'number') {
        const tu = toolUseByIndex.get(data.index);
        if (tu) {
          const joined = tu.partialJson.join('');
          // Empty partial_json is valid — a tool called with no arguments.
          let parsed: Record<string, unknown> = {};
          if (joined.length > 0) {
            try {
              parsed = JSON.parse(joined) as Record<string, unknown>;
            } catch {
              parsed = options.onMalformedToolArgs({
                id: tu.id,
                name: tu.name,
                index: data.index,
                raw: joined,
              });
            }
          }
          completedToolUses.push({ id: tu.id, name: tu.name, input: parsed });
          toolUseByIndex.delete(data.index);
        }
        const t = thinkingByIndex.get(data.index);
        if (t) {
          const thinkingText = t.thinking.join('');
          const signature = t.signature.join('');
          if (t.type === 'redacted_thinking') {
            completedThinking.push({
              type: 'redacted_thinking',
              ...(signature.length > 0 && { signature }),
            });
          } else {
            completedThinking.push({
              type: 'thinking',
              thinking: thinkingText,
              ...(signature.length > 0 && { signature }),
            });
          }
          thinkingByIndex.delete(data.index);
        }
      }
    }
  }

  const response: LLMResponse = {
    content: accumulatedText.join(''),
    toolCalls: completedToolUses.map((t) => ({ id: t.id, name: t.name, args: t.input })),
    usage: { input: inputTokens, output: outputTokens, ...cacheUsage },
    stopReason: normalizeStopReason(stopReason ?? 'stop'),
    ...(messageId && { providerRef: messageId }),
    // v2.14 — thinking blocks pass through as `rawThinking` for the
    // framework's NormalizeThinking subflow. Same shape as complete().
    ...(completedThinking.length > 0 && { rawThinking: completedThinking }),
    wireManifest: options.wireManifest,
  };
  yield { tokenIndex, content: '', done: true, response };
}
