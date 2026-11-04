import {
  createRunLifecycle,
  type BoundRun,
  type ComponentRun,
  type ComponentSetup,
  type FlowChart,
  type FlowChartExecutorOptions,
  type NativeRunOrigin,
  type OwnedRun,
  type RunEntry,
  type RunLifecycle,
  type RunSetup,
  type RunSlot,
  type RunView,
  type ScopeFactory,
} from 'footprintjs';
import { createTypedScopeFactory } from 'footprintjs/advanced';

import type { RunContext } from '../bridge/eventMeta.js';
import { nativeEntryFor } from './runEntry.js';

/** Domain metadata only. The execution engine is the sole run-id and clock authority. */
export type RunnerMetadata = Omit<RunContext, 'runId' | 'runStartMs'>;

interface RunnerValues<T> {
  readonly value: T;
  readonly own: boolean;
}

export type RunnerEntry =
  | { readonly kind: 'run' }
  | { readonly kind: 'resume'; readonly mode: 'same' | 'fresh' };

export type RunnerComponentInstaller<T> = (
  component: ComponentRun,
  value: T,
  entry: RunnerEntry | undefined,
) => ComponentSetup;

interface LegMetadata {
  readonly metadata: RunnerMetadata;
  readonly entry: RunnerEntry;
  readonly bindScope?: (scope: unknown, context: Parameters<ScopeFactory>[0]) => void;
}

export interface RunnerInvocation<T> {
  readonly value: T;
  readonly run: OwnedRun;
  /** Captured for this admission; never follows a later active/latest selection. */
  readonly view: RunView;
  readonly previous: RunnerSelection<T> | undefined;
  context(): RunContext;
  execute(
    entry: RunEntry,
    setup?: RunSetup,
    binding?: {
      readonly metadata?: RunnerMetadata;
      readonly bindScope?: LegMetadata['bindScope'];
    },
  ): ReturnType<OwnedRun['execute']>;
}

export interface RunnerScopeValues<T> {
  /** Live native retirement, captured for this scope rather than a selected run. */
  readonly retired: boolean;
  readonly value: T;
  readonly context: RunContext;
  readonly own: boolean;
}

export interface RunnerSelection<T> {
  readonly value: T;
  readonly context: RunContext;
  readonly view: RunView;
}

/**
 * A stable chart stage over an explicit native scope port. The dependency
 * closure is captured before callbacks or awaits and never reads a selected run.
 */
export function bindRunnerStage<T, S extends object, A extends unknown[], R>(
  forScope: (scope: S) => RunnerScopeValues<T>,
  bind: (run: RunnerScopeValues<T>) => (scope: S, ...args: A) => R,
): (scope: S, ...args: A) => R {
  return (scope, ...args) => bind(forScope(scope))(scope, ...args);
}

/**
 * Metadata carried by the actual executor's scope factory. A mounted runner
 * reads the host facts of THAT scope, never its own instance's latest run.
 * This map has no admission, continuation, active/latest pointer or state bank.
 */
const hostContexts = new WeakMap<object, RunContext>();

function metadataOf(metadata: RunnerMetadata): RunnerMetadata {
  const {
    compositionPath,
    traceId,
    correlationId,
    turnIndex,
    iterIndex,
    sessionId,
    principal,
    tenant,
  } = metadata;
  return Object.freeze({
    compositionPath: Object.freeze([...compositionPath]),
    ...(traceId !== undefined && { traceId }),
    ...(correlationId !== undefined && { correlationId }),
    ...(turnIndex !== undefined && { turnIndex }),
    ...(iterIndex !== undefined && { iterIndex }),
    ...(sessionId !== undefined && { sessionId }),
    ...(principal !== undefined && { principal }),
    ...(tenant !== undefined && { tenant }),
  });
}

function contextOf(origin: NativeRunOrigin, metadata: RunnerMetadata): RunContext {
  return Object.freeze({
    ...metadataOf(metadata),
    runId: origin.runId,
    runStartMs: origin.startedAtMs,
  });
}

/**
 * AgentFootprint's domain adapter over the native lifecycle. It adds metadata
 * and private domain values; all ownership, scope banks, continuations and
 * active/latest selection remain the footprintjs implementation.
 */
export class RunnerExecution<T> {
  private readonly lifecycle: RunLifecycle;
  private readonly values: RunSlot<RunnerValues<T>>;
  private readonly metadata: RunSlot<LegMetadata>;
  private readonly byOrigin = new WeakMap<NativeRunOrigin, RunnerValues<T>>();
  private readonly metadataByOrigin = new WeakMap<NativeRunOrigin, RunnerMetadata>();

