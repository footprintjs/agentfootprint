/**
 * ContextEngineeringRecorder — captures every `agentfootprint.context.*`
 * emit and exposes a structured per-injection record + per-iteration
 * accumulated ledger.
 *
 * THE ABSTRACTION (parallels footprintjs CombinedNarrativeRecorder):
 * The library emits structured context-engineering events at every
 * injection point (RAG augmentPrompt, Memory formatDefault, Skill
 * activation, Instructions firing). This recorder is the one place
 * any UI / observability tool can consume that stream — Lens uses it,
 * a custom React dashboard uses it, a CLI logger uses it, a Datadog
 * exporter uses it. One recorder, one shape, every consumer.
 *
 * Mental model (from the user's library mission):
 *   `agentfootprint = context engineering, visible.`
 *   The library emits → ContextEngineeringRecorder collects → UI consumes.
 *
 * @example
 * ```ts
 * import { Agent, contextEngineering, anthropic } from 'agentfootprint';
 *
 * const ctx = contextEngineering();
 * const agent = Agent.create({ provider: anthropic('claude-sonnet-4') })
 *   .recorder(ctx)
 *   .build();
 *
 * await agent.run('Find the answer in our docs');
 *
 * ctx.injections();      // [{ source: 'rag', slot: 'messages', role: 'system', ... }]
 * ctx.ledger();          // { system: 1, systemPromptChars: 1200, tools: 3 }
 * ctx.bySource();        // { rag: [...], skill: [...] }
 * ctx.bySlot();          // { 'messages': [...], 'system-prompt': [...] }
 * ```
 *
 * Implements footprintjs's `EmitRecorder` interface so it attaches via
 * the same `.recorder()` chain as every other recorder. Idempotent on
 * re-attach (same id → replaces; different id → coexists).
 */

import type { EmitRecorder, EmitEvent } from 'footprintjs';

/** A single context-engineering injection captured during a run.
 *  Mirrors the emit-payload shape — extra fields in `payload` flow
 *  through for advanced consumers that want the raw signal. */
export interface ContextInjectionRecord {
  /** Source name — `rag` / `memory` / `skill` / `instructions` / etc. */
  readonly source: string;
  /** Which Agent slot this injection targets. */
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  /** Wire-level LLM role when the slot is `messages`. Undefined for
   *  system-prompt / tools (those mutate the slot directly). */
  readonly role?: 'system' | 'user' | 'assistant' | 'tool';
  /** Position in `messages[]` where the injected message landed. */
  readonly targetIndex?: number;
  /** Per-slot count deltas — sums into the ledger. Open keys: numeric
   *  counters add, booleans OR. */
  readonly deltaCount?: Readonly<Record<string, number | boolean>>;
  /** Original emit-channel event name (e.g. `agentfootprint.context.rag.chunks`).
   *  Lets consumers route on the SPECIFIC source variant when the
   *  generic `source` isn't fine-grained enough. */
  readonly eventName: string;
  /** Raw payload from the emit event — full fidelity for advanced UIs. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Stage that fired the emit, from footprintjs's emit-event metadata.
   *  Links the injection back to the exact stage in the execution tree. */
  readonly runtimeStageId?: string;
  /** Iteration number this injection landed in. Best-effort — derived
   *  from how many `agentfootprint.stream.llm_start` events have fired
   *  before this injection. Undefined when no LLM call yet. */
  readonly iteration?: number;
}

/** Open-keyed ledger — sum of every injection's `deltaCount`. Numbers
 *  add, booleans OR. Standard keys: `system` / `user` / `assistant` /
 *  `tool` (message-role counters), `systemPromptChars`, `tools`,
 *  `toolsFromSkill`. New keys flow through unchanged. */
export type ContextLedger = Readonly<Record<string, number | boolean>>;

export interface ContextEngineeringRecorder extends EmitRecorder {
  /** All injections in emit order. */
  injections(): readonly ContextInjectionRecord[];
  /** Cumulative ledger across the whole run. */
  ledger(): ContextLedger;
  /** Per-iteration ledger (1-based iteration → ledger). Iteration
   *  derived from preceding `agentfootprint.stream.llm_start` events. */
  ledgerByIteration(): ReadonlyMap<number, ContextLedger>;
  /** Injections grouped by source name. */
  bySource(): Readonly<Record<string, readonly ContextInjectionRecord[]>>;
  /** Injections grouped by Agent slot. */
  bySlot(): Readonly<Record<string, readonly ContextInjectionRecord[]>>;
  /** Reset to empty — called by runners between independent runs.
   *  No-op when the recorder hasn't been attached yet. */
  clear(): void;
}

