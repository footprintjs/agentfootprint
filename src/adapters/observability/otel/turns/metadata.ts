import type { AgentfootprintEvent } from '../../../../events/registry.js';
import type { Attrs } from '../attributes/projections.js';
import type { TurnState } from './state.js';

/** `gen_ai.conversation.id` for a span of this turn — or nothing. */
export function conversationAttr(t: TurnState): Attrs {
  return t.conversationId !== undefined ? { 'gen_ai.conversation.id': t.conversationId } : {};
}

/** A non-empty `meta.sessionId`, or undefined. */
export function sessionOf(event: AgentfootprintEvent): string | undefined {
  const sessionId = (event as { meta?: { sessionId?: unknown } }).meta?.sessionId;
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined;
}

/**
 * Resolve the run anchor for an event.
 *
 * Real runtime events are dispatcher envelopes — the run id lives on
 * `event.meta.runId` (built by `bridge/eventMeta.ts`). The legacy
 * `payload.runId` read is kept as a fallback for consumers feeding
 * hand-built events (the pre-6.17 shape this adapter's own tests
 * used). Without the meta read, NO span ever opened on a real agent
 * run — the bug the fabricated test shapes masked.
 */
export function anchorRunId(event: AgentfootprintEvent): string | undefined {
  const meta = (event as { meta?: { runId?: string } }).meta;
  return meta?.runId ?? (event.payload as { runId?: string } | undefined)?.runId;
}