  constructor(
    chart: FlowChart,
    private readonly defaults: {
      readonly runnerId: string;
      readonly compositionPath: readonly string[];
    },
    private readonly initialize: () => T,
    options?: FlowChartExecutorOptions,
    installComponent?: RunnerComponentInstaller<T>,
  ) {
    this.defaults = Object.freeze({
      ...defaults,
      compositionPath: Object.freeze([...defaults.compositionPath]),
    });
    const base = options?.scopeFactory ?? chart.scopeFactory ?? createTypedScopeFactory();
    this.lifecycle = createRunLifecycle(chart, {
      runnerId: defaults.runnerId,
      componentSetup: (component) => {
        const values = component.local(this.values, () => ({
          value: this.initialize(),
          own: false,
        }));
        const leg = component.read(this.metadata);
        return (
          installComponent?.(
            component,
            values.value,
            values.own && leg.present ? leg.value.entry : undefined,
          ) ?? {}
        );
      },
      executorOptions: {
        ...options,
        scopeFactory: (context, stage, readOnly, env) => {
          const scope = base(context, stage, readOnly, env);
          if (scope !== null && typeof scope === 'object') {
            const bound = this.lifecycle.forScope(scope);
            const leg = bound.read(this.metadata);
            const metadata = leg.present ? leg.value.metadata : this.defaults;
            hostContexts.set(scope, contextOf(bound.origin, metadata));
            if (leg.present) leg.value.bindScope?.(scope, context);
          }
          return scope;
        },
      },
    });
    this.values = this.lifecycle.slot('component');
    this.metadata = this.lifecycle.slot('leg');
  }

  withRun<R>(body: (invocation: RunnerInvocation<T>) => R | Promise<R>): Promise<R> {
    const prior: { previous: RunnerSelection<T> | undefined } = { previous: this.selected() };
    return this.lifecycle.withRun(async (run) => {
      const view = this.lifecycle.view();
      if (view === undefined) throw new TypeError('The admitted native execution has no view');
      // Initialization, including any callback it invokes, is under native admission.
      const values: RunnerValues<T> = { value: this.initialize(), own: true };
      run.set(this.values, values);
      let metadata: RunnerMetadata = metadataOf(this.defaults);
      const invocation: RunnerInvocation<T> = {
        value: values.value,
        run,
        view,
        get previous() {
          return prior.previous;
        },
        context: () => {
          if (run.origin === undefined)
            throw new TypeError('The native run has no admitted origin yet');
          return contextOf(run.origin, metadata);
        },
        execute: (entry, setup, binding) => {
          metadata = metadataOf(binding?.metadata ?? this.defaults);
          return run.execute(nativeEntryFor(entry), {
            ...setup,
            onOrigin: (cells, origin) => {
              cells.set(this.metadata, {
                metadata,
                entry:
                  entry.kind === 'run' ? { kind: 'run' } : { kind: 'resume', mode: entry.mode },
                bindScope: binding?.bindScope,
              });
              this.byOrigin.set(origin, values);
              this.metadataByOrigin.set(origin, metadata);
              return setup?.onOrigin?.(cells, origin);
            },
          });
        },
      };
      try {
        return await body(invocation);
      } finally {
        prior.previous = undefined;
      }
    });
  }

  /** One component's values, including internal charts; independent mounts do not share. */
  forScope(scope: unknown): RunnerScopeValues<T> {
    const bound: BoundRun = this.lifecycle.forScope(scope);
    const values = bound.local(this.values, () => ({ value: this.initialize(), own: false }));
    const host = scope !== null && typeof scope === 'object' ? hostContexts.get(scope) : undefined;
    const metadata: RunnerMetadata =
      host === undefined
        ? this.defaults
        : { ...host, compositionPath: [...host.compositionPath, ...this.defaults.compositionPath] };
    const ownMetadata = bound.read(this.metadata);
    return {
      ...values,
      get retired() {
        return bound.retired;
      },
      context: contextOf(bound.origin, ownMetadata.present ? ownMetadata.value.metadata : metadata),
    };
  }

  /** Reads exactly the native-selected execution, including the in-progress run. */
  selected(): RunnerSelection<T> | undefined {
    const view = this.lifecycle.view();
    const origin = view?.origin;
    if (view === undefined || origin === undefined) return undefined;
    const values = this.byOrigin.get(origin);
    const metadata = this.metadataByOrigin.get(origin);
    if (values === undefined || metadata === undefined) return undefined;
    return { value: values.value, context: contextOf(origin, metadata), view };
  }

  view(): RunView | undefined {
    return this.lifecycle.view();
  }

  continuation(): ReturnType<RunLifecycle['continuation']> {
    return this.lifecycle.continuation();
  }
}
