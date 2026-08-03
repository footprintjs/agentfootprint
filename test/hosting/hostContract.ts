/**
 * THE HOST CONTRACT — the conformance suite every `AgentHost` adapter passes.
 *
 * This file is not a test. It is the artifact a new adapter is measured
 * against: import `describeHostContract`, describe how to create your host and
 * how to drive one request into it, and the same assertions that hold for
 * `nodeHost` have to hold for yours.
 *
 * The proof it exists to make is narrow and load-bearing: **ONE handler,
 * written once, serves every host unchanged.** So the handler under test is a
 * module-level constant here (`contractHandler`), and every expectation is a
 * pure function of the request (`expectedOutput`) — not a value re-derived per
 * adapter, which would let two hosts "both pass" while producing different
 * answers.
 *
 * Anything an adapter is allowed to differ on is asserted CONDITIONALLY, on the
 * capability the adapter declares — never on its name. That is the feature
 * detection law running inside the suite that enforces it.
 */

import { describe, expect, it } from 'vitest';

import { requireCapability } from '../../src/hosting/index.js';
import type { AgentHost, HostHandle, HostHandler } from '../../src/hosting/index.js';

// ─── What a subject has to tell the suite ────────────────────────────

/** Everything a caller can observe about one request, in transport-free terms. */
export interface HostObservation {
  /** The final answer, when the request produced one. */
  readonly output?: string;
  /** The failure message, when it did not. */
  readonly error?: string;
  /** The failure's stable code, when the transport carries one. */
  readonly code?: string;
  /** Pieces the caller actually saw arrive before the answer. */
  readonly chunks: readonly string[];
}

/** One request, in the vocabulary the port uses. */
export interface ContractRequest {
  readonly input: string;
  readonly sessionId?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Ask for incremental delivery, for hosts that can do it. */
  readonly stream?: boolean;
}

/** An adapter, plus how to drive one request into it. */
export interface HostUnderTest {
  readonly label: string;
  /** A fresh, not-yet-serving host. */
  create(): AgentHost;
  /** Drive one request into a serving host and report only what a CALLER sees. */
  invoke(handle: HostHandle, request: ContractRequest): Promise<HostObservation>;
}

// ─── The one handler every host serves ───────────────────────────────

const SLOW = 'SLOW';
const FAIL = 'FAIL';
const THROW = 'THROW';
const SILENT = 'SILENT';

let release: (() => void) | undefined;

/** Let a `SLOW` request finish. Safe to call when nothing is waiting. */
export function releaseSlowRequest(): void {
  release?.();
  release = undefined;
}

/** What the shared handler answers for a given request. Pure, and shared by
 *  every subject — so "both hosts passed" cannot mean "each agreed with
 *  itself". */
export function expectedOutput(request: ContractRequest): string {
  return [
    `echo:${request.input}`,
    `session:${request.sessionId ?? 'none'}`,
    `probe:${request.headers?.['x-probe'] ?? 'none'}`,
  ].join('|');
}

/** The chunks the handler emits, in order, on every host. */
export const EXPECTED_CHUNKS: readonly string[] = ['one ', 'two'];

/**
 * The handler. Written once, served by every host, never adapted per adapter —
 * this constant IS the portability claim.
 */
