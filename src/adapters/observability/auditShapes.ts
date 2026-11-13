/**
 * Exhaustive bounded audit shapes, one checked rule for every event payload field.
 * Content becomes a marker; structural fields use runtime-checked primitive,
 * closed-union, list and object rules. No container passes through wholesale.
 * The event table is a Map, so inherited names cannot select a known shape.
 * AuditBoundingDepth and audit-bounded-sweep pin type depth and runtime damage.
 */

import type { AgentfootprintEventMap } from '../../events/registry.js';
import { type BoundRule } from './auditBounding.js';
import { boundScripts as boundScriptsRule } from './auditShapes/pieces/scripts.js';
import { boundAnswerCoverage as boundAnswerCoverageRule } from './auditShapes/pieces/coverage.js';
import { boundAnswerNegatives as boundAnswerNegativesRule } from './auditShapes/pieces/coverage.js';
import { boundMeta as boundMetaRule } from './auditShapes/pieces/meta.js';
import { contentShapes } from './auditShapes/events/content.js';
import { decisionsShapes } from './auditShapes/events/decisions.js';
import { lifecycleShapes } from './auditShapes/events/lifecycle.js';
import { streamingShapes } from './auditShapes/events/streaming.js';
import { resourcesShapes } from './auditShapes/events/resources.js';
import { routingShapes } from './auditShapes/events/routing.js';
import { outcomesShapes } from './auditShapes/events/outcomes.js';

/** Attachment summary: preserve every declared field, check every runtime child. */
export const boundScripts = boundScriptsRule;

/**
 * A typed answer's limits: the three lists, the declared periods, what a read
 * found still running and the values an `assume` rule filled. Every sentence
 * and value is a marker; the tool and argument NAMES, the call ids, counts,
 * kinds and the library's `'unknown'` stay.
 */
export const boundAnswerCoverage = boundAnswerCoverageRule;

/**
 * A typed answer's negatives: each statement and the population it is about
 * are markers; the answer field's declared name, the codes, verdicts, ids,
 * tool names and counts stay.
 */
export const boundAnswerNegatives = boundAnswerNegativesRule;

type EventType = keyof AgentfootprintEventMap;

/**
 * Each record's meta: the run and stage ids, paths, indices and engine
 * coordinates the dispatcher stamps — and the who the caller named
 * (`sessionId`, `principal`, `tenant`), kept by contract. A field `EventMeta`
 * does not declare, or a value of another kind, is a marker. (`wallClockMs` is
 * the record's `timestamp`; `runId` its run anchor — `audit.ts` lifts both.)
 */
export const boundMeta: BoundRule = boundMetaRule;

/**
 * The whole-event shapes as a `Map`, by event type — what `audit.ts` looks an
 * event up in. An event's name is the emitter's to choose (`agent.emit()`
 * takes any string), so it is never a key into a plain object: a name
 * `Object.prototype` holds (`constructor`, `toString`, `__proto__`) finds no
 * shape here, and that event is bounded as unknown — every field a marker.
 */
export function eventShapeTable(
  toolRan: (name: string) => boolean,
): ReadonlyMap<string, BoundRule> {
  return new Map<string, BoundRule>(Object.entries(eventShapes(toolRan)));
}

/**
 * The whole-event shapes, by event type. `toolRan` answers whether this
 * strategy has seen a tool of that name run (`createToolRunTracker`): a
 * `tryInsteadTool` names another tool, and that name is kept only then —
 * otherwise it is the tool author's word for a tool this agent may not hold
 * (`otel/attributes/projections.ts` · `coverageAttrs`, the same rule).
 */
export function eventShapes(toolRan: (name: string) => boolean): {
  readonly [T in EventType]-?: BoundRule;
} {
  return {
    ...contentShapes(toolRan),
    ...decisionsShapes(),
    ...lifecycleShapes(),
    ...streamingShapes(),
    ...resourcesShapes(),
    ...routingShapes(),
    ...outcomesShapes(),
  };
}
