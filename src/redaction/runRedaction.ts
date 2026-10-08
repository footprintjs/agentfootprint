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
import type { EventMeta } from '../events/types.js';
import type { AgentfootprintEvent } from '../events/registry.js';
import { conversationRedaction } from './conversation.js';
import { namesAnything } from './policy.js';
import {
  coverageOfOpenedRun,
  policyOfCoverage,
  UNKNOWN_COVERAGE,
  type RedactionCoverage,
} from './coverage.js';
import { eventServing, SERVED_PLACEHOLDER, type EventServing } from './served.js';
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

/**
 * What a stage's scope is tied to — internal to this module and its helpers.
 *
 * @internal
 */
export interface ScopeRun {
  /** What the run is covered by — `unknown` only for a runner whose declaration is unknown. */
  readonly coverage: RedactionCoverage;
  readonly serving: EventServing;
  /** Deliver an event, as made, to the real-value path — from the stage `stageId` that emitted it. */
  real(type: string, payload: unknown, stageId: string): void;
  noteWrite(runtimeStageId: string, key: string, value: unknown): void;
  /** Whether the run's rule keeps `name` out of its records. */
  keepsOut(name: string): boolean;
}

/**
 * Every executor a run opened → what the run was covered by (`coverage.ts`):
 * `covered` with its policy, or `declared-none` — set by `applyTo`, the one
 * place an executor gets its policy, so what a snapshot is served under is a
 * fact about THAT executor and can never be another run's
 * (`coverageOfExecutor`). An executor this map does not hold is `unknown`,
 * never "no policy". Weak: dies with the executor.
 */
const executorCoverage = new WeakMap<object, RedactionCoverage>();

/**
 * What `executor`'s run was covered by: `covered`, `declared-none`, or
 * `unknown` — an executor no run of this library opened, whose records
 * nothing vouches for. A reader serves an unknown executor's records under
 * nothing it could guess: it refuses (`RunnerBase · getLastSnapshot` hands
 * back nothing).
 */
export function coverageOfExecutor(executor: object): RedactionCoverage {
  return executorCoverage.get(executor) ?? UNKNOWN_COVERAGE;
}

/**
 * Every executor a run opened → that run's serving, set by `applyTo` beside
 * its policy — for a fact the runner files about THAT run after its executor
 * returned (its pause request), whatever run opened on the instance since
 * (`servingOfExecutor`). Weak: dies with the executor.
 */
const executorServings = new WeakMap<object, EventServing>();

/**
 * The serving of the run that opened `executor` — what a fact the runner
 * files about that run is served as. `undefined` for an executor no run of
 * this library opened: such a fact is refused (`EventDispatcher ·
 * dispatchForRun`).
 */