const CONTEXT_PREFIX = 'agentfootprint.context.';
const STREAM_LLM_START = 'agentfootprint.stream.llm_start';

export interface ContextEngineeringRecorderOptions {
  /** Recorder id — defaults to `'context-engineering'`. Override only
   *  when running multiple instances side-by-side (different filters,
   *  different sinks). */
  readonly id?: string;
}

/**
 * Build a fresh ContextEngineeringRecorder.
 *
 * Function-factory style mirrors `agentObservability()` and footprintjs's
 * `narrative()` — keeps the construction site short and consumers don't
 * need to remember the class name.
 */
export function contextEngineering(
  options?: ContextEngineeringRecorderOptions,
): ContextEngineeringRecorder {
  const id = options?.id ?? 'context-engineering';
  let injections: ContextInjectionRecord[] = [];
  let currentIteration = 0;

  const recorder: ContextEngineeringRecorder = {
    id,
    onEmit(event: EmitEvent): void {
      // Track iteration from the surrounding stream events. Each
      // `llm_start` increments — injections that follow are tagged
      // with the in-progress iteration so consumers can group by it.
      if (event.name === STREAM_LLM_START) {
        const payload = event.payload as { iteration?: number } | undefined;
        currentIteration = payload?.iteration ?? currentIteration + 1;
        return;
      }

      if (!event.name.startsWith(CONTEXT_PREFIX)) return;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      // Slot is required — events without one are too underspecified to
      // be useful. Drop silently rather than recording garbage.
      const slot = payload.slot;
      if (slot !== 'system-prompt' && slot !== 'messages' && slot !== 'tools') return;

      // Source name — strip the prefix + take first segment of the
      // remaining suffix (e.g. `agentfootprint.context.rag.chunks` → `rag`).
      const suffix = event.name.slice(CONTEXT_PREFIX.length);
      const source = suffix.split('.')[0] || 'context';

      const record: ContextInjectionRecord = {
        source,
        slot,
        eventName: event.name,
        payload,
        ...(typeof payload.role === 'string'
          ? { role: payload.role as ContextInjectionRecord['role'] }
          : {}),
        ...(typeof payload.targetIndex === 'number'
          ? { targetIndex: payload.targetIndex as number }
          : {}),
        ...(payload.deltaCount && typeof payload.deltaCount === 'object'
          ? { deltaCount: payload.deltaCount as Record<string, number | boolean> }
          : {}),
        ...(event.runtimeStageId ? { runtimeStageId: event.runtimeStageId } : {}),
        ...(currentIteration > 0 ? { iteration: currentIteration } : {}),
      };
      injections.push(record);
    },
    injections(): readonly ContextInjectionRecord[] {
      return injections;
    },
    ledger(): ContextLedger {
      return foldLedger(injections);
    },
    ledgerByIteration(): ReadonlyMap<number, ContextLedger> {
      const buckets = new Map<number, ContextInjectionRecord[]>();
      for (const inj of injections) {
        const k = inj.iteration ?? 0;
        const bucket = buckets.get(k) ?? [];
        bucket.push(inj);
        buckets.set(k, bucket);
      }
      const result = new Map<number, ContextLedger>();
      for (const [iter, list] of buckets) result.set(iter, foldLedger(list));
      return result;
    },
    bySource(): Readonly<Record<string, readonly ContextInjectionRecord[]>> {
      const out: Record<string, ContextInjectionRecord[]> = {};
      for (const inj of injections) {
        (out[inj.source] ??= []).push(inj);
      }
      return out;
    },
    bySlot(): Readonly<Record<string, readonly ContextInjectionRecord[]>> {
      const out: Record<string, ContextInjectionRecord[]> = {};
      for (const inj of injections) {
        (out[inj.slot] ??= []).push(inj);
      }
      return out;
    },
    clear(): void {
      injections = [];
      currentIteration = 0;
    },
  };
  return recorder;
}

/** Fold a list of injections into a single ledger — numbers add,
 *  booleans OR. Pure function so it's safe to call from any read-side
 *  query without mutating the underlying record list. */
function foldLedger(list: readonly ContextInjectionRecord[]): ContextLedger {
  const ledger: Record<string, number | boolean> = {};
  for (const inj of list) {
    const d = inj.deltaCount;
    if (!d) continue;
    for (const [key, val] of Object.entries(d)) {
      if (typeof val === 'number') {
        const prev = typeof ledger[key] === 'number' ? (ledger[key] as number) : 0;
        ledger[key] = prev + val;
      } else if (typeof val === 'boolean') {
        ledger[key] = ledger[key] === true || val;
      }
    }
  }
  return ledger;
}
