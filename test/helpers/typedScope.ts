import type { TypedScope } from 'footprintjs';
import { createTypedScopeFactory, SharedMemory, StageContext } from 'footprintjs/advanced';

/** A real scope for unit tests that call helpers requiring the engine protocol. */
export function typedScope<T extends object>(state: T): TypedScope<T> {
  const context = new StageContext('fixture', 'Fixture', 'fixture', new SharedMemory(state));
  return createTypedScopeFactory<T>()(context, 'Fixture');
}