export function servingOfExecutor(executor: object): EventServing | undefined {
  return executorServings.get(executor);
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
  // The rule the run decides with — one built from the policy stands in until
  // a stage context offers the executor's own. The serving reads it through
  // this box and holds nothing else of the run (`servingOf`): the dispatcher
  // keeps a run's serving for its late facts, never the run's values.
  const decided = { rule: new RedactionRule(policy) };
  const serving = servingOf(decided, policy);
  // Relayed writes waiting for their recorder, oldest first, per stage and key.
  // Keyed by the stage's runtimeStageId (unique per execution), so an entry no
  // recorder claims (a deferred tier that dropped the write) can never be
  // handed to a later write — it is held, in memory only, until this run's
  // redaction is dropped when the next run opens.
  const waiting = new Map<string, { readonly value: unknown; readonly keptOut: boolean }[]>();
  const slot = (runtimeStageId: string, key: string): string => `${runtimeStageId}\u001f${key}`;
  const coverage = coverageOfOpenedRun(policy);
  const run: ScopeRun = {
    coverage,
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
      return policy !== undefined && decided.rule.isKeyRedacted(name);
    },
    noteWrite(runtimeStageId, key, value) {
      // No policy: the scope channel serves the write as written — nothing to relay.
      if (policy === undefined) return;
      const at = slot(runtimeStageId, key);
      const written = { value, keptOut: decided.rule.isKeyRedacted(key) };
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
        if (own !== undefined) decided.rule = own;
        return scope;
      };
    },
    applyTo(executor) {
      executorCoverage.set(executor, coverage);
      executorServings.set(executor, serving);
      if (policy === undefined) return;
      executor.setRedactionPolicy(policy);
      // The served snapshot says so itself (`marker.ts`): readers of the record
      // read a placeholder as kept out only when a policy covered the run.
      // Once the run settles, its serving — kept by the dispatcher for the
      // run's late facts — holds the rule's NAMES only (`retiredRule`).
      executor.attachCombinedRecorder(
        redactionMarker(() => {
          decided.rule = retiredRule(decided.rule, policy);
        }),
      );
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
 * A settled run's rule as its serving keeps it: the policy and the marks —
 * names only — and nothing else of the run. footprintjs's rule also remembers
 * the masked form of every thrown value it served (so `onRunFailed`, the
 * logger and a fork envelope agree); the live run needed that, a late fact
 * does not, and keeping it would keep each run's thrown values reachable for
 * as long as the dispatcher keeps the run's serving.
 *
 * @internal — exported for the test that pins it.
 */
export function retiredRule(
  rule: RedactionRule,
  policy: RedactionPolicy | undefined,
): RedactionRule {
  const names = new RedactionRule(policy);
  const marks = rule.marksForCheckpoint();
  if (marks !== undefined) names.restoreMarks(marks);
  return names;
}

/**
 * The serving of one run, reading the rule in `decided` — built in its own
 * scope, so what the serving holds is the box and the policy: never the run's
 * relayed writes or its context, which `createRunRedaction`'s other closures
 * share.
 */
function servingOf(
  decided: { readonly rule: RedactionRule },
  policy: RedactionPolicy | undefined,
): EventServing {
  return eventServing(() => decided.rule, namesAnything(policy));
}

/**
 * The serving for facts a runner dispatches BEFORE its run's executor exists —
 * a resume's `pause.resume`, whose payload is the person's reply — under the
 * policy that run will be covered by, which the runner computed from typed
 * declarations (`undefined` there is positively none: the identity). A rule
 * built from the policy alone: no stage has run yet, so the run has marked
 * nothing.
 */
export function servingAhead(policy: RedactionPolicy | undefined): EventServing {
  const rule = new RedactionRule(policy);
  return eventServing(() => rule, namesAnything(policy));
}

/**
 * The run a stage of a runner's chart belongs to when NO run of the library
 * made its scope — the chart mounted into an executor the app built itself
 * (`parent.addSubFlowChartNext('sf-agent', agent.getSpec(), …)`): the runner's
 * DECLARED policy, served as a run's would be (`servingAhead`), so its stages'
 * events never leave raw because the runner was not the one running them.
 * There is no run here to feed the real-value path or a relay, so those are
 * idle. Built for ONE runner and held by it (`RunnerBase`) — never a registry
 * shared between runners — and it holds no value of any run: only the
 * declaration's rule.
 */
export interface OutsideRun {
  /** The runner's declaration this run serves under. */
  readonly declaration: RedactionCoverage;
  /** @internal */
  readonly scopeRun: ScopeRun;
}

/**
 * The {@link OutsideRun} of a runner whose declaration is `declaration`:
 * `covered` serves under its policy, `declared-none` as emitted (positively
 * none), `unknown` refuses every payload — the placeholder, fail closed.
 */
export function outsideRunFor(declaration: RedactionCoverage): OutsideRun {
  if (declaration.state === 'unknown') {
    return Object.freeze({
      declaration,
      scopeRun: {
        coverage: declaration,
        serving: REFUSING_SERVING,
        real: () => undefined,
        noteWrite: () => undefined,
        keepsOut: () => true,
      },
    });
  }
  const policy = policyOfCoverage(declaration);
  const rule = new RedactionRule(policy);
  return Object.freeze({
    declaration,
    scopeRun: {
      coverage: declaration,
      serving: eventServing(() => rule, namesAnything(policy)),
      real: () => undefined,
      noteWrite: () => undefined,
      keepsOut: (name: string) => rule.isKeyRedacted(name),
    },
  });
}

/**
 * The serving of a run whose state is unknown: every payload is the
 * placeholder, and so is the identity on its meta (who asked); the address is
 * kept.
 */
const REFUSING_SERVING: EventServing = Object.freeze({
  active: () => true,
  payload: () => SERVED_PLACEHOLDER,
  meta: <M extends EventMeta>(meta: M): M =>
    meta.principal === undefined && meta.tenant === undefined
      ? meta
      : {
          ...meta,
          ...(meta.principal !== undefined && { principal: SERVED_PLACEHOLDER }),
          ...(meta.tenant !== undefined && { tenant: SERVED_PLACEHOLDER }),
        },
}) as EventServing;

/**
 * Tie `scope` to `outside` — the run of its runner's chart mounted outside any
 * of that runner's runs (`chartBinding.ts` · `bindChartStages` calls it as each
 * stage starts, with the runner's own {@link OutsideRun}). A scope a run
 * already made keeps its run. A runner that declares no policy ties the scope
 * as positively none (served as emitted) — never left untied, which would
 * read as unknown.
 */
export function adoptScopeOutsideRun(scope: unknown, outside: OutsideRun): void {
  if (scope === null || typeof scope !== 'object') return;
  if (scopeRuns.has(scope)) return;
  scopeRuns.set(scope, { run: outside.scopeRun, stageId: '' });
}

/** A scope that can emit — structurally footprintjs's `TypedScope` `$emit`. */
export interface EmitScope {
  $emit(name: string, payload?: unknown): void;
}

/**
 * THE way a typed event leaves a stage. The real value goes to the run's own
 * mechanisms (`onRealEvent`), the served value to footprintjs's `$emit` — and
 * from there to every channel at once. A runner's chart mounted into an
 * executor the app built is tied to the runner's declaration as each stage
 * starts (`adoptScopeOutsideRun`). A scope NOTHING tied — not made by a run of
 * this library, not bound to a runner — is a run whose state is unknown: its
 * payload is the placeholder (fail closed), never the payload as made.
 */
export function emitServed(scope: EmitScope, type: string, payload: unknown): void {
  const entry = scopeRuns.get(scope as object);
  if (entry === undefined) {
    scope.$emit(type, SERVED_PLACEHOLDER);
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
 * draft): it leaves the value out too. `true` for a scope no run made — its
 * run's state is unknown, so the value is left out (fail closed).
 */
export function runKeepsOut(scope: object, name: string): boolean {
  return scopeRuns.get(scope)?.run.keepsOut(name) ?? true;
}

/**
 * What the run `scope` belongs to is covered by (`coverage.ts`) — `unknown`
 * for a scope no run of this library made.
 */
export function coverageInForce(scope: object): RedactionCoverage {
  return scopeRuns.get(scope)?.run.coverage ?? UNKNOWN_COVERAGE;
}

/**
 * The policy in force for the run `scope` belongs to — what a tool call hands
 * down to a run it starts (`ToolExecutionContext.redact`), what seed commits
 * for a pause to carry. `undefined` ONLY for a run positively covered by none;
 * a run whose state is unknown hands down the whole conversation vocabulary —
 * fail closed, never "none".
 */
export function policyInForce(scope: object): RedactionPolicy | undefined {
  const coverage = coverageInForce(scope);
  return coverage.state === 'unknown' ? conversationRedaction() : policyOfCoverage(coverage);
}
