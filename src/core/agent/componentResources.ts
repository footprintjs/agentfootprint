import type { AgentfootprintEventMap } from '../../events/registry.js';
import { AnswerConsumption } from '../answerConsumption.js';
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
type RestoreStatus = AgentfootprintEventMap['agentfootprint.tools.resource_restore']['payload'];
export interface ComponentResources {
  bindReporter(report: (status: RestoreStatus) => void): void;
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
  /** Answer admission is separate from native execution admission. */
  expectAnswer(): void;
  readonly answer: AnswerConsumption;
  /** Explicit host abandonment of this exact retained paused owner. */
  abandon(): Promise<void>;
  /** Minimal retained cleanup; no component/run-value bank or later selection. */
  captureAbandon(): (() => Promise<void>) | undefined;
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
  let awaitingAnswer = false;
  const answer = new AnswerConsumption();
  let binding: ResourceFacts | undefined;
  let reporter: ((status: RestoreStatus) => void) | undefined;
  const report = (status: RestoreStatus): void => {
    try {
      reporter?.(status);
    } catch {
      /* observation cannot own cleanup */
    }
  };
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
    const pool = tier();
    const local = pool.localStatus(admitted, snapshot);
    const borrowed = pool.borrow(admitted, snapshot);
    if (awaitingAnswer) report({ local, remote: 'unknown' });
    binding = snapshot;
    carrier = admitted;
    view = borrowed;
    scope.$setValue(KEY, admitted);
  };
  component.onFinalize(async (end) => {
    closed = true;
    if (awaitingAnswer && view === undefined) report({ local: 'unconfirmed', remote: 'unknown' });
    await view?.finish(end.kind === 'paused' || (awaitingAnswer && !answer.consumed));
  });
  return {
    bindReporter(next) {
      reporter ??= next;
    },
    seed(scope) {
      if (closed) throw new TypeError('Tool resource component is retired');
      const admitted = newToolOwner(component.entry);
      carrier = admitted;
      scope.$setValue(KEY, admitted);
    },
    restore,
    expectAnswer() {
      if (closed) throw new TypeError('Tool resource component is retired');
      awaitingAnswer = true;
    },
    answer,
    async abandon() {
      if (carrier === undefined || binding === undefined) return;
      await retainedResourceCleanup(tier(), carrier, binding.identity, binding.sessionId)();
    },
    captureAbandon() {
      return carrier === undefined || binding === undefined
        ? undefined
        : retainedResourceCleanup(tier(), carrier, binding.identity, binding.sessionId);
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

/** Separate activation: the retained closure contains only the pool and owner facts. */
function retainedResourceCleanup(
  pool: ToolSessionTier,
  owner: ToolOwnerCarrier,
  identity: MemoryIdentity | undefined,
  sessionId: string | undefined,
): () => Promise<void> {
  return async () => {
    await pool.borrow(owner, { identity, sessionId }).finish(false);
  };
}
