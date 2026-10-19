/** Converse cachePoint unions and usage, shared by complete and stream.
 * AWS contracts: /APIReference/API_runtime_{CachePointBlock,TokenUsage,Tool,
 * SystemContentBlock,ContentBlock}.html and /userguide/prompt-caching.html.
 * Model eligibility and TTL restrictions have one owner: bedrockModels.ts.
 */
import type { PromptCaching, CacheMarker } from '../../cache/types.js';
import { bedrockCacheFacts } from './bedrockModels.js';

export interface BedrockCachePoint {
  cachePoint: { type: 'default'; ttl?: '1h' };
}
export interface BedrockMessagePosition {
  readonly message: number;
  readonly content: number;
}
interface MarkableBody {
  system?: unknown[];
  messages: { content: unknown[] }[];
  toolConfig?: { tools: unknown[] };
}
export interface BedrockCacheUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
}

export function bedrockPromptCaching(model: string): PromptCaching | undefined {
  const facts = bedrockCacheFacts(model);
  return facts === undefined
    ? undefined
    : {
        mode: 'breakpoints',
        maxBreakpoints: facts.maxBreakpoints,
        reportsUsage: true,
        ...(!facts.tools && { fields: ['system', 'messages'] as const }),
      };
}

/** Translate only valid original boundaries; a dropped message never marks a
 * neighbor. Deduplicate, cap, then insert backwards so indices never shift.
 * TTLs follow wire order (tools → system → messages), independent of marker
 * arrival order: a long TTL after a short one is safely reduced to default.
 */
export function applyCacheMarkers(
  body: MarkableBody,
  markers: readonly CacheMarker[],
  model: string,
  positions: readonly (BedrockMessagePosition | undefined)[],
): void {
  const facts = bedrockCacheFacts(model);
  if (facts === undefined) return;
  const boundaries = new Map<
    string,
    { array: unknown[]; index: number; order: number; long: boolean }
  >();
  for (const marker of markers) {
    if (!Number.isSafeInteger(marker.boundaryIndex) || marker.boundaryIndex < 0) continue;
    let array: unknown[] | undefined;
    let index = marker.boundaryIndex;
    let order = 0;
    let identity = '';
    if (marker.field === 'tools' && facts.tools) {
      array = body.toolConfig?.tools;
      identity = `tools:${index}`;
    } else if (marker.field === 'system') {
      // The port carries one composed system string, as the Anthropic wire
      // does. A system marker covers that single block, not invented pieces.
      array = body.system;
      index = 0;
      order = 1;
      identity = 'system';
    } else if (marker.field === 'messages') {
      const position = positions[index];
      if (position === undefined) continue;
      array = body.messages[position.message]?.content;
      index = position.content;
      order = position.message + 2;
      identity = `message:${position.message}:${index}`;
    }
    if (array === undefined || index >= array.length || identity === '') continue;
    // A duplicate never upgrades a short cache request to a pricier long TTL.
    const previous = boundaries.get(identity);
    const long = marker.ttl === 'long' && facts.longTtl;
    boundaries.set(identity, { array, index, order, long: long && (previous?.long ?? true) });
    if (boundaries.size >= facts.maxBreakpoints) break;
  }
  const selected = [...boundaries.values()]
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .slice(0, facts.maxBreakpoints);
  let shortSeen = false;
  const points = selected.map((boundary) => {
    const long = boundary.long && !shortSeen;
    if (!long) shortSeen = true;
    const point: BedrockCachePoint = {
      cachePoint: { type: 'default', ...(long && { ttl: '1h' as const }) },
    };
    return { ...boundary, point };
  });
  for (const { array, index, point } of points.reverse()) array.splice(index + 1, 0, point);
}

/** Present zero is measured; absent or malformed cache counters stay absent.
 * inputTokens is fresh input (AWS excludes both cache reads and writes), the
 * same semantics the port cache meter expects from Anthropic's adapter. */
export function readCacheUsage(usage: BedrockCacheUsage | undefined): {
  cacheRead?: number;
  cacheWrite?: number;
} {
  const count = (value: number | undefined): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;
  return {
    ...(count(usage?.cacheReadInputTokens) && { cacheRead: usage?.cacheReadInputTokens }),
    ...(count(usage?.cacheWriteInputTokens) && { cacheWrite: usage?.cacheWriteInputTokens }),
  };
}
