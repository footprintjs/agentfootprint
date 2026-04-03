/**
 * noTools — ToolProvider that provides no tools.
 */

import type { ToolProvider } from '../../core';

export function noTools(): ToolProvider {
  return {
    resolve: () => ({ value: [], chosen: 'none' }),
  };
}
