/**
 * runRedaction — one run's redaction: the policy in force, the rule it is
 * decided by, and the two places an event leaves a stage.
 *
 * Pattern: a per-run object (`createRunRedaction`) opened by the runner that
 *          owns the executor (`RunnerBase · openRunRedaction`), plus a scope
 *          registry so the one emit helper can find the run a stage belongs to.
 * Role:    the Walker half of `src/redaction/` — the wiring every runner's
 *          `createExecutor` goes through, for every run, policy or not.
 *
 * WHY EVENTS ARE SERVED AT THEIR SOURCE. A typed event leaves a stage through
 * footprintjs's `$emit`, and footprintjs hands that payload to every channel
 * at once: the runner's EmitBridge (→ `agent.on`), every recorder attached to
 * the executor, the deferred-observer tier, and the executor's own narrative
 * (`[emit] name: payload` lines). footprintjs serves a `$emit` payload by its
 * NAME only (`emitPatterns`); a selected key inside it reaches all of those as
 * it is. Serving it anywhere downstream would be serving it in one channel of
 * five. So `emitServed` serves it BEFORE `$emit`, once, and every channel gets
 * the same served payload — footprintjs's own rule for a record handed out
 * whole: decided once, at the boundary, before any observer sees it.
 *
 * WHY THERE IS A SECOND, REAL-VALUE PATH. A handful of the library's own
 * mechanisms run ON events: the crash checkpoint `resumeOnError` replays
 * (`Agent · installCheckpointTracker`), the window strategy's token reading
 * (`CompactionMeter`), the reply a hosted agent streams to the person who
 * asked (`standingAgent`), the reply `toSSE({ format: 'text' })` streams. Each
 * is what the agent computes on or hands back to its caller — the class the
 * redaction law never covers (live state, the resume checkpoint, the caller's
 * own answer). They read the event as the stage produced it, through
 * `EventDispatcher · onRealEvent`, which no consumer can reach. Nothing on
 * that path is a record: it is never stored, exported or shown.
 *
 * WHY A FEW WRITES ARE RELAYED. Some events are DERIVED from scope writes
 * rather than emitted: the context recorder turns each slot's injection and
 * composition writes into `context.injected` / `slot_composed` /
 * `budget_pressure`. The scope channel serves a write of a selected key as the
 * placeholder, and an event derived from a placeholder is no event — the
 * record would deny the injections happened instead of keeping their content
 * out. So those writes go through `setEventSource`, which hands the written
 * value to the run (`RunRedaction · takeRealWrite`) as it writes it; the
 * recorder derives from that value, and the event it dispatches is served by
 * name like every other.
 *
 * THE RULE. Events are decided by the executor's OWN rule — the one footprintjs
 * builds from the policy for the run and installs on every stage context
 * (`StageContext · getRedactionRule`) — so a mark the run made (a per-call
 * `$setValue(key, value, true)`, a subflow mapper's copy of a selected value
 * under a new name) covers the events too. Until the first stage has started
 * there is no executor rule to read, so a rule built from the same policy
 * stands in: it has marked nothing, and neither has the run.
 */

import { createTypedScopeFactory, RedactionRule } from 'footprintjs/advanced';
import type { FlowChart, FlowChartExecutor, RedactionPolicy, ScopeFactory } from 'footprintjs';

import { buildEventMeta, type RunContext } from '../bridge/eventMeta.js';
import type { EventDispatcher } from '../events/dispatcher.js';
import type { AgentfootprintEvent } from '../events/registry.js';
import { eventServing, type EventServing } from './served.js';
import { redactionMarker } from './marker.js';

/** One run's redaction, as the runner that owns the executor holds it. */
export interface RunRedaction {
  /** The policy in force for this run — declared ∪ handed down — or `undefined`. */
  readonly policy: RedactionPolicy | undefined;
  /** What this run's events are served as. */
  readonly serving: EventServing;
  /**
   * The scope factory for this run's executor: the chart's own factory, with
   * every scope it makes tied to this run (source serving and the real-value
   * path both find the run through it).
   */
  scopeFactoryFor(spec: FlowChart): ScopeFactory;
  /**
   * Hand the policy to the executor — before `run()` / `resume()` — and mark
   * its served snapshot as served under one (`marker.ts`).
   */
  applyTo(executor: FlowChartExecutor): void;
  /**
   * The value the stage `runtimeStageId` wrote under `key` through
   * `setEventSource` — the oldest one not yet taken — for a recorder whose
   * served write is the placeholder (`ContextRecorder`). `keptOut` says the
   * run's rule selects `key` itself: what is DERIVED from the value then keeps
   * that verdict (footprintjs's rule for an object written under a selected
   * name), so the recorder serves the derived record's content as the
   * placeholder and keeps only its structure. `undefined` when none waits: the
   * run has no policy (the served write IS the value), or the write did not
   * come through `setEventSource`.
   */
  takeRealWrite(
    runtimeStageId: string,
    key: string,
  ): { readonly value: unknown; readonly keptOut: boolean } | undefined;
}

