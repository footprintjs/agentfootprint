import type { ToolNameChannel } from '../events/payloads.js';
import { finiteLabel } from './finiteLabel.js';

/**
 * A party that put a tool name forward for the wire (9.92.0) — the vocabulary
 * `tools.shadowed` and `tools.claim_swallowed` speak. `id` is the provider id or
 * the skill id when the party has one; a static `.tool()` and a framework
 * auto-attach carry none.
 */
export interface ToolParty {
  readonly channel: ToolNameChannel;
  readonly id?: string;
  /** Private checkpoint representation only; public declared IDs remain unchanged. */
  readonly idDigest?: string;
}

/** Compare the represented declarations; labels do not authenticate implementations. */
export const sameToolParty = (a: ToolParty, b: ToolParty): boolean => {
  const left = readToolParty(a),
    right = readToolParty(b);
  return (
    left !== undefined &&
    right !== undefined &&
    left.channel === right.channel &&
    left.id === right.id &&
    left.idDigest === right.idDigest
  );
};

/** Read a finite declaration without invoking checkpoint-supplied accessors. */
export function readToolParty(value: unknown): ToolParty | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return undefined;
  const channel = Object.getOwnPropertyDescriptor(value, 'channel');
  const id = Object.getOwnPropertyDescriptor(value, 'id');
  const digest = Object.getOwnPropertyDescriptor(value, 'idDigest');
  if (
    channel === undefined ||
    !('value' in channel) ||
    !['provider', 'registry', 'skill', 'framework'].includes(channel.value) ||
    (id !== undefined && (!('value' in id) || typeof id.value !== 'string')) ||
    (digest !== undefined &&
      (id !== undefined ||
        !('value' in digest) ||
        typeof digest.value !== 'string' ||
        !/^[0-9a-f]{64}$/.test(digest.value)))
  )
    return undefined;
  if (digest !== undefined) return { channel: channel.value, idDigest: digest.value };
  const label = id === undefined ? undefined : finiteLabel(id.value);
  return {
    channel: channel.value,
    ...(label?.kind === 'plain' && { id: label.value }),
    ...(label?.kind === 'sha256' && { idDigest: label.value }),
  };
}
