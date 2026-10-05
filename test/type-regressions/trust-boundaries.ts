import type { Runner } from '../../src/core/runner.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import {
  recordRun,
  trustBoundaryRecorder,
  type TrustBoundaryCounters,
  type TrustBoundaryEventSource,
  type TrustBoundaryEventType,
  type TrustBoundaryFact,
  type TrustBoundaryRecorder,
  type TrustBoundaryRecorderOptions,
  type TrustBoundarySnapshot,
} from '../../src/doors/observe.js';

declare const runner: Runner;
const options: TrustBoundaryRecorderOptions = { maxFacts: 100 };
const recorder: TrustBoundaryRecorder = trustBoundaryRecorder(options);
const dispatcher: TrustBoundaryEventSource = new EventDispatcher();
const fromRunner: TrustBoundaryEventSource = runner;
const unsubscribe = recorder.subscribe(dispatcher);
unsubscribe();
const snapshot: TrustBoundarySnapshot = recorder.toSnapshot();
const counters: TrustBoundaryCounters = snapshot.data.counters;
const pending: number = counters.pending;
const fact: TrustBoundaryFact = snapshot.data.facts[0];
const eventType: TrustBoundaryEventType = fact.eventType;
void fromRunner;
void pending;
void eventType;
void recordRun(runner, { trustBoundaries: true }).trustBoundaries;
void recordRun(runner, { trustBoundaries: options });

// @ts-expect-error Retention counters are immutable evidence.
counters.observed = 0;
// @ts-expect-error Snapshot arrays are read-only.
snapshot.data.facts.push(fact);
// @ts-expect-error Free-text reasons are outside the trust fact contract.
void fact.reason;
// @ts-expect-error No observed fact asserts that content was redacted.
void fact.redacted;
if (fact.eventType === 'agentfootprint.permission.check') {
  const result: 'allow' | 'deny' | 'halt' | 'gate_open' = fact.result;
  void result;
  // @ts-expect-error Permission checks are not middleware transformations.
  void fact.changed;
}
// @ts-expect-error Future or invented event types are not recorded facts.
const invented: TrustBoundaryEventType = 'agentfootprint.permission.gate_closed';
void invented;
