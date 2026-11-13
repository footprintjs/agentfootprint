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

/** The keys that a group repeats from an earlier group, or the registry never declared. */
type InvalidEventKeys<
  Groups extends readonly object[],
  Seen extends PropertyKey = never,
> = Groups extends readonly [infer First extends object, ...infer Rest extends readonly object[]]
  ?
      | Extract<keyof First, Seen>
      | Exclude<keyof First, EventType>
      | InvalidEventKeys<Rest, Seen | keyof First>
  : never;

/** Type-only composition guard: each registered event is present exactly once. */
export type CheckedEventGroups<Groups extends readonly object[]> = [
  InvalidEventKeys<Groups>,
] extends [never]
  ? { readonly [T in EventType]-?: BoundRule }
  : never;
