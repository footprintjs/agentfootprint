/**
 * EventDispatcher — the central event bus (one per runner).
 *
 * Pattern: Observer (GoF) + Pub/Sub over a typed discriminated union.
 * Role:    Single flat dispatcher for every event emitted during a run.
 *          Replaces DOM-style bubbling — we have a central bus by
 *          construction, so tree propagation is unnecessary.
 * Emits:   N/A — this IS the emitter. It ROUTES events to listeners.
 *
 * Semantics:
 *   - Observers are ALWAYS fire-and-forget (inherited from footprintjs's
 *     recorder contract). Promise returns are never awaited.
 *   - Listener errors are caught; they become `agentfootprint.error.fatal`
 *     events with stage:'observer'. The run continues.
 *   - Dispatch is O(1) hash lookup by event type.
 *   - Zero allocation when no listener for an event type AND no wildcard.
 *   - Dev-mode wraps listeners to warn on async listener Promise return.
 *   - Lifecycle: subscriptions release via the returned Unsubscribe or an
 *     AbortSignal (`{ signal }`); `removeAllListeners()` is the bulk
 *     escape hatch for long-lived server consumers; `listenerCount()` is
 *     the leak diagnostic. Every removal path prunes emptied buckets and
 *     detaches abort handlers, so listener storage is bounded by LIVE
 *     subscriptions — never by subscription history.
 */

import { isDevMode } from 'footprintjs';
import type {
  AgentfootprintEvent,
  AgentfootprintEventMap,
  AgentfootprintEventType,
} from './registry.js';

// Dev-mode gating uses footprintjs's global flag (isDevMode).
// Consumers call `enableDevMode()` / `disableDevMode()` from 'footprintjs'.
// Single source of truth — no local duplication.

// ─── Listener types ──────────────────────────────────────────────────

export type EventListener<K extends AgentfootprintEventType> = (
  event: AgentfootprintEventMap[K],
) => void;

export type WildcardListener = (event: AgentfootprintEvent) => void;

export interface ListenOptions {
  readonly once?: boolean;
  readonly signal?: AbortSignal;
}

export type Unsubscribe = () => void;

/** Shared no-op returned when subscribing to an already-aborted signal —
 *  the listener was never registered, so unsubscribe has nothing to do. */
const noopUnsubscribe: Unsubscribe = () => undefined;

// ─── Wildcard pattern type (restricted to domain wildcards + full) ──
//
// Allowed wildcard subscriptions (prevents typos):
//   '*'                                - every event
//   'agentfootprint.context.*'         - every event in the context domain
//   'agentfootprint.stream.*'          - every event in the stream domain
//   ...etc for every domain
//
// We extract domain wildcards from EVENT_NAMES at the type level.
// Matches a prefix against dispatched events.

export type DomainWildcard =
  | 'agentfootprint.composition.*'
  | 'agentfootprint.agent.*'
  | 'agentfootprint.stream.*'
  | 'agentfootprint.context.*'
  | 'agentfootprint.memory.*'
  | 'agentfootprint.tools.*'
  | 'agentfootprint.skill.*'
  | 'agentfootprint.permission.*'
  | 'agentfootprint.risk.*'
  | 'agentfootprint.fallback.*'
  | 'agentfootprint.cost.*'
  | 'agentfootprint.eval.*'
  | 'agentfootprint.error.*'
  | 'agentfootprint.pause.*'
  | 'agentfootprint.embedding.*';

export type AllWildcard = '*';

export type WildcardSubscription = DomainWildcard | AllWildcard;

// ─── Internal bookkeeping ───────────────────────────────────────────

interface StoredListener {
  readonly fn: (event: AgentfootprintEvent) => void;
  readonly once: boolean;
  /**
   * Detaches the abort-handler this subscription registered on the
   * consumer's AbortSignal. Set after registration when `{ signal }`
   * was passed. Called on EVERY removal path (manual unsubscribe,
   * `off()`, once-auto-removal, `removeAllListeners()`) so long-lived
   * signals don't accumulate abort handlers — full DOM
   * `addEventListener` parity.
   */
  cleanup?: () => void;
}

/**
 * Empty a bucket, detaching each subscription's abort handler from its
 * AbortSignal first. Used by removeAllListeners().
 */
