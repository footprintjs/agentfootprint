/**
 * ContextRecorder — observes footprintjs subflow + scope events, emits
 * grouped `context.*` domain events via the EventDispatcher.
 *
 * Pattern: Observer (GoF) + Pipes & Filters (Hohpe & Woolf, 2003).
 * Role:    Core semantic grouping layer for the 3-slot model. Watches
 *          slot subflows (sf-system-prompt / sf-messages / sf-tools) and
 *          translates raw writes into context.injected / evicted /
 *          slot_composed / budget_pressure events.
 * Emits:   agentfootprint.context.injected
 *          agentfootprint.context.evicted
 *          agentfootprint.context.slot_composed
 *          agentfootprint.context.budget_pressure
 */

import type { CombinedRecorder, FlowSubflowEvent, WriteEvent } from 'footprintjs';
import type { EventDispatcher } from '../../events/dispatcher.js';
import type { AgentfootprintEventMap, AgentfootprintEventType } from '../../events/registry.js';
import type { ContextSlot } from '../../events/types.js';
import { INJECTION_KEYS, slotFromSubflowId, slotFromRuntimeStageId } from '../../conventions.js';
import { buildEventMeta, type RunContext } from '../../bridge/eventMeta.js';
import type { RunRedaction } from '../../redaction/runRedaction.js';
import { SERVED_PLACEHOLDER } from '../../redaction/served.js';
import type {
  BudgetPressureRecord,
  EvictionRecord,
  InjectionRecord,
  SlotComposition,
} from './types.js';
import { COMPOSITION_KEYS } from './types.js';

/**
 * Supplies the recorder with run-level context. Passed at construction
 * time (static fields) OR updated via `updateRunContext` between runs
 * when reusing one recorder across multiple executor runs.
 */
export interface ContextRecorderOptions {
  readonly dispatcher: EventDispatcher;
  readonly id?: string;
  readonly getRunContext: () => RunContext;
  /**
   * The run's write relay. Under a redaction policy that selects a slot key
   * (`systemPromptInjections`, `slotCompositions`, …) the scope channel serves
   * its write as the placeholder; the slot builders hand the value they wrote
   * to the run (`redaction/runRedaction.ts` · `setEventSource`), and this
   * recorder derives its events from that — so they exist, and the
   * dispatcher serves them by name like every event. Absent (or nothing
   * relayed): the write as the scope channel served it.
   */
  readonly realWrites?: Pick<RunRedaction, 'takeRealWrite'>;
}

export class ContextRecorder implements CombinedRecorder {
  readonly id: string;
  private readonly dispatcher: EventDispatcher;
  private readonly getRunContext: () => RunContext;
  private readonly realWrites: Pick<RunRedaction, 'takeRealWrite'> | undefined;

  // Per-write slot attribution is resolved from each write's own
  // runtimeStageId (see onWrite) — NOT a "currently-open slot" stack.
  // The 3 slot subflows run in PARALLEL (selector fan-out), so their
  // entry/write/exit events interleave and a stack top would mis-route
  // or drop writes. onSubflowEntry/Exit only manage the per-slot
  // seen-set lifecycle below.
  // Previously seen injections per slot, by scope key. We diff old-vs-new
  // on each write to identify NEW injections (the builder may write the
  // whole array multiple times; we only emit events for the additions).
  private readonly seenInjections = new Map<string, Set<string>>();

  constructor(options: ContextRecorderOptions) {
    this.dispatcher = options.dispatcher;
    this.id = options.id ?? 'agentfootprint.context-recorder';
    this.getRunContext = options.getRunContext;
    this.realWrites = options.realWrites;
  }

  // ─── Subflow boundaries ────────────────────────────────────────

  onSubflowEntry(event: FlowSubflowEvent): void {
    const slot = event.subflowId ? slotFromSubflowId(event.subflowId) : undefined;
    if (!slot) return;
    // Reset the seen-set for this slot — new iteration. Safe under parallel
    // entry of all 3 slots: each slot owns its own seen-set key.
    this.seenInjections.set(slot, new Set());
  }

  onSubflowExit(event: FlowSubflowEvent): void {
    if (!event.subflowId) return;
    const slot = slotFromSubflowId(event.subflowId);
    if (!slot) return;
    this.seenInjections.delete(slot);
  }

  // ─── Scope writes — the injection / eviction / pressure signals ──

