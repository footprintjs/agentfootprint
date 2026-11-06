/**
 * The inputs layer's note options for a call whose tool's served schema
 * carries `_findings.from` under declared sources (`arguments/serve/schema.ts` ·
 * `ServeOptions`) — one frozen value, handed per call.
 */
export const SOURCES_NOTE = Object.freeze({ sources: true as const });