function drainBucket(bucket: Set<StoredListener>): void {
  for (const stored of bucket) stored.cleanup?.();
  bucket.clear();
}

// ─── Dispatcher ──────────────────────────────────────────────────────

/**
 * Central event bus. One per executable runner.
 *
 * Zero-alloc fast path: if `hasListenersFor(type)` is false AND there are
 * no wildcards, `dispatch` returns immediately without iteration.
 */
export class EventDispatcher {
  private readonly byType = new Map<string, Set<StoredListener>>();
  private readonly domainWildcards = new Map<string, Set<StoredListener>>();
  private readonly allWildcards = new Set<StoredListener>();

  // ─── Query ────────────────────────────────────────────────────────

  /**
   * Fast-path check. Returns true when at least one listener would fire
   * for this type. Used by emitters to skip event-object allocation.
   */
  hasListenersFor(type: AgentfootprintEventType): boolean {
    if (this.allWildcards.size > 0) return true;
    const typed = this.byType.get(type);
    if (typed && typed.size > 0) return true;
    const domainKey = this.domainKey(type);
    const domain = this.domainWildcards.get(domainKey);
    return domain ? domain.size > 0 : false;
  }

  // ─── Subscribe ────────────────────────────────────────────────────

  /**
   * Subscribe a typed listener for a specific event type.
   *
   * The listener signature is `(event) => void` by design — Promises are
   * NOT awaited. See dispatch() for details.
   */
  on<K extends AgentfootprintEventType>(
    type: K,
    listener: EventListener<K>,
    options?: ListenOptions,
  ): Unsubscribe;
  /** Subscribe to a domain wildcard ('agentfootprint.context.*') or '*'. */
  on(type: WildcardSubscription, listener: WildcardListener, options?: ListenOptions): Unsubscribe;
  on(
    type: string,
    listener: (event: AgentfootprintEvent) => void,
    options?: ListenOptions,
  ): Unsubscribe {
    return this.subscribe(type, listener, options);
  }

  /**
   * Subscribe a one-shot listener. Fires at most once and then auto-removes.
   * Equivalent to `on(type, listener, { once: true })`. Accepts `{ signal }`
   * for AbortSignal auto-cleanup, same as `on()`.
   */
  once<K extends AgentfootprintEventType>(
    type: K,
    listener: EventListener<K>,
    options?: Omit<ListenOptions, 'once'>,
  ): Unsubscribe;
  once(
    type: WildcardSubscription,
    listener: WildcardListener,
    options?: Omit<ListenOptions, 'once'>,
  ): Unsubscribe;
  once(
    type: string,
    listener: (event: AgentfootprintEvent) => void,
    options?: Omit<ListenOptions, 'once'>,
  ): Unsubscribe {
    return this.subscribe(type, listener, { ...options, once: true });
  }

