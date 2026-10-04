import { allow } from './outcomes.js';
import type { MessageMiddleware } from './types.js';

// Only wrappers made here can promise not to inspect output. Ordinary callbacks
// can branch on either phase, so their delivery must wait for the output walk.
const phases = new WeakMap<MessageMiddleware, 'input' | 'output'>();

/** Bind a declared phase without changing the other phase's recorded allow row. */
export function messageAt(
  phase: 'input' | 'output',
  middleware: MessageMiddleware,
): MessageMiddleware {
  const wrapped: MessageMiddleware = {
    name: middleware.name,
    onMessage: (message) => (message.phase === phase ? middleware.onMessage(message) : allow()),
  };
  phases.set(wrapped, phase);
  // Keep the declared phase inseparable from its guard; the caller's rule stays mutable.
  return Object.freeze(wrapped);
}

/** Build-time knowledge, never an inference from a callback's name or source. */
export function hasOutputMiddleware(chain: readonly MessageMiddleware[]): boolean {
  return chain.some((middleware) => phases.get(middleware) !== 'input');
}
