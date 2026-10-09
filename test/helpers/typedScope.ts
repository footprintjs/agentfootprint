import type { TypedScope } from 'footprintjs';
import { createTypedScopeFactory, StageContext } from 'footprintjs/advanced';
import { SharedMemory } from 'footprintjs/write';

/** A real scope for unit tests that call helpers requiring the engine protocol. */
export function typedScope<T extends object>(state: T): TypedScope<T> {
  const context = new StageContext('fixture', 'Fixture', 'fixture', new SharedMemory(state));
  return createTypedScopeFactory<T>()(context, 'Fixture');
}
