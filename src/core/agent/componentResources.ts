import type { ComponentRun } from 'footprintjs';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import type { RunContext } from '../../bridge/eventMeta.js';
import type { ToolSessionTier, ToolSessionView } from '../../tools/toolSessions.js';
import {
  newToolOwner,
  nextToolDispatch,
  readToolOwner,
  type ToolCallOwner,
  type ToolOwnerCarrier,
} from '../../tools/toolResourceOwner.js';

export interface ResourceScope {
  $getValue(key: string): unknown;
  $setValue(key: string, value: unknown): void;
}
export interface ResourceFacts {
  readonly runContext: RunContext;
  readonly runId: string;
  readonly identity?: MemoryIdentity;
  readonly sessionId?: string;
}
export interface ComponentResources {
  /** Positive new-turn entry; resume may skip it and must restore the saved reference. */
  seed(scope: ResourceScope): void;
  restore(scope: ResourceScope, facts: ResourceFacts): void;
  context(
    scope: ResourceScope,
    facts: ResourceFacts,
  ): {
    readonly view: ToolSessionView;
    readonly owner: ToolCallOwner;
  };
  endCall(scope: ResourceScope): Promise<void>;
  /** A named answer refusal consumed nothing; keep the prior paused owner. */
  retainPause(): void;
  /** Explicit host abandonment of this exact retained paused owner. */
  abandon(): Promise<void>;
}
const KEY = 'toolResourceOwner';

/** The existing tier owns borrows; this component holds only its captured view. */
export function componentResources(
  component: ComponentRun,
  tier: () => ToolSessionTier,
): ComponentResources {
  let carrier: ToolOwnerCarrier | undefined;
  let view: ToolSessionView | undefined;
  let closed = false;
  let retainedPause = false;
  let binding: ResourceFacts | undefined;
  const restore = (scope: ResourceScope, facts: ResourceFacts): void => {
    if (closed) throw new TypeError('Tool resource component is retired');
    if (view !== undefined) {
      view.assertActive();
      return;
    }
    const saved = scope.$getValue(KEY);
    if (saved === undefined) throw new TypeError('Tool resource owner checkpoint is missing');
    const admitted = readToolOwner(saved);
    // A failed/absent restoration never closes an earlier paused owner's rows.
    const snapshot = Object.freeze({
      ...facts,
      ...(facts.identity !== undefined && { identity: Object.freeze({ ...facts.identity }) }),
    });
    const borrowed = tier().borrow(admitted, snapshot);
    binding = snapshot;
    carrier = admitted;
    view = borrowed;
    scope.$setValue(KEY, admitted);
  };
  component.onFinalize(async (end) => {
    closed = true;
    await view?.finish(end.kind === 'paused' || retainedPause);
  });
  return {
    seed(scope) {
      if (closed) throw new TypeError('Tool resource component is retired');
      const saved = scope.$getValue(KEY);
      const admitted = saved === undefined ? newToolOwner(component.entry) : readToolOwner(saved);
      carrier = admitted;
      scope.$setValue(KEY, admitted);
    },
    restore,
    retainPause() {
      if (closed) throw new TypeError('Tool resource component is retired');
      retainedPause = true;
    },
    async abandon() {
      if (carrier === undefined || binding === undefined) return;
      await tier().borrow(carrier, binding).finish(false);
    },
    context(scope, facts) {
      restore(scope, facts);
      const next = nextToolDispatch(carrier!);
      // A tracked checkpoint carrier, not an external crash-atomic commit.
      scope.$setValue(KEY, next);
      carrier = next;
      return { view: view!, owner: next.pending! };
    },
    async endCall(scope) {
      const pending = carrier?.pending;
      if (pending === undefined || view === undefined) return;
      view.assertActive();
      await view.fireCall(pending);
      carrier = readToolOwner({
        version: 1,
        birth: carrier!.birth,
        nextDispatch: carrier!.nextDispatch,
      });
      scope.$setValue(KEY, carrier);
    },
  };
}
