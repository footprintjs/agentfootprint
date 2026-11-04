import type { DomainRunEvent, DomainSubflowEvent } from './domainEvents.js';
import { ROOT_RUNTIME_STAGE_ID, ROOT_SUBFLOW_ID } from 'footprintjs/trace';
import type { FlowSubflowEvent } from 'footprintjs';
import { slotFromSubflowId } from '../../../lib/conventions.js';
import { isAgentInternalId } from './agentInternal.js';

/** Clamp `getCommitCount()` returns to a safe non-negative integer.
 *  Defensive against malformed injections returning NaN/Infinity/negatives
 *  (security panel review YELLOW #2). */
function sanitizeCommitCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n;
}

function buildRunEvent(
  type: 'run.entry' | 'run.exit',
  payload: unknown,
  commitIdxBefore: number,
): DomainRunEvent {
  return {
    type,
    runtimeStageId: ROOT_RUNTIME_STAGE_ID,
    subflowPath: [ROOT_SUBFLOW_ID],
    depth: 0,
    ts: Date.now(),
    commitIdxBefore,
    commitIdxAfter: commitIdxBefore,
    payload,
    isRoot: true,
  };
}

function buildSubflowEvent(
  event: FlowSubflowEvent,
  type: 'subflow.entry' | 'subflow.exit',
  commitIdxBefore: number,
  transformPayload: (payload: unknown) => unknown,
): DomainSubflowEvent | undefined {
  const subflowId = event.subflowId;
  if (!subflowId) return undefined;

  const ctx = event.traversalContext;
  const runtimeStageId = ctx?.runtimeStageId ?? '';
  const segments = subflowId.split('/').filter(Boolean);
  const subflowPath: readonly string[] = [ROOT_SUBFLOW_ID, ...segments];
  const depth = subflowPath.length - 1;
  const localSubflowId = segments[segments.length - 1] ?? subflowId;
  const description = event.description;
  const primitiveKind = description ? parsePrimitiveKindFromDescription(description) : undefined;
  const slotKind = slotFromSubflowId(subflowId);
  const isAgentInternal = isAgentInternalId(localSubflowId);
  const rawPayload = type === 'subflow.entry' ? event.mappedInput : event.outputState;
  const payload = rawPayload === undefined ? undefined : transformPayload(rawPayload);

  return {
    type,
    runtimeStageId,
    subflowPath,
    depth,
    ts: Date.now(),
    commitIdxBefore,
    commitIdxAfter: commitIdxBefore,
    subflowId,
    localSubflowId,
    subflowName: event.name,
    ...(description ? { description } : {}),
    ...(primitiveKind ? { primitiveKind } : {}),
    ...(slotKind ? { slotKind } : {}),
    isAgentInternal,
    ...(payload !== undefined ? { payload } : {}),
  };
}

function pathFromCtx(subflowPath: string | undefined): readonly string[] {
  if (!subflowPath) return [ROOT_SUBFLOW_ID];
  return [ROOT_SUBFLOW_ID, ...subflowPath.split('/').filter(Boolean)];
}

function ctxDepth(subflowPath: string | undefined): number {
  return pathFromCtx(subflowPath).length - 1;
}

function parsePrimitiveKindFromDescription(description: string): string | undefined {
  const colonIdx = description.indexOf(':');
  if (colonIdx <= 0) return undefined;
  const kind = description.slice(0, colonIdx).trim();
  return kind || undefined;
}

export { sanitizeCommitCount, buildRunEvent, buildSubflowEvent, pathFromCtx, ctxDepth };