export const contractHandler: HostHandler = async (request, reply) => {
  if (request.input === THROW) throw new Error('handler exploded');
  if (request.input === FAIL) {
    reply.fail(new Error('handler refused'));
    return;
  }
  if (request.input === SILENT) return; // answers nothing, deliberately
  if (request.input === SLOW) {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  for (const chunk of EXPECTED_CHUNKS) reply.emit?.(chunk);
  reply.complete(expectedOutput(request));
};

// ─── The suite ───────────────────────────────────────────────────────

/**
 * Run the host contract against one adapter.
 *
 * 7-pattern coverage (unit · scenario · integration · property · security ·
 * performance · ROI) is spread across the cases below; the ROI case is the
 * portability claim itself, since the whole point is not writing the handler
 * twice.
 */
export function describeHostContract(subject: HostUnderTest): void {
  describe(`host contract — ${subject.label}`, () => {
    async function serving(): Promise<HostHandle> {
      return subject.create().serve(contractHandler);
    }

    // ── unit: the shape a host must declare ──
    it('declares a name and capabilities drawn from the known set', () => {
      const host = subject.create();
      expect(typeof host.name).toBe('string');
      expect(host.name.length).toBeGreaterThan(0);
      expect(Array.isArray(host.capabilities)).toBe(true);
      for (const capability of host.capabilities) expect(capability).toBe('streaming');
    });

    // ── integration: the handler's answer reaches the caller ──
    it('serves the shared handler and returns exactly what it completed with', async () => {
      const handle = await serving();
      try {
        const request: ContractRequest = { input: 'hello' };
        const observed = await subject.invoke(handle, request);
        expect(observed.output).toBe(expectedOutput(request));
        expect(observed.error).toBeUndefined();
      } finally {
        await handle.close();
      }
    });

    // ── integration: caller data arrives as the transport declared it ──
    it('delivers sessionId and headers through to the handler', async () => {
      const handle = await serving();
      try {
        const request: ContractRequest = {
          input: 'who am i',
          sessionId: 'conversation-7',
          headers: { 'x-probe': 'present' },
        };
        const observed = await subject.invoke(handle, request);
        expect(observed.output).toBe(expectedOutput(request));
        expect(observed.output).toContain('session:conversation-7');
        expect(observed.output).toContain('probe:present');
      } finally {
        await handle.close();
      }
    });

    // ── scenario: an explicit failure ──
    it('reply.fail(error) reaches the caller with the message intact', async () => {
      const handle = await serving();
      try {
        const observed = await subject.invoke(handle, { input: FAIL });
        expect(observed.output).toBeUndefined();
        expect(observed.error).toContain('handler refused');
      } finally {
        await handle.close();
      }
    });

    // ── scenario: a handler that throws must not hang the caller ──
    it('a handler that throws is reported as a failure, never a hang', async () => {
      const handle = await serving();
      try {
        const observed = await subject.invoke(handle, { input: THROW });
        expect(observed.output).toBeUndefined();
        expect(observed.error).toContain('handler exploded');
      } finally {
        await handle.close();
      }
    });

    // ── scenario: a handler that answers nothing ──
    it('a handler that returns without answering is failed, not left open', async () => {
      const handle = await serving();
      try {
        const observed = await subject.invoke(handle, { input: SILENT });
        expect(observed.output).toBeUndefined();
        expect(observed.error).toMatch(/complete\(\) or fail\(\)/);
      } finally {
        await handle.close();
      }
    });

    // ── property: the completion is authoritative on every host ──
    it('emit-then-complete: the final output is the same whatever the host does with chunks', async () => {
      const host = subject.create();
      const handle = await host.serve(contractHandler);
      try {
        const request: ContractRequest = { input: 'streamed', stream: true };
        const observed = await subject.invoke(handle, request);
        // The law: identical output, streaming or not. Chunks are a preview of
        // this same text, never an addition to it.
        expect(observed.output).toBe(expectedOutput(request));
        expect(observed.output).not.toContain('one two');
      } finally {
        await handle.close();
      }
    });

    // ── property: chunks appear IF AND ONLY IF the host says it streams ──
    it('chunks are observed exactly when the host declares streaming', async () => {
      const host = subject.create();
      const handle = await host.serve(contractHandler);
      try {
        const observed = await subject.invoke(handle, { input: 'streamed', stream: true });
        if (host.capabilities.includes('streaming')) {
          expect(observed.chunks).toEqual(EXPECTED_CHUNKS);
        } else {
          expect(observed.chunks).toEqual([]);
        }
      } finally {
        await handle.close();
      }
    });

    // ── security: asking for something absent must say who refused ──
    it('requireCapability answers for this adapter by name', () => {
      const host = subject.create();
      if (host.capabilities.includes('streaming')) {
        expect(() => requireCapability(host, 'streaming')).not.toThrow();
      } else {
        expect(() => requireCapability(host, 'streaming')).toThrow(host.name);
        expect(() => requireCapability(host, 'streaming')).toThrow(/does not support 'streaming'/);
      }
    });

    // ── performance / lifecycle: close() drains rather than drops ──
    it('close() lets in-flight work finish and refuses what arrives after', async () => {
      const handle = await serving();
      const slowRequest: ContractRequest = { input: SLOW };
      const inFlight = subject.invoke(handle, slowRequest);
      // Give the request time to reach the handler and park there.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const closing = handle.close();
      const afterClose = await subject.invoke(handle, { input: 'too late' });
      expect(afterClose.output).toBeUndefined();
      expect(afterClose.error).toMatch(/is closed/);

      releaseSlowRequest();
      await closing;
      const drained = await inFlight;
      expect(drained.output).toBe(expectedOutput(slowRequest));
    });

    it('close() is idempotent', async () => {
      const handle = await serving();
      await handle.close();
      await expect(handle.close()).resolves.toBeUndefined();
    });
  });
}
