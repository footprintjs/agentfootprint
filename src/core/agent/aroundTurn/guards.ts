/**
 * The build-time and host-time rules around `.aroundTurn()`, as plain functions.
 */

import { AroundTurnError } from './errors.js';
import type { AroundTurn } from './types.js';

/** The builder's rule: one wrapper per agent, of the right shape. */
export function admitAroundTurn(wrapper: AroundTurn, declared: AroundTurn | undefined): AroundTurn {
  if (declared !== undefined) throw new AroundTurnError('second-wrapper', declared.name);
  const { name, around } = (wrapper ?? {}) as Partial<AroundTurn>;
  if (typeof name !== 'string' || name.length === 0 || typeof around !== 'function')
    throw new AroundTurnError('invalid-wrapper', typeof name === 'string' ? name : '');
  return wrapper;
}

/** A mount has no turn to wrap, so a wrapper could not run there. Refused, never skipped. */
export function refuseMountedWrapper(port: AroundTurn | undefined): void {
  if (port !== undefined) throw new AroundTurnError('mounted', port.name);
}

/** The two public doors a host must not route around silently. */
export type TurnMethod = 'run' | 'resume';

const TURN_METHODS: readonly TurnMethod[] = ['run', 'resume'];

/**
 * Which of `runner`'s turn doors are not the class's own — an own property or a
 * subclass override alike. `own` is captured when the class loads, so a later
 * patch of the prototype counts too.
 */
export function replacedTurnMethods(
  runner: object,
  own: Readonly<Record<TurnMethod, unknown>>,
): readonly TurnMethod[] {
  return TURN_METHODS.filter(
    (method) => (runner as Record<string, unknown>)[method] !== own[method],
  );
}
