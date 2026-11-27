import type { TypedScope } from 'footprintjs';
import type { ActiveInjection } from '../../injection-engine/types.js';
import type { ToolProvider, ToolDispatchContext } from '../../tools/toolProvider.js';
import type { Tool } from '../../tools/tools.js';
import { listWithSelectionDecisions } from '../../tools/selectionListing.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';
import { providerOmissions, type DiscoveryOmissions } from './providerOmissions.js';
import { emitListUses } from '../../tools/mcpClientUse.js';
import { requirePrivateQuestionSupport } from '../agent/arguments/privateAnswers.js';
import { skillVisibleToRole } from '../../lib/spokenIds.js';
import type { SkillRoleView } from '../agent/skillContext/toolVisibility.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import {
  resultRowsetCatalog,
  clearProviderRowsets,
  holdProviderRowsets,
  type ResultRowsetCatalog,
} from '../agent/resultRowsets/catalog.js';

type DiscoveryScope = Pick<
  TypedScope<Record<string, unknown>>,
  '$getArgs' | '$getEnv' | '$getValue' | '$emit'
>;

/** Native component's private catalog. An omission here describes discovery only. */
export interface ProviderToolCache {
  current: readonly Tool[];
  /** Successful acquisition in this component, including a genuinely empty list. */
  resolved?: true;
  selectionOmissions?: DiscoveryOmissions;
}

/**
 * One current catalog acquisition for normal Discover and fresh pause resume.
 * Executable tools remain private to the admitted native component. No saved
 * Tool[] or another party's registry can answer a withdrawn provider name.
 */
export async function discoverTools(
  scope: DiscoveryScope,
  config: {
    readonly provider: ToolProvider;
    readonly cache?: ProviderToolCache;
    readonly callerIdentity?: ToolDispatchContext['callerIdentity'];
    readonly iteration?: number;
    /** The mount has positively established unrestricted skill visibility. */
    readonly defaultHiddenSkillIds?: readonly string[];
    /** Fresh admission overrides role state from a saved turn. */
    readonly roleView?: SkillRoleView;
    /** A compose acquisition has the registry's ownership evidence. Reacquiring for dispatch is not a new offer. */
    readonly claimants?: ReadonlyMap<string, readonly ToolClaim[]>;
  },
): Promise<void> {
  const toolProvider = config.provider;
  if (config.cache) {
    clearProviderRowsets(config.cache);
    config.cache.current = [];
    delete config.cache.resolved;
    delete config.cache.selectionOmissions;
  }
  scope.$getEnv().signal?.throwIfAborted();
  const args = scope.$getArgs<{ iteration?: number; hiddenSkillIds?: readonly string[] }>();
  const hiddenIds =
    config.roleView === undefined
      ? args.hiddenSkillIds ?? config.defaultHiddenSkillIds
      : config.roleView.hiddenSkillIds;
  const hidden = hiddenIds === undefined ? undefined : new Set(hiddenIds);
  const iteration = config.iteration ?? args.iteration ?? 1;
  const env = scope.$getEnv();
  const activatedIds =
    (scope.$getValue('activatedInjectionIds') as readonly string[] | undefined) ?? [];
  const identity = scope.$getValue('runIdentity') as
    | { tenant?: string; principal?: string; conversationId: string }
    | undefined;
  // `activeSkillIds` is the REAL active set (8.7.0) — every skill the injection
  // engine resolved for this iteration, whatever activated it. `activeSkillId`
  // stays what it always was: the tail of `activatedInjectionIds`, which only
  // `read_skill` writes. The two answer different questions and both are needed.
  const activeSkillIds = (
    (scope.$getValue('activeInjections') as readonly ActiveInjection[] | undefined) ?? []
  )
    .filter((inj) => inj.flavor === 'skill' && skillVisibleToRole(inj.id, hidden))
    .map((inj) => inj.id);
  // The caller's own identity, never a derived one (`ToolDispatchContext.callerIdentity`).
  const callerIdentity = config.callerIdentity;
  const lastActivated = activatedIds.at(-1);
  const ctx: ToolDispatchContext = {
    iteration,
    ...(skillVisibleToRole(lastActivated, hidden) && { activeSkillId: lastActivated }),
    ...(activeSkillIds.length > 0 && { activeSkillIds }),
    ...(identity && { identity }),
    ...(callerIdentity !== undefined && { callerIdentity }),
    ...(env.signal && { signal: env.signal }),
  };

  typedEmit(scope, 'agentfootprint.tools.discovery_started', {
    providerId: toolProvider.id,
    iteration,
  });

  const startMs = Date.now();
  let visibleTools: readonly Tool[];
  let omissions: ReturnType<typeof providerOmissions> | undefined;
  const claimants = config.claimants;
  let rowsetCatalog: ResultRowsetCatalog;
  try {
    // Dynamic check — sync providers skip the await microtask.
    const result =
      config.cache && claimants
        ? listWithSelectionDecisions(toolProvider, ctx, (candidate) => {
            omissions ??= providerOmissions(claimants, hiddenIds);
            omissions.observe(candidate);
          })
        : toolProvider.list(ctx);
    visibleTools = result instanceof Promise ? await result : result;
    scope.$getEnv().signal?.throwIfAborted();
    rowsetCatalog = resultRowsetCatalog(
      visibleTools.map((tool) => [tool.schema.name, tool] as const),
    );
  } catch (err) {
    // An MCP client pool's use of a client is recorded whether or not its
    // listing succeeded (`tools/mcpClientUse.ts`).
    emitListUses(scope, ctx);
    // Discovery failure is loud by design. Emit the typed event
    // with the providerId so consumers can route alerts; then
    // re-throw so a configured `reliability` rule decides whether
    // to retry / fall back / fail-fast. Silently dropping tools
    // mid-conversation creates non-deterministic agent behavior
    // harder to debug than a crash.
    const errMessage = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : 'Error';
    typedEmit(scope, 'agentfootprint.tools.discovery_failed', {
      providerId: toolProvider.id,
      error: errMessage,
      errorName: errName,
      iteration,
      durationMs: Date.now() - startMs,
    });
    throw err;
  }

  requirePrivateQuestionSupport(scope, visibleTools);
  emitListUses(scope, ctx);
  typedEmit(scope, 'agentfootprint.tools.discovery_completed', {
    providerId: toolProvider.id,
    iteration,
    durationMs: Date.now() - startMs,
    toolCount: visibleTools.length,
  });

  // Cache the resolved Tool[] in this component's private ProviderToolCache.
  // The Compose stage reads providerSchemas from here; the toolCalls
  // handler reads the executable Tool objects on dispatch. Both share
  // ONE list() call per iteration. The cache lives outside scope
  // because Tool objects carry `execute` functions that can't be
  // `structuredClone`d into the transactional memory layer.
  if (config.cache) {
    config.cache.current = visibleTools;
    const retained = omissions?.result();
    if (retained) config.cache.selectionOmissions = retained;
    holdProviderRowsets(config.cache, rowsetCatalog);
    config.cache.resolved = true;
  }
}
