/**
 * scopeFactory — creates a ScopeFacade-based scope for each stage.
 *
 * agentfootprint stage functions are typed as (scope: ScopeFacade) and use
 * scope.getValue / scope.setValue. footprintjs v3+ auto-embeds TypedScope via
 * flowChart(), which proxies property access but does not expose getValue/setValue
 * on the proxy surface. Passing this factory to FlowChartExecutor bypasses
 * TypedScope and gives stage functions a plain ScopeFacade instance.
 */

import type { ScopeFactory, ExecutionEnv } from 'footprintjs';
import { StageContext } from 'footprintjs/advanced';
import { ScopeFacade } from 'footprintjs/advanced';

export const agentScopeFactory: ScopeFactory<ScopeFacade> = (
  ctx: StageContext,
  stageName: string,
  readOnly?: unknown,
  env?: ExecutionEnv,
): ScopeFacade => new ScopeFacade(ctx, stageName, readOnly, env);
