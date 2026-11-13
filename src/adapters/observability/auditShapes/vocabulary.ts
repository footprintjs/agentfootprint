import type { AgentfootprintEventMap } from '../../../events/registry.js';
import type { AnyKeyOf, BoundRule } from '../auditBounding.js';
import { shapeOf } from '../auditBounding.js';

/** `T`'s field `K`, present. */
export type At<T, K extends keyof NonNullable<T>> = NonNullable<NonNullable<T>[K]>;

// ─── Whole events whose content sits beside structure ─────────────────

export type EventType = keyof AgentfootprintEventMap;

export type PayloadOf<T extends EventType> = AgentfootprintEventMap[T]['payload'];

export type ItemOf<T> = T extends readonly (infer E)[] ? E : never;

/** A shape for one event's whole payload, exhaustive over that event's payload type. */
export const eventShape = <T extends EventType>(rules: {
  readonly [K in AnyKeyOf<PayloadOf<T>>]-?: BoundRule;
}): BoundRule => shapeOf<PayloadOf<T>>(rules);
