import type { AgentfootprintEvent } from '../../../../events/registry.js';
import type { CommentaryContext } from './types.js';

// ─── agentName derivation ──────────────────────────────────────────

/**
 * Library-internal subflow id segments that are NOT user-facing
 * agent identities. When walking back through `event.meta.subflowPath`
 * we skip these to find the meaningful agent / stage name.
 */
const COMMENTARY_INTERNAL_SEGMENT_PREFIXES = ['sf-', 'thinking-'] as const;

const COMMENTARY_INTERNAL_SEGMENTS = new Set<string>([
  'sf-injection-engine',
  'sf-system-prompt',
  'sf-messages',
  'sf-tools',
  'sf-route',
  'sf-tool-calls',
  'sf-merge',
  'sf-thinking',
  'sf-cache', // v2.14 — cache decision wrapper (and its inner stages)
  'sf-cache-decision',
  'final', // route-decider 'final' branch — same exception as SUBFLOW_IDS.FINAL
]);

function isInternalSegment(seg: string): boolean {
  if (COMMENTARY_INTERNAL_SEGMENTS.has(seg)) return true;
  for (const p of COMMENTARY_INTERNAL_SEGMENT_PREFIXES) {
    if (seg.startsWith(p)) return true;
  }
  return false;
}

/**
 * Resolve the agent name from an event's `meta.subflowPath`.
 *
 * Walks the path right-to-left, skipping library-internal segments
 * (slot subflows, agent-routing subflows, thinking handlers), and
 * returns the FIRST meaningful segment with the optional `step-`
 * Sequence prefix stripped. For events with no meaningful path
 * (single-Agent runners, top-level events), falls back to `appName`.
 */
export function extractAgentName(event: AgentfootprintEvent, ctx: CommentaryContext): string {
  const path = event.meta?.subflowPath ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (!seg) continue;
    if (isInternalSegment(seg)) continue;
    return seg.replace(/^step-/, '');
  }
  return ctx.appName;
}