/** What a stage's scope is tied to — internal to this module and its helpers. */
interface ScopeRun {
  readonly policy: RedactionPolicy | undefined;
  readonly serving: EventServing;
  /** Deliver an event, as made, to the real-value path — from the stage `stageId` that emitted it. */
  real(type: string, payload: unknown, stageId: string): void;
  noteWrite(runtimeStageId: string, key: string, value: unknown): void;
  /** Whether the run's rule keeps `name` out of its records. */
  keepsOut(name: string): boolean;
}

/**
 * Every executor a run opened → the policy it was handed (`undefined` for one
 * handed none) — set by `applyTo`, the one place an executor gets its policy,
 * so what a snapshot is served under is a fact about THAT executor and can
 * never be another run's (`policyOfExecutor`). Weak: dies with the executor.
 */
const executorPolicies = new WeakMap<object, RedactionPolicy | undefined>();

/**
 * The policy `executor` was handed when its run opened — what its snapshot
 * must be served under (`RunnerBase · getLastSnapshot`). `undefined` for an
 * executor handed none, or one no run opened.
 */
export function policyOfExecutor(executor: object): RedactionPolicy | undefined {
  return executorPolicies.get(executor);
}

/** Every scope a run's executor made → that run, and the stage it was made for. Weak: a scope dies with its stage. */
const scopeRuns = new WeakMap<object, { readonly run: ScopeRun; readonly stageId: string }>();

/**
 * Open the redaction for one run. Called by every runner's `createExecutor`
 * for every run — with no policy the serving is the identity and nothing is
 * walked, but the scopes are still tied to the run, because the real-value path
 * is wiring, not redaction.
 */
export function createRunRedaction(args: {
  readonly policy: RedactionPolicy | undefined;
  readonly dispatcher: EventDispatcher;
  readonly getRunContext: () => RunContext;
}): RunRedaction {
  const { policy, dispatcher, getRunContext } = args;
  // Stands in until a stage context offers the executor's own rule.
  let rule = new RedactionRule(policy);
  const serving = eventServing(() => rule, (policy?.emitPatterns?.length ?? 0) > 0);
  // Relayed writes waiting for their recorder, oldest first, per stage and key.
  // Keyed by the stage's runtimeStageId (unique per execution), so an entry no
  // recorder claims (a deferred tier that dropped the write) can never be
  // handed to a later write — it is held, in memory only, until this run's
  // redaction is dropped when the next run opens.
  const waiting = new Map<string, { readonly value: unknown; readonly keptOut: boolean }[]>();
  const slot = (runtimeStageId: string, key: string): string => `${runtimeStageId}\u001f${key}`;
  const run: ScopeRun = {
    policy,
    serving,
    real(type, payload, stageId) {
      if (!dispatcher.hasRealListeners()) return;
      // The stage's position, as the bridge stamps it on the served twin
      // (`buildEventMeta`); only footprintjs's `sourcePosition` is the bridge's alone.
      const origin = stageId !== '' ? { runtimeStageId: stageId } : undefined;
      dispatcher.deliverReal({
        type,
        payload,
        meta: buildEventMeta(origin, getRunContext()),
      } as unknown as AgentfootprintEvent);
    },
    keepsOut(name) {
      return policy !== undefined && rule.isKeyRedacted(name);
    },
    noteWrite(runtimeStageId, key, value) {
      // No policy: the scope channel serves the write as written — nothing to relay.
      if (policy === undefined) return;
      const at = slot(runtimeStageId, key);
      const written = { value, keptOut: rule.isKeyRedacted(key) };
      const queue = waiting.get(at);
      if (queue === undefined) waiting.set(at, [written]);
      else queue.push(written);
    },
  };
  return {
    policy,
    serving,
    scopeFactoryFor(spec) {
      // Every chart the builder makes carries its factory; the fallback is the
      // builder's own default, so a hand-built chart scopes the same way.
      const base: ScopeFactory = spec.scopeFactory ?? createTypedScopeFactory();
      return (context, stageName, readOnlyContext, executionEnv) => {
        const scope = base(context, stageName, readOnlyContext, executionEnv);
        if (scope !== null && typeof scope === 'object') {
          // The traverser stamps the stage's runtimeStageId before it builds the scope.
          scopeRuns.set(scope as object, { run, stageId: context?.runtimeStageId ?? '' });
        }
        const own = context?.getRedactionRule?.();
        if (own !== undefined) rule = own;
        return scope;
      };
    },
    applyTo(executor) {
      executorPolicies.set(executor, policy);
      if (policy === undefined) return;
      executor.setRedactionPolicy(policy);
      // The served snapshot says so itself (`marker.ts`): readers of the record
      // read a placeholder as kept out only when a policy covered the run.
      executor.attachCombinedRecorder(redactionMarker());
    },
    takeRealWrite(runtimeStageId, key) {
      const at = slot(runtimeStageId, key);
      const queue = waiting.get(at);
      if (queue === undefined) return undefined;
      const written = queue.shift();
      if (queue.length === 0) waiting.delete(at);
      return written;
    },
  };
}