  onWrite(event: WriteEvent): void {
    // Resolve the slot from THIS write's own runtimeStageId path — correct
    // even when the 3 slots run concurrently and their events interleave.
    const activeSlot = slotFromRuntimeStageId(event.runtimeStageId);
    if (!activeSlot) return;

    const key = event.key;

    // Injection signals (INJECTION_KEYS) — per-slot arrays of InjectionRecord.
    if (key === INJECTION_KEYS.SYSTEM_PROMPT && activeSlot === 'system-prompt') {
      this.handleInjectionsWrite(activeSlot, event, this.written(event));
      return;
    }
    if (key === INJECTION_KEYS.MESSAGES && activeSlot === 'messages') {
      this.handleInjectionsWrite(activeSlot, event, this.written(event));
      return;
    }
    if (key === INJECTION_KEYS.TOOLS && activeSlot === 'tools') {
      this.handleInjectionsWrite(activeSlot, event, this.written(event));
      return;
    }

    // Composition summary — ONE record per slot exit, written just before exit.
    if (key === COMPOSITION_KEYS.SLOT_COMPOSED) {
      this.handleSlotComposedWrite(event, this.written(event));
      return;
    }

    // Evictions — per-piece removals under budget pressure.
    if (key === COMPOSITION_KEYS.EVICTED) {
      this.handleEvictionsWrite(event, this.written(event));
      return;
    }

    // Budget-pressure warnings — fired BEFORE evictions.
    if (key === COMPOSITION_KEYS.BUDGET_PRESSURE) {
      this.handleBudgetPressureWrite(event, this.written(event));
      return;
    }
  }

  /**
   * The value the stage wrote: the one it relayed (`realWrites`), else the
   * write as the scope channel served it. Taken ONCE per write, so a relayed
   * value is matched to the write it came with. `keptOut`: the run's policy
   * selects the key itself, so every record derived from the value keeps that
   * verdict — its content is served as the placeholder, its structure stays
   * (`structureOf`).
   */
  private written(event: WriteEvent): Written {
    const relayed = this.realWrites?.takeRealWrite(event.runtimeStageId ?? '', event.key);
    return relayed ?? { value: event.value, keptOut: false };
  }

  // ─── Internals ─────────────────────────────────────────────────

  private handleInjectionsWrite(slot: ContextSlot, event: WriteEvent, written: Written): void {
    const records = this.asInjectionArray(written.value);
    if (!records) return;
    const seen = this.seenInjections.get(slot) ?? new Set<string>();
    for (const rec of records) {
      if (seen.has(rec.contentHash)) continue;
      seen.add(rec.contentHash);
      this.emitInjected(written.keptOut ? structureOf(rec, INJECTION_STRUCTURE) : rec, event);
    }
    this.seenInjections.set(slot, seen);
  }

  private handleSlotComposedWrite(event: WriteEvent, written: Written): void {
    const rec = this.asSlotComposition(written.value);
    if (!rec) return;
    this.dispatch(
      'agentfootprint.context.slot_composed',
      written.keptOut ? structureOf(rec, COMPOSITION_STRUCTURE) : rec,
      event,
    );
  }

  private handleEvictionsWrite(event: WriteEvent, written: Written): void {
    const value = written.value;
    const records = this.asEvictionArray(value);
    if (!records) return;
    for (const rec of records) {
      this.dispatch('agentfootprint.context.evicted', rec, event);
    }
  }

  private handleBudgetPressureWrite(event: WriteEvent, written: Written): void {
    const records = this.asPressureArray(written.value);
    if (!records) return;
    for (const rec of records) {
      // The payload REQUIRES `unit`; the record does not, because slot
      // builders — including any a consumer wrote — still typecheck without
      // it. Filling `'chars'` here is not a guess: this handler only ever
      // sees writes to `COMPOSITION_KEYS.BUDGET_PRESSURE`, which come off a
      // slot composition, and a slot composition counts `String.length`. A
      // window strategy never travels this path — it emits the event
      // directly, with `unit: 'tokens'`.
      const { cap, projected } = rec;
      this.dispatch(
        'agentfootprint.context.budget_pressure',
        {
          slot: rec.slot,
          overflowBy: rec.overflowBy,
          planAction: rec.planAction,
          unit: rec.unit ?? 'chars',
          cap,
          projected,
        },
        event,
      );
    }
  }

  private emitInjected(rec: InjectionRecord, event: WriteEvent): void {
    // Payload is a structural subset of InjectionRecord — InjectionRecord is
    // designed to carry exactly what ContextInjectedPayload needs, so we
    // copy through directly.
    //
    // Redaction is never decided here. The record is the one the slot wrote
    // (relayed when the policy selects its key — `written`), and the
    // dispatcher serves the event like every other: a field the policy names
    // (`rawContent`, `contentSummary`, …) at any depth of the payload is the
    // placeholder (`src/redaction/served.ts`). One rule, footprintjs's — and
    // a kept-out injection is still an injection the record shows.
    this.dispatch('agentfootprint.context.injected', rec, event);
  }

