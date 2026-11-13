import type { AgentContext, AgentPublicRunner } from '../contracts.js';
import type { AgentNativeBindings } from './bindings.js';
import { createAgentContext } from '../context.js';
import { initializeAgent } from './initialize.js';

const agentContext = Symbol('Agent runtime');
type InitializedAgent = AgentPublicRunner & { readonly [agentContext]?: AgentContext };

/** Private per-runner wiring, read without dispatching an application method.
 * @internal
 */
export function getAgentRuntime(runner: AgentPublicRunner): AgentContext {
  const context = (runner as InitializedAgent)[agentContext];
  if (context === undefined) throw new TypeError('Agent runtime has not been initialized.');
  return context;
}

/** Bind the original runner's capabilities without inserting a public superclass. */
export function initializeAgentRuntime(
  runner: AgentPublicRunner,
  native: AgentNativeBindings,
  ownTurnMethods: Readonly<Record<'run' | 'resume', unknown>>,
  ...args: Parameters<typeof initializeAgent>
): void {
  const context = createAgentContext(runner, native, ownTurnMethods);
  Object.defineProperty(runner, agentContext, {
    value: context,
    enumerable: false,
    // A reactive Proxy may wrap the value returned by a read of this property.
    configurable: true,
  });
  initializeAgent.call(context, ...args);
}
