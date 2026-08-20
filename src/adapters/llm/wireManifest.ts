/**
 * wireManifest — what ACTUALLY crossed the wire, read back from the
 * serialized request body itself.
 *
 * Pattern: one tiny extractor, shared by every adapter that states a
 *          manifest (the anthropicCacheWire precedent).
 * Role:    the wire seam's evidence. The recorded defect this exists for:
 *          the internal frame said a subsystem's tools were removed, and
 *          the adapter still serialized four schemas. A check that reads
 *          only the pre-serialization IR CANNOT see that bug — the IR was
 *          clean. So the manifest is read from the FINAL request body,
 *          after every transform (tool mapping, cache markers, tool_choice
 *          guards), at the last moment the adapter still holds it.
 *
 * HONEST ABSENCE: a provider that does not state a manifest simply leaves
 * `LLMResponse.wireManifest` undefined, and the wire check treats that as
 * incomparable — never as "nothing crossed". An EMPTY manifest is the
 * opposite: a stated fact that zero tools rode the request.
 */

import type { WireToolManifest } from '../types.js';

export type { WireToolManifest };

/**
 * Read the manifest off the final request body's tools array. `undefined`
 * tools (the field never written — Anthropic rejects an empty array, so
 * adapters omit it) is a stated zero: no tools crossed.
 */
export function toolManifestOf(
  tools: ReadonlyArray<{ readonly name?: unknown }> | undefined,
): WireToolManifest {
  if (tools === undefined) return { toolNames: [] };
  return {
    toolNames: tools
      .map((t) => t.name)
      .filter((name): name is string => typeof name === 'string'),
  };
}