  private dispatch<K extends AgentfootprintEventType>(
    type: K,
    payload: AgentfootprintEventMap[K]['payload'],
    source: WriteEvent | FlowSubflowEvent,
  ): void {
    if (!this.dispatcher.hasListenersFor(type)) return;
    // FlowSubflowEvent nests traversal info under .traversalContext.
    // WriteEvent flattens runtimeStageId + stageId at the top level via
    // RecorderContext. buildEventMeta accepts either shape.
    const origin =
      'traversalContext' in source && source.traversalContext
        ? source.traversalContext
        : (source as { runtimeStageId?: string });
    const meta = buildEventMeta(origin, this.getRunContext());
    this.dispatcher.dispatch({ type, payload, meta } as AgentfootprintEventMap[K]);
  }

  // ─── Type-narrowing helpers ────────────────────────────────────

  private asInjectionArray(value: unknown): readonly InjectionRecord[] | undefined {
    if (!Array.isArray(value)) return undefined;
    // Duck-type — require at least `contentHash` + `slot` + `source`.
    for (const r of value) {
      if (!r || typeof r !== 'object') return undefined;
      const rec = r as Partial<InjectionRecord>;
      if (typeof rec.contentHash !== 'string') return undefined;
      if (typeof rec.slot !== 'string') return undefined;
      if (typeof rec.source !== 'string') return undefined;
    }
    return value as readonly InjectionRecord[];
  }

  private asSlotComposition(value: unknown): SlotComposition | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const rec = value as Partial<SlotComposition>;
    if (typeof rec.slot !== 'string') return undefined;
    if (typeof rec.iteration !== 'number') return undefined;
    if (!rec.budget || typeof rec.budget !== 'object') return undefined;
    if (!rec.sourceBreakdown || typeof rec.sourceBreakdown !== 'object') return undefined;
    if (typeof rec.droppedCount !== 'number') return undefined;
    if (!Array.isArray(rec.droppedSummaries)) return undefined;
    return value as SlotComposition;
  }

  private asEvictionArray(value: unknown): readonly EvictionRecord[] | undefined {
    if (!Array.isArray(value)) return undefined;
    for (const r of value) {
      if (!r || typeof r !== 'object') return undefined;
      const rec = r as Partial<EvictionRecord>;
      if (typeof rec.slot !== 'string') return undefined;
      if (typeof rec.contentHash !== 'string') return undefined;
    }
    return value as readonly EvictionRecord[];
  }

  private asPressureArray(value: unknown): readonly BudgetPressureRecord[] | undefined {
    if (!Array.isArray(value)) return undefined;
    for (const r of value) {
      if (!r || typeof r !== 'object') return undefined;
      const rec = r as Partial<BudgetPressureRecord>;
      if (typeof rec.slot !== 'string') return undefined;
      if (typeof rec.cap !== 'number' || typeof rec.projected !== 'number') return undefined;
    }
    return value as readonly BudgetPressureRecord[];
  }
}

/** A slot's write as the recorder derives events from it (`ContextRecorder · written`). */
interface Written {
  readonly value: unknown;
  /** The run's policy selects the written key itself. */
  readonly keptOut: boolean;
}

/** The structure of an injection: who, where, why, how much — never the words. */
const INJECTION_STRUCTURE: ReadonlySet<string> = new Set([
  'contentHash',
  'slot',
  'source',
  'sourceId',
  'upstreamRef',
  'reason',
  'asRole',
  'asRecency',
  'position',
  'sectionTag',
  'retrievalScore',
  'rankPosition',
  'threshold',
  'budgetSpent',
  'expiresAfter',
]);

/** The structure of a slot composition: the counts and the budget — never the dropped text. */
const COMPOSITION_STRUCTURE: ReadonlySet<string> = new Set([
  'slot',
  'iteration',
  'budget',
  'sourceBreakdown',
  'orderingStrategy',
  'droppedCount',
]);

/**
 * `record` with every field outside `structure` served as the placeholder —
 * the derived record of a value the run's policy keeps out. Fails closed: a
 * field this list does not name (a custom slot builder's own) is content.
 */
function structureOf<T extends object>(record: T, structure: ReadonlySet<string>): T {
  return Object.fromEntries(
    Object.entries(record).map(([field, value]) => [
      field,
      structure.has(field) ? value : SERVED_PLACEHOLDER,
    ]),
  ) as T;
}