/**
 * The serving for facts a runner dispatches BEFORE its run's executor exists —
 * a resume's `pause.resume`, whose payload is the person's reply — under the
 * policy that run will be covered by. A rule built from the policy alone: no
 * stage has run yet, so the run has marked nothing. `undefined` with no
 * policy (the identity).
 */
export function servingAhead(policy: RedactionPolicy | undefined): EventServing | undefined {
  if (policy === undefined) return undefined;
  const rule = new RedactionRule(policy);
  return eventServing(() => rule, (policy.emitPatterns?.length ?? 0) > 0);
}

/** A scope that can emit — structurally footprintjs's `TypedScope` `$emit`. */
export interface EmitScope {
  $emit(name: string, payload?: unknown): void;
}

/**
 * THE way a typed event leaves a stage. The real value goes to the run's own
 * mechanisms (`onRealEvent`), the served value to footprintjs's `$emit` — and
 * from there to every channel at once. A scope no run made (a stage function
 * called directly, in a unit test) emits the payload as it is, exactly as
 * before this file existed.
 */
export function emitServed(scope: EmitScope, type: string, payload: unknown): void {
  const entry = scopeRuns.get(scope as object);
  if (entry === undefined) {
    scope.$emit(type, payload);
    return;
  }
  entry.run.real(type, payload, entry.stageId);
  scope.$emit(type, entry.run.serving.payload(type, payload));
}

/** A scope that can set a value — structurally footprintjs's `TypedScope` `$setValue`. */
export interface SetValueScope {
  $setValue(key: string, value: unknown): void;
}

/**
 * THE way a stage writes a value the library derives events from (a slot's
 * injections and composition — `ContextRecorder`): written as `$setValue`
 * writes it, and handed to the run as written (`RunRedaction ·
 * takeRealWrite`), so the derived events exist under a policy that keeps the
 * key itself out of the record. A scope no run made just writes.
 */
export function setEventSource(scope: SetValueScope, key: string, value: unknown): void {
  const entry = scopeRuns.get(scope as object);
  entry?.run.noteWrite(entry.stageId, key, value);
  scope.$setValue(key, value);
}

/**
 * Whether the run `scope` belongs to keeps `name` out of its records — asked
 * of the run's own rule. For text the library writes OUTSIDE any record from
 * a value the run keeps out (a console warning that would quote the model's
 * draft): it leaves the value out too. `false` for a scope no run made.
 */
export function runKeepsOut(scope: object, name: string): boolean {
  return scopeRuns.get(scope)?.run.keepsOut(name) ?? false;
}

/**
 * The policy in force for the run `scope` belongs to — what a tool call hands
 * down to a run it starts (`ToolExecutionContext.redact`). `undefined` for a
 * run with no policy and for a scope no run made.
 */
export function policyInForce(scope: object): RedactionPolicy | undefined {
  return scopeRuns.get(scope)?.run.policy;
}
