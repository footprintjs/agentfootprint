import type { ToolNameChannel } from '../events/payloads.js';

/**
 * A party that put a tool name forward for the wire (9.92.0) — the vocabulary
 * `tools.shadowed` and `tools.claim_swallowed` speak. `id` is the provider id or
 * the skill id when the party has one; a static `.tool()` and a framework
 * auto-attach carry none.
 */
export interface ToolParty {
  readonly channel: ToolNameChannel;
  readonly id?: string;
}

/** Compare the represented declarations; labels do not authenticate implementations. */
export const sameToolParty = (a: ToolParty, b: ToolParty): boolean =>
  a.channel === b.channel && a.id === b.id;

/** Read a finite declaration without invoking checkpoint-supplied accessors. */
export function readToolParty(value: unknown): ToolParty | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return undefined;
  const channel = Object.getOwnPropertyDescriptor(value, 'channel');
  const id = Object.getOwnPropertyDescriptor(value, 'id');
  if (
    channel === undefined ||
    !('value' in channel) ||
    !['provider', 'registry', 'skill', 'framework'].includes(channel.value) ||
    (id !== undefined &&
      (!('value' in id) || typeof id.value !== 'string' || id.value.length > 1024))
  )
    return undefined;
  return { channel: channel.value, ...(id !== undefined && { id: id.value }) };
}
