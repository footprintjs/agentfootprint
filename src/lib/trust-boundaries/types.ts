import type { AgentfootprintEvent } from '../../events/registry.js';
import type { EventSourcePosition } from '../../events/types.js';
import type { Unsubscribe } from '../../events/dispatcher.js';
import type {
  MiddlewareDecisionPayload,
  PermissionCheckPayload,
  PermissionHaltPayload,
  CredentialRequestedPayload,
  CredentialAcquiredPayload,
  CredentialFailedPayload,
} from '../../events/payloads.js';

/** Only events that the runtime actually produces; no inferred gate events. */
export type TrustBoundaryEventType =
  | 'agentfootprint.middleware.decision'
  | 'agentfootprint.permission.check'
  | 'agentfootprint.permission.halt'
  | 'agentfootprint.credential.requested'
  | 'agentfootprint.credential.acquired'
  | 'agentfootprint.credential.authorization_required'
  | 'agentfootprint.credential.failed';

interface FactOrigin {
  readonly seq: number;
  /** AgentFootprint run namespace, distinct from sourcePosition.engineRunId. */
  readonly runId: string;
  readonly runtimeStageId: string;
  /** Emission time supplied by the typed event; never replaced by arrival time. */
  readonly wallClockMs: number;
  readonly sourcePosition?: EventSourcePosition;
  readonly toolCallId?: string;
  readonly iteration?: number;
}

/** Observed metadata, not an authorization, execution, coverage or redaction guarantee. */
export type TrustBoundaryFact = FactOrigin &
  (
    | ({ readonly eventType: 'agentfootprint.middleware.decision' } & Pick<
        MiddlewareDecisionPayload,
        'middleware' | 'moment' | 'outcome' | 'changed' | 'iteration'
      >)
    | ({ readonly eventType: 'agentfootprint.permission.check' } & Pick<
        PermissionCheckPayload,
        'capability' | 'result' | 'target' | 'policyRuleId'
      >)
    | ({ readonly eventType: 'agentfootprint.permission.halt' } & Pick<
        PermissionHaltPayload,
        'target' | 'checkerId' | 'iteration'
      >)
    | ({ readonly eventType: 'agentfootprint.credential.requested' } & Pick<
        CredentialRequestedPayload,
        'service' | 'mode'
      >)
    | ({ readonly eventType: 'agentfootprint.credential.acquired' } & Pick<
        CredentialAcquiredPayload,
        'service' | 'kind'
      >)
    | {
        readonly eventType: 'agentfootprint.credential.authorization_required';
        readonly service: string;
      }
    | ({ readonly eventType: 'agentfootprint.credential.failed' } & Pick<
        CredentialFailedPayload,
        'service' | 'errorClass'
      >)
  );

/** Disjoint capture accounting, including a currently inspected selected observation. */
export interface TrustBoundaryCounters {
  readonly observed: number;
  readonly retained: number;
  readonly evicted: number;
  readonly invalid: number;
  readonly oversized: number;
  /** Selected observations whose metadata projection has not returned yet. */
  readonly pending: number;
}

export interface TrustBoundarySnapshot {
  readonly name: 'TrustBoundaries';
  readonly description: string;
  readonly meta: { readonly version: 1 };
  readonly data: {
    readonly captureId: string;
    readonly facts: readonly TrustBoundaryFact[];
    readonly counters: TrustBoundaryCounters;
    readonly firstObservedSeq: number | null;
    readonly lastObservedSeq: number | null;
    readonly firstRetainedSeq: number | null;
    readonly lastRetainedSeq: number | null;
  };
}

/** Runner and EventDispatcher both provide this narrow typed subscription port. */
export interface TrustBoundaryEventSource {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): Unsubscribe;
}

export interface TrustBoundaryRecorderOptions {
  readonly id?: string;
  /** Bounded tail capacity: default 1,000; integer 1–10,000. */
  readonly maxFacts?: number;
}

/** A typed observer, deliberately not a raw engine/CombinedRecorder. */
export interface TrustBoundaryRecorder {
  readonly id: string;
  readonly counters: TrustBoundaryCounters;
  /** One active subscription. Capture continues across run/resume/composition IDs. */
  subscribe(source: TrustBoundaryEventSource): Unsubscribe;
  /** One canonical recorder bundle; rows are owned/frozen and the array is detached. */
  toSnapshot(): TrustBoundarySnapshot;
  /** Start a new capture ID and reset counts/sequence, without changing the subscription. */
  resetCapture(): void;
}
