/**
 * work — an admitted operation's charge, and the work under it until that work
 * has settled.
 *
 * Pattern: one object per unit of work that is at once the request guard
 *          (`mcp/requestGuard.ts`) and the count of what is still running.
 * Role:    The pool's third budget (`docs/design/2026-10-mcp-client-pool.md`
 *          § 5.3). The accounting unit is the admitted LOGICAL operation: a
 *          `tools/call`, a listing (one `list(ctx)` for one conversation), an
 *          `acquire` and an ending each take one slot at admission. Setup an
 *          operation performs for itself — the open of its key's client, the
 *          revalidating `tools/list` of a replacement — runs inside that slot.
 *
 * AN ABORT IS NOT SETTLEMENT. A slot is released only when the operation's
 * logical request has its answer AND every piece of work under it has settled:
 * the `send()` it made, a credential vend, an attempt's `fetch`, an AWS `send`,
 * the open it owns. A caller's timeout answers the caller; it frees nothing.
 * Work that never settles keeps its charge — `stats().unsettled` reports it,
 * and the budget refuses new work rather than admit it against room that does
 * not exist. There is no release that returns capacity sooner.
 */

import { abortErrorOf, linkedController } from '../../lib/abort.js';
import type { RequestGuard } from '../requestGuard.js';

/** What a unit of work is doing now — what `stats().unsettled` counts it under. */
export type WorkKind = 'open' | 'listing' | 'call' | 'ending';

/** What an operation is, as the budget admits it. */
export type OperationKind = 'listing' | 'call' | 'acquire' | 'ending';

/** What a request's answer proved, as the pool's fetch read it (`pool.ts`). */
export type WorkEvidence = 'server-404' | 'handle-lost';

/**
 * One unit of pooled work: its requests are checked against it at every
 * boundary (`check`), and every promise started for it is counted until it
 * settles (`track`). It is SETTLED once its logical part has finished and the
 * count is zero.
 */
export class Work implements RequestGuard {
  private readonly link: ReturnType<typeof linkedController>;
  private pending = 0;
  private finished = false;
  private done = false;
  /** Still running underneath when the caller was answered: it lingered. */
  private lingered = false;
  private readonly listeners: Array<() => void> = [];
  /** What `check` asks besides the abort — a call's binding. */
  private extra: (() => void) | undefined;
  /** What the latest answered request proved, if anything. */
  evidence: WorkEvidence | undefined;

  constructor(
    /** What it is doing now. */
    public phase: WorkKind,
    sources: readonly (AbortSignal | undefined)[],
  ) {
    this.link = linkedController(...sources);
  }

  /** What aborts its own work: its sources, its deadline, its caller detaching. */
  get signal(): AbortSignal {
    return this.link.controller.signal;
  }

  /** True once its logical part finished and everything under it settled. */
  get settled(): boolean {
    return this.done;
  }

  /** Its caller was answered while work under it still ran. */
  get unsettledPastAnswer(): boolean {
    return this.finished && !this.done;
  }

  /** Abort its work with `reason` (a deadline, a detached caller). Idempotent. */
  abort(reason: unknown): void {
    if (!this.link.controller.signal.aborted) this.link.controller.abort(reason);
  }

  /** Ask `gate` too, each time a request is checked. */
  guardWith(gate: () => void): void {
    this.extra = gate;
  }

  /**
   * The send gate: refused once its caller was answered (nothing more is sent
   * for an answered operation), once aborted, or when the extra gate refuses.
   */
  check(): void {
    if (this.finished) throw workFinished();
    const { signal } = this;
    if (signal.aborted) throw abortErrorOf(signal);
    this.extra?.();
  }

  /** Count `work` until it settles. Never throws; never surfaces its rejection. */
  track(work: PromiseLike<unknown>): void {
    if (this.done) return;
    this.pending += 1;
    const release = (): void => {
      this.pending -= 1;
      this.settleIfDone();
    };
    Promise.resolve(work).then(release, release);
  }

  /** Record what a request's answer proved. */
  note(evidence: WorkEvidence): void {
    this.evidence = evidence;
  }

  /**
   * Its logical part is over: the caller has its answer. It settles now, or —
   * when work under it still runs — when that work does.
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.pending > 0) this.lingered = true;
    // Nothing more may be sent for it: `check` refuses from here on. Its signal
    // is left alone — a stream the SDK is still reading is not this work's to cut.
    this.settleIfDone();
  }

  /** Did it linger — answered while work under it ran? Read once it settled. */
  get settledLate(): boolean {
    return this.lingered;
  }

  /** Call `listener` once it has settled (at once when it already has). */
  onSettled(listener: () => void): void {
    if (this.done) listener();
    else this.listeners.push(listener);
  }

  /** A promise that resolves once it has settled. */
  whenSettled(): Promise<void> {
    return new Promise((resolve) => this.onSettled(resolve));
  }

  private settleIfDone(): void {
    if (this.done || !this.finished || this.pending > 0) return;
    this.done = true;
    this.link.unlink();
    for (const listener of this.listeners.splice(0)) {
      try {
        listener();
      } catch {
        // A listener is the pool's own bookkeeping; one failing must not stop the rest.
      }
    }
  }
}

/** The reason a finished operation refuses any later send — a fixed sentence. */
function workFinished(): Error {
  return Object.assign(new Error('This pooled operation has already been answered.'), {
    name: 'AbortError',
  });
}

/** An admitted operation: a unit of work that holds one slot of the budget. */
export class Operation extends Work {
  constructor(
    readonly kind: OperationKind,
    phase: WorkKind,
    sources: readonly (AbortSignal | undefined)[],
    /** When it was admitted, on the pool's clock. */
    readonly admittedAt: number,
  ) {
    super(phase, sources);
  }
}

/**
 * The pool-wide operation budget: at most `max` operations charged, each from
 * its admission until it has SETTLED (see the module note). Admission is the
 * only way in; settlement the only way out.
 */
export class OperationBudget {
  private readonly charged = new Set<Operation>();
  private readonly onRelease: Array<(operation: Operation) => void> = [];

  constructor(readonly max: number) {}

  /** Operations charged now. */
  get count(): number {
    return this.charged.size;
  }

  /** Is there a free slot? */
  get hasRoom(): boolean {
    return this.charged.size < this.max;
  }

  /**
   * Admit one operation, or `undefined` when the budget is full. The slot is
   * charged from here until the operation settles.
   */
  admit(
    kind: OperationKind,
    phase: WorkKind,
    sources: readonly (AbortSignal | undefined)[],
    now: number,
  ): Operation | undefined {
    if (!this.hasRoom) return undefined;
    const operation = new Operation(kind, phase, sources, now);
    this.charged.add(operation);
    operation.onSettled(() => {
      this.charged.delete(operation);
      for (const listener of [...this.onRelease]) listener(operation);
    });
    return operation;
  }

  /** Call `listener` each time an operation settles and frees its slot. Returns the unsubscribe. */
  whenReleased(listener: (operation: Operation) => void): () => void {
    this.onRelease.push(listener);
    return () => {
      const at = this.onRelease.indexOf(listener);
      if (at >= 0) this.onRelease.splice(at, 1);
    };
  }

  /** Charged work whose caller was already answered and which has not settled, by what it is doing. */
  unsettled(): Record<WorkKind, number> {
    const counts: Record<WorkKind, number> = { open: 0, listing: 0, call: 0, ending: 0 };
    for (const operation of this.charged) {
      if (operation.unsettledPastAnswer) counts[operation.phase] += 1;
    }
    return counts;
  }
}
