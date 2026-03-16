/**
 * noTools — ToolProvider that provides no tools.
 *
 * Use for agents that only need text responses (no function calling).
 * This is the default when no tool provider is specified.
 *
 * Usage:
 *   agentLoop().toolProvider(noTools())
 */

import type { ToolProvider } from '../../core';

export function noTools(): ToolProvider {
  return {
    resolve: () => [],
    // No execute — there are no tools to call
  };
}