  /**
   * Shared subscribe path for on()/once(). The public overloads constrain
   * `type` to either typed keys or wildcards; internally the dispatcher's
   * bucket logic accepts any string and classifies by shape.
   */
  private subscribe(
    type: string,
    listener: (event: AgentfootprintEvent) => void,
    options?: ListenOptions,
  ): Unsubscribe {
    const signal = options?.signal;
    if (signal?.aborted) {
      // Already aborted; register nothing — return a no-op unsubscribe.
      return noopUnsubscribe;
    }

    const wrapped: StoredListener = {
      fn: wrapForDev(listener, type),
      once: options?.once === true,
    };

    const remove = this.addListener(type, wrapped);

    if (!signal) return remove;

    // DOM-parity AbortSignal wiring: abort → unsubscribe, AND every other
    // removal path (manual unsubscribe, off(), once-auto-removal,
    // removeAllListeners()) → detach the abort handler from the signal,
    // so a long-lived, never-aborted signal doesn't accumulate handlers.
    const onAbort = (): void => {
      remove();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    wrapped.cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    return () => {
      wrapped.cleanup?.();
      remove();
    };
  }

  /**
   * Remove a specific listener for a type. Prefer AbortSignal for auto-cleanup.
   *
   * Because listeners are wrapped in dev mode, identity is preserved via a
   * WeakMap in addListener — consumers pass the original function.
   */
  off<K extends AgentfootprintEventType>(type: K, listener: EventListener<K>): void;
  off(type: WildcardSubscription, listener: WildcardListener): void;
  off(type: string, listener: (event: AgentfootprintEvent) => void): void {
    const bucket = this.bucketFor(type);
    if (!bucket) return;
    const originalFn = originalsMap.get(listener as object) ?? listener;
    for (const stored of bucket) {
      const storedOriginal = originalsMap.get(stored.fn as object) ?? stored.fn;
      if (storedOriginal === originalFn) {
        bucket.delete(stored);
        stored.cleanup?.();
        this.pruneBucket(type, bucket);
        return;
      }
    }
  }

  /**
   * Lifecycle escape hatch — drop EVERY listener (typed, domain-wildcard,
   * and `'*'`) in one call. For long-lived server consumers that reuse one
   * runner across many requests: when you can't thread an AbortSignal or
   * keep every Unsubscribe handle, call this between requests to guarantee
   * the dispatcher holds zero subscriptions.
   *
   * Safe to call mid-dispatch: the bucket currently being iterated
   * finishes its already-taken snapshot (same semantics as `off()` during
   * dispatch), buckets the in-flight dispatch has NOT yet reached deliver
   * nothing (DOM-like "stop now"), and every SUBSEQUENT event sees no
   * listeners. Abort handlers registered on consumer AbortSignals via
   * `{ signal }` are detached too. Previously returned Unsubscribe
   * handles become harmless no-ops.
   */
  removeAllListeners(): void {
    for (const bucket of this.byType.values()) drainBucket(bucket);
    this.byType.clear();
    for (const bucket of this.domainWildcards.values()) drainBucket(bucket);
    this.domainWildcards.clear();
    drainBucket(this.allWildcards);
  }

  /**
   * Diagnostic — how many listeners the dispatcher currently retains.
   *
   * - `listenerCount()` — TOTAL across every bucket (typed + domain
   *   wildcards + `'*'`). The number long-lived consumers watch to verify
   *   per-run subscriptions are being released (leak detection).
   * - `listenerCount(type)` — listeners registered under that exact
   *   subscription key (`'agentfootprint.agent.turn_start'`,
   *   `'agentfootprint.context.*'`, or `'*'`). NOTE: counts the bucket
   *   only — a typed count does NOT include wildcard listeners that would
   *   also fire for that type. "Would anything fire?" is
   *   `hasListenersFor()`.
   */
  listenerCount(type?: AgentfootprintEventType | WildcardSubscription): number;
  listenerCount(type?: string): number {
    if (type !== undefined) {
      const bucket = this.bucketFor(type);
      return bucket ? bucket.size : 0;
    }
    let total = this.allWildcards.size;
    for (const bucket of this.byType.values()) total += bucket.size;
    for (const bucket of this.domainWildcards.values()) total += bucket.size;
    return total;
  }

  // ─── Dispatch ─────────────────────────────────────────────────────

  /**
   * Route an event to all matching listeners (typed + domain-wildcard + all).
   *
   * Fire-and-forget: any returned Promise is IGNORED. Listener exceptions
   * are caught and re-dispatched as `error.fatal` events with scope='observer'.
   * The run continues regardless.
   */
  dispatch(event: AgentfootprintEvent): void {
    const typed = this.byType.get(event.type);
    const domainKey = this.domainKey(event.type);
    const domain = this.domainWildcards.get(domainKey);
    this.fireBucket(typed, event);
    // Prune only when once-listeners actually emptied the bucket — keeps the
    // hot path free of per-event work (incl. the `${domainKey}.*` string build).
    if (typed && typed.size === 0) this.pruneBucket(event.type, typed);
    this.fireBucket(domain, event);
    if (domain && domain.size === 0) this.pruneBucket(`${domainKey}.*`, domain);
    this.fireBucket(this.allWildcards, event);
  }

  // ─── Internals ────────────────────────────────────────────────────

  private addListener(type: string, stored: StoredListener): Unsubscribe {
    const bucket = this.ensureBucket(type);
    bucket.add(stored);
    return () => {
      bucket.delete(stored);
      this.pruneBucket(type, bucket);
    };
  }

  /**
   * Bounded-leak guarantee: a bucket emptied by ANY removal path is
   * deleted from its Map so `byType` / `domainWildcards` never retain
   * empty Sets for event types subscribed once and released. The
   * identity check (`get(...) === bucket`) guards stale Unsubscribe
   * closures — they must never delete a NEWER bucket re-created under
   * the same key after this one was pruned. (`allWildcards` is a stable
   * field, not a Map entry — nothing to prune.)
   */
  private pruneBucket(type: string, bucket: Set<StoredListener>): void {
    if (bucket.size > 0 || type === '*') return;
    if (type.endsWith('.*')) {
      const key = type.slice(0, -2);
      if (this.domainWildcards.get(key) === bucket) this.domainWildcards.delete(key);
      return;
    }
    if (this.byType.get(type) === bucket) this.byType.delete(type);
  }

  private ensureBucket(type: string): Set<StoredListener> {
    if (type === '*') return this.allWildcards;
    if (type.endsWith('.*')) {
      const key = type.slice(0, -2);
      let bucket = this.domainWildcards.get(key);
      if (!bucket) {
        bucket = new Set();
        this.domainWildcards.set(key, bucket);
      }
      return bucket;
    }
    let bucket = this.byType.get(type);
    if (!bucket) {
      bucket = new Set();
      this.byType.set(type, bucket);
    }
    return bucket;
  }

  private bucketFor(type: string): Set<StoredListener> | undefined {
    if (type === '*') return this.allWildcards;
    if (type.endsWith('.*')) return this.domainWildcards.get(type.slice(0, -2));
    return this.byType.get(type);
  }

  private fireBucket(bucket: Set<StoredListener> | undefined, event: AgentfootprintEvent): void {
    if (!bucket || bucket.size === 0) return;
    // Snapshot to allow removal during iteration (once-listeners, off(),
    // removeAllListeners()). Removal mid-dispatch takes effect for
    // SUBSEQUENT events; the in-flight snapshot completes delivery.
    const snapshot = [...bucket];
    for (const stored of snapshot) {
      if (stored.once) {
        bucket.delete(stored);
        stored.cleanup?.(); // detach abort handler from the consumer's signal
      }
      try {
        stored.fn(event);
      } catch (err) {
        // Error isolation — never let a listener break the run. We do not
        // re-dispatch here to avoid infinite recursion if an error-listener
        // itself throws. Errors are surfaced via console.error in dev mode.
        if (isDevMode()) {
          // eslint-disable-next-line no-console
          console.error(`[agentfootprint] Listener for "${event.type}" threw:`, err);
        }
      }
    }
  }

  private domainKey(eventType: string): string {
    // 'agentfootprint.context.injected' → 'agentfootprint.context'
    const lastDot = eventType.lastIndexOf('.');
    return lastDot === -1 ? eventType : eventType.slice(0, lastDot);
  }
}

// ─── Dev-mode async-listener warning wrapper ─────────────────────────

/**
 * Original-function map — preserves consumer's function identity across
 * dev-mode wrapping so `off(type, originalFn)` still finds and removes
 * the stored listener.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- WeakMap value preserves arbitrary listener identity; narrowing breaks identity equality.
const originalsMap = new WeakMap<object, Function>();

/**
 * Wrap a listener in dev mode to warn if it returns a Promise.
 * Production pass-through.
 *
 * Why: consumers occasionally write `on('x', async (e) => await ...)` and
 * expect the dispatcher to wait. It does NOT — observers are always
 * fire-and-forget. This warning catches the mistake loudly in dev.
 */
function wrapForDev(
  listener: (event: AgentfootprintEvent) => void,
  type: string,
): (event: AgentfootprintEvent) => void {
  if (!isDevMode()) return listener;

  const wrapped = (event: AgentfootprintEvent) => {
    const result = listener(event) as unknown;
    if (result && typeof result === 'object' && 'then' in result) {
      // eslint-disable-next-line no-console
      console.warn(
        `[agentfootprint] Listener for "${type}" returned a Promise.\n` +
          `Observers are NEVER awaited — your Promise will run in the background.\n` +
          `If you need back-pressure, collect promises and await AFTER run().\n` +
          `  See: https://agentfootprint.dev/docs/events/async-listeners`,
      );
      // Capture unhandled rejections so they don't vanish silently.
      (result as Promise<unknown>).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[agentfootprint] Listener Promise for "${type}" rejected:`, err);
      });
    }
  };

  originalsMap.set(wrapped as unknown as object, listener);
  return wrapped;
}
