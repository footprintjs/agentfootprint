/**
 * staticTools — the simplest ToolProvider. Wraps a fixed Tool[] list.
 *
 * 90% case. What `agent.tools(arr)` does today, made composable.
 * Equivalent to passing `arr` directly EXCEPT that `staticTools(arr)`
 * is now a `ToolProvider` you can wrap with `gatedTools(...)` for
 * permission filtering or per-skill gating.
 *
 * Pattern: identity ToolProvider — no filtering, just exposes the
 *          underlying list verbatim.
 *
 * @example
 *   const provider = staticTools([weatherTool, lookupTool]);
 *   const agent = Agent.create({ provider, model }).toolProvider(provider).build();
 */

import type { Tool } from '../core/tools.js';
import type { ToolProvider, ToolDispatchContext } from './types.js';

// #region staticTools
export function staticTools(tools: readonly Tool[]): ToolProvider {
  // Capture the input list once. `list()` returns a fresh array each
  // call so the agent's reference-equality check always sees an update
  // (matches the `gatedTools` decorator's per-call recomputation).
  const captured = [...tools];
  return {
    id: 'static',
    list(_ctx: ToolDispatchContext): readonly Tool[] {
      return [...captured];
    },
  };
}
// #endregion staticTools
