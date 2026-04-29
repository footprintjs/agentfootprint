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
import { INJECTION_KEYS, slotFromSubflowId } from '../../conventions.js';
import { buildEventMeta, type RunContext } from '../../bridge/eventMeta.js';
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
}

export class ContextRecorder implements CombinedRecorder {
  readonly id: string;
  private readonly dispatcher: EventDispatcher;
  private readonly getRunContext: () => RunContext;

  // Active slot stack — stacked because a slot subflow CAN nest another
  // (rare but possible if a custom source is a subflow itself).
  private readonly slotStack: ContextSlot[] = [];
  // Previously seen injections per slot, by scope key. We diff old-vs-new
  // on each write to identify NEW injections (the builder may write the
  // whole array multiple times; we only emit events for the additions).
  private readonly seenInjections = new Map<string, Set<string>>();

  constructor(options: ContextRecorderOptions) {
    this.dispatcher = options.dispatcher;
    this.id = options.id ?? 'agentfootprint.context-recorder';
    this.getRunContext = options.getRunContext;
  }

  // ─── Subflow boundaries ────────────────────────────────────────

  onSubflowEntry(event: FlowSubflowEvent): void {
    const slot = event.subflowId ? slotFromSubflowId(event.subflowId) : undefined;
    if (!slot) return;
    this.slotStack.push(slot);
    // Reset the seen-set for this slot — new iteration.
    this.seenInjections.set(slot, new Set());
  }

  onSubflowExit(event: FlowSubflowEvent): void {
    if (!event.subflowId) return;
    const slot = slotFromSubflowId(event.subflowId);
    if (!slot) return;
    // Pop only if this is the active top (defensive against mis-ordering).
    if (this.slotStack[this.slotStack.length - 1] === slot) {
      this.slotStack.pop();
    }
    this.seenInjections.delete(slot);
  }

  // ─── Scope writes — the injection / eviction / pressure signals ──

  onWrite(event: WriteEvent): void {
    const activeSlot = this.currentSlot();
    if (!activeSlot) return;

    const key = event.key;

    // Injection signals (INJECTION_KEYS) — per-slot arrays of InjectionRecord.
    if (key === INJECTION_KEYS.SYSTEM_PROMPT && activeSlot === 'system-prompt') {
      this.handleInjectionsWrite(activeSlot, event);
      return;
    }
    if (key === INJECTION_KEYS.MESSAGES && activeSlot === 'messages') {
      this.handleInjectionsWrite(activeSlot, event);
      return;
    }
    if (key === INJECTION_KEYS.TOOLS && activeSlot === 'tools') {
      this.handleInjectionsWrite(activeSlot, event);
      return;
    }

    // Composition summary — ONE record per slot exit, written just before exit.
    if (key === COMPOSITION_KEYS.SLOT_COMPOSED) {
      this.handleSlotComposedWrite(event);
      return;
    }

    // Evictions — per-piece removals under budget pressure.
    if (key === COMPOSITION_KEYS.EVICTED) {
      this.handleEvictionsWrite(event);
      return;
    }

    // Budget-pressure warnings — fired BEFORE evictions.
    if (key === COMPOSITION_KEYS.BUDGET_PRESSURE) {
      this.handleBudgetPressureWrite(event);
      return;
    }
  }

  // ─── Internals ─────────────────────────────────────────────────

  private currentSlot(): ContextSlot | undefined {
    return this.slotStack[this.slotStack.length - 1];
  }

  private handleInjectionsWrite(slot: ContextSlot, event: WriteEvent): void {
    const records = this.asInjectionArray(event.value);
    if (!records) return;
    const seen = this.seenInjections.get(slot) ?? new Set<string>();
    for (const rec of records) {
      if (seen.has(rec.contentHash)) continue;
      seen.add(rec.contentHash);
      this.emitInjected(rec, event);
    }
    this.seenInjections.set(slot, seen);
  }

  private handleSlotComposedWrite(event: WriteEvent): void {
    const rec = this.asSlotComposition(event.value);
    if (!rec) return;
    this.dispatch('agentfootprint.context.slot_composed', rec, event);
  }

  private handleEvictionsWrite(event: WriteEvent): void {
    const records = this.asEvictionArray(event.value);
    if (!records) return;
    for (const rec of records) {
      this.dispatch('agentfootprint.context.evicted', rec, event);
    }
  }

  private handleBudgetPressureWrite(event: WriteEvent): void {
    const records = this.asPressureArray(event.value);
    if (!records) return;
    for (const rec of records) {
      this.dispatch('agentfootprint.context.budget_pressure', rec, event);
    }
  }

  private emitInjected(rec: InjectionRecord, event: WriteEvent): void {
    // Payload is a structural subset of InjectionRecord — InjectionRecord is
    // designed to carry exactly what ContextInjectedPayload needs, so we
    // copy through directly.
    //
    // Redaction: footprintjs's scope layer sets `event.redacted = true` if
    // its RedactionPolicy matched the scope key. We trust that flag —
    // `rec.rawContent` arrives already-redacted if it was going to be. We
    // do NOT re-implement redaction here (single source of truth in
    // footprintjs's RedactionPolicy).
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
      if (typeof rec.capTokens !== 'number') return undefined;
    }
    return value as readonly BudgetPressureRecord[];
  }
}
