/**
 * Tools slot types.
 *
 * The Tools slot resolves available tools before each LLM call.
 * Always mounted as a subflow — config determines internal stages:
 *   - Fixed set: 1 stage [ResolveTools]
 *   - Gated: 2 stages [CheckPermissions → ResolveTools]
 *   - Dynamic: 2 stages [ClassifyContext → ResolveTools]
 */

import type { ToolProvider } from '../../../core';

/**
 * Config for the Tools slot subflow.
 */
export interface ToolsSlotConfig {
  /** The tool provider strategy (static, dynamic, gated, composite, etc.). */
  readonly provider: ToolProvider;
}
