/**
 * anthropicCacheWire — the cache↔wire translation both Anthropic adapters share.
 *
 * Pattern: extracted helper (was module-private inside BrowserAnthropicProvider).
 * Role:    Outer ring. Two jobs, one file:
 *   1. `applyCacheMarkers` — stamp `cache_control` onto an Anthropic request
 *      body where the framework's `CacheMarker`s point.
 *   2. `readCacheUsage` — lift Anthropic's cache token counts off a response
 *      usage payload into the port's `cacheRead` / `cacheWrite` fields.
 *
 * Why it exists: the server adapter (`AnthropicProvider`) used to drop
 * `LLMRequest.cacheMarkers` on the floor and report no cache tokens, so on
 * the server path a byte-identical prompt prefix could neither be cached nor
 * even OBSERVED as uncached — `AnthropicCacheStrategy` registers for both
 * `'anthropic'` and `'browser-anthropic'`, and only the browser half kept its
 * side of the contract. One module serving both adapters removes the gap and
 * prevents byte-twin drift between them.
 *
 * @example
 *   const indexMap: number[] = [];
 *   const body = { model, max_tokens, messages: toAnthropicMessages(req.messages, indexMap) };
 *   if (req.cacheMarkers?.length) applyCacheMarkers(body, req.cacheMarkers, indexMap);
 *   // ...and on the way back:
 *   return { usage: { input, output, ...readCacheUsage(message.usage) } };
 */

// ─── Marker application ─────────────────────────────────────────────

/**
 * Where each request message ended up in the provider body — `-1` for one
 * that did not survive the transform.
 *
 * This exists because the two arrays are NOT the same length or the same
 * order: a `role: 'system'` message is dropped (system is a separate
 * top-level field) and consecutive `role: 'tool'` messages are coalesced
 * into ONE user turn. A `CacheMarker{field:'messages'}` names a position in
 * `LLMRequest.messages`, so without this map it would be applied by ordinal
 * into a differently-indexed array and land on the wrong turn — silently,
 * and further off the more tool round-trips the conversation has had.
 */
export type MessageIndexMap = readonly number[];

/** The one wire shape Anthropic accepts for a cache boundary. */
type AnthropicCacheControl = { type: 'ephemeral'; ttl?: '1h' };

/**
 * The slice of an Anthropic request body that markers touch. Structural on
 * purpose: each adapter keeps its own full body interface, and this module
 * must not become a third place that re-declares the whole wire.
 */
interface MarkableBody {
  system?: unknown;
  tools?: unknown[];
  messages: Array<{ role: string; content: unknown }>;
}

/**
 * Apply `CacheMarker[]` to an Anthropic request body in-place.
 *
 * Per-field positional rules (Anthropic API):
 *   - `system`: convert from `string` → array of text blocks; mark the block
 *     with `cache_control`. The body carries the whole system prompt in ONE
 *     block today, so any system marker caches the whole prompt.
 *   - `tools`: mark the tool at `boundaryIndex` (clamped to last tool).
 *   - `messages`: mark the LAST content block of the LAST message in the
 *     cacheable prefix. Anthropic only honors `cache_control` there.
 *
 * `messageIndexMap` translates the marker's index — a position in
 * `LLMRequest.messages` — into a position in `body.messages`. A message that
 * did not survive the transform (`-1`, a system message) cannot be marked at
 * all; silently marking its neighbour would claim a boundary nobody asked for.
 *
 * Markers arrive already clamped to Anthropic's 4-marker limit by
 * `AnthropicCacheStrategy`, so no enforcement here.
 */
export function applyCacheMarkers(
  body: MarkableBody,
  markers: readonly { field: string; boundaryIndex: number; ttl: 'short' | 'long' }[],
  messageIndexMap?: MessageIndexMap,
): void {
  for (const m of markers) {
    const cacheControl: AnthropicCacheControl =
      m.ttl === 'long' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
    if (m.field === 'system') {
      // Convert string system → array form so we can attach cache_control.
      if (typeof body.system === 'string') {
        body.system = [{ type: 'text', text: body.system, cache_control: cacheControl }];
      }
    } else if (m.field === 'tools' && body.tools && body.tools.length > 0) {
      const idx = Math.min(m.boundaryIndex, body.tools.length - 1);
      const tool = body.tools[idx] as { cache_control?: AnthropicCacheControl };
      tool.cache_control = cacheControl;
    } else if (m.field === 'messages' && body.messages.length > 0) {
      // Translate first: the marker names a request-message position, and a
      // message that did not survive the transform cannot be marked at all.
      const mapped = messageIndexMap?.[m.boundaryIndex];
      if (messageIndexMap !== undefined && (mapped === undefined || mapped < 0)) continue;
      const msgIdx = Math.min(mapped ?? m.boundaryIndex, body.messages.length - 1);
      const msg = body.messages[msgIdx];
      if (typeof msg.content === 'string') {
        // String content → wrap in array so we can attach cache_control.
        msg.content = [{ type: 'text', text: msg.content, cache_control: cacheControl }];
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const last = msg.content[msg.content.length - 1] as Record<string, unknown>;
        last.cache_control = cacheControl;
      }
    }
  }
}

// ─── Usage read-back ────────────────────────────────────────────────

/**
 * Anthropic reports cache traffic on the response usage object:
 * `cache_read_input_tokens` (prefix served from cache) and
 * `cache_creation_input_tokens` (prefix written to cache this call).
 * Both are ABSENT when the request carried no cache_control.
 */
export interface AnthropicUsageWire {
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

/**
 * Lift Anthropic's cache counts into the port's optional `cacheRead` /
 * `cacheWrite` fields. Absent stays absent — an adapter must never invent a
 * zero for a number the provider did not report (that is the difference
 * between "no cache traffic" and "nobody measured").
 */
export function readCacheUsage(usage: AnthropicUsageWire | undefined): {
  cacheRead?: number;
  cacheWrite?: number;
} {
  if (!usage) return {};
  return {
    ...(typeof usage.cache_read_input_tokens === 'number' && {
      cacheRead: usage.cache_read_input_tokens,
    }),
    ...(typeof usage.cache_creation_input_tokens === 'number' && {
      cacheWrite: usage.cache_creation_input_tokens,
    }),
  };
}
