import type { TypedScope } from 'footprintjs';
import type { ActiveInjection } from '../../injection-engine/types.js';
import type { ToolProvider, ToolDispatchContext } from '../../tools/toolProvider.js';
import type { Tool } from '../../tools/tools.js';
import { emitListUses } from '../../tools/mcpClientUse.js';
import { requirePrivateQuestionSupport } from '../agent/arguments/privateAnswers.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';

type DiscoveryScope = Pick<
  TypedScope<Record<string, unknown>>,
  '$getArgs' | '$getEnv' | '$getValue' | '$emit'
>;

/**
 * One current catalog acquisition for normal Discover and fresh pause resume.
 * Executable tools remain private to the admitted native component. No saved
 * Tool[] or another party's registry can answer a withdrawn provider name.
 */
export async function discoverTools(
  scope: DiscoveryScope,
  config: {
    readonly provider: ToolProvider;
    readonly cache?: { current: readonly Tool[]; resolved?: true };
    readonly callerIdentity?: ToolDispatchContext['callerIdentity'];
    readonly iteration?: number;
  },
): Promise<void> {
  const toolProvider = config.provider;
  if (config.cache) {
    config.cache.current = [];
    delete config.cache.resolved;
  }
  scope.$getEnv().signal?.throwIfAborted();
  const args = scope.$getArgs<{ iteration?: number }>();
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
    .filter((inj) => inj.flavor === 'skill')
    .map((inj) => inj.id);
  // The caller's own identity, never a derived one (`ToolDispatchContext.callerIdentity`).
  const callerIdentity = config.callerIdentity;
  const ctx: ToolDispatchContext = {
    iteration,
    ...(activatedIds.length > 0 && { activeSkillId: activatedIds[activatedIds.length - 1] }),
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
  try {
    // Dynamic check — sync providers skip the await microtask.
    const result = toolProvider.list(ctx);
    visibleTools = result instanceof Promise ? await result : result;
    scope.$getEnv().signal?.throwIfAborted();
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
    config.cache.resolved = true;
  }
}

/** Normal Discover already acquired the list; fresh resume must reacquire it. */
export function ensureDiscoveredTools(
  scope: DiscoveryScope,
  config: Parameters<typeof discoverTools>[1],
): Promise<void> | undefined {
  return config.cache?.resolved === true ? undefined : discoverTools(scope, config);
}
