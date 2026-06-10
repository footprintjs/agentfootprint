/**
 * auditExport / verifyAuditBundle — tamper-evident audit chain (#20).
 *
 * Test types (Convention 3):
 *
 *   UNIT        — chain math (genesis, prevHash links, seq, preimage),
 *                 tamper detection PER FIELD, header checks, empty
 *                 bundle, stop semantics
 *   FUNCTIONAL  — a REAL Agent run (MockProvider, scripted tool call)
 *                 through agent.enable.observability → verified bundle
 *   INTEGRATION — drain() segments re-verify individually AND
 *                 concatenated; second run chains onto the same log
 *   SECURITY    — sentinel PII never reaches a bounded bundle; hash
 *                 stability across JSON key reordering; verbatim mode
 *                 disclosure is real (documented opt-in)
 *   PROPERTY    — random event sequences always verify; ANY single
 *                 random record mutation is always detected
 *
 * LESSON (#5, load-bearing): events here use the REAL dispatcher
 * envelope shape — `{ type, payload, meta: { runId, ... } }` — and the
 * functional/security tests run a REAL agent, not fabricated shapes.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUNDLE_FORMAT,
  AUDIT_GENESIS_EVENT_TYPE,
  AUDIT_ZERO_HASH,
  auditExport,
  verifyAuditBundle,
  type AuditBundle,
  type AuditRecord,
} from '../../src/adapters/observability/audit.js';
import { canonicalJson } from '../../src/lib/canonicalJson.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { ALL_EVENT_TYPES } from '../../src/events/registry.js';
import { Agent } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';

// ── helpers ──────────────────────────────────────────────────────────

/** REAL dispatcher-envelope event — run anchor on `meta.runId`, exactly
 *  as `bridge/eventMeta.ts` produces at runtime. */
function envelope(
  type: string,
  payload: unknown,
  opts: { runId?: string; wallClockMs?: number } = {},
): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: opts.wallClockMs ?? 1700000000000,
      runOffsetMs: 1,
      runtimeStageId: 'stage#0',
      subflowPath: [],
      compositionPath: [],
      runId: opts.runId ?? 'run-1',
    },
  } as unknown as AgentfootprintEvent;
}

/** Deep-copy a bundle through JSON (what a persisted bundle looks like). */
function roundTrip(bundle: AuditBundle): AuditBundle {
  return JSON.parse(JSON.stringify(bundle)) as AuditBundle;
}

type MutableBundle = {
  header: Record<string, unknown>;
  records: Array<Record<string, unknown>>;
  finalHash: string;
};

function mutable(bundle: AuditBundle): MutableBundle {
  return JSON.parse(JSON.stringify(bundle)) as MutableBundle;
}

function smallChain(eventCount = 3): AuditBundle {
  const audit = auditExport({ agent: 'unit-agent' });
  for (let i = 0; i < eventCount; i++) {
    audit.exportEvent(
      envelope('agentfootprint.cost.tick', {
        scope: 'iteration',
        tokensInput: i,
        tokensOutput: i,
        estimatedUsd: i / 100,
        cumulative: { tokensInput: i, tokensOutput: i, estimatedUsd: i / 100 },
      }),
    );
  }
  return audit.bundle();
}

// ─── UNIT — chain construction ───────────────────────────────────────

describe('auditExport — unit: chain construction', () => {
  it('anchors each run with a genesis record carrying runId + agent identity + versions', () => {
    const audit = auditExport({ agent: 'loan-officer', versions: { app: '1.2.3' } });
    audit.exportEvent(
      envelope('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 0 }),
    );
    const { records } = audit.bundle();

    expect(records[0]?.eventType).toBe(AUDIT_GENESIS_EVENT_TYPE);
    expect(records[0]?.prevHash).toBe(AUDIT_ZERO_HASH);
    const genesis = records[0]?.payload as Record<string, unknown>;
    expect(genesis.runId).toBe('run-1');
    expect(genesis.agent).toBe('loan-officer');
    expect(genesis.versions).toEqual({ app: '1.2.3' });
    const library = genesis.library as Record<string, unknown>;
    expect(library.name).toBe('agentfootprint');
    expect(typeof library.version).toBe('string');
  });

  it('links records: prevHash chains, seq is contiguous, hash = SHA-256 over the canonical preimage', () => {
    const bundle = smallChain(3);
    expect(bundle.records).toHaveLength(4); // genesis + 3 events
    expect(bundle.header.chainHead).toBe(AUDIT_ZERO_HASH);
    expect(bundle.finalHash).toBe(bundle.records[3]?.hash);

    for (let i = 0; i < bundle.records.length; i++) {
      const record = bundle.records[i] as AuditRecord;
      expect(record.seq).toBe(i);
      expect(record.prevHash).toBe(i === 0 ? AUDIT_ZERO_HASH : bundle.records[i - 1]?.hash);
      // Independent recomputation — the documented preimage contract.
      const { hash, ...preimage } = record;
      const recomputed = createHash('sha256').update(canonicalJson(preimage), 'utf8').digest('hex');
      expect(recomputed).toBe(hash);
    }
  });

  it('timestamps records from the event meta wallClockMs', () => {
    const audit = auditExport();
    audit.exportEvent(
      envelope('agentfootprint.cost.tick', { scope: 'run' }, { wallClockMs: 42424242 }),
    );
    const { records } = audit.bundle();
    expect(records[0]?.timestamp).toBe(42424242); // genesis uses the first event's clock
    expect(records[1]?.timestamp).toBe(42424242);
  });

  it('a second runId chains back-to-back in the SAME log with its own genesis', () => {
    const audit = auditExport();
    audit.exportEvent(envelope('agentfootprint.cost.tick', { scope: 'run' }, { runId: 'run-A' }));
    audit.exportEvent(envelope('agentfootprint.cost.tick', { scope: 'run' }, { runId: 'run-B' }));
    const { records } = audit.bundle();
    expect(records.map((r) => r.eventType)).toEqual([
      AUDIT_GENESIS_EVENT_TYPE,
      'agentfootprint.cost.tick',
      AUDIT_GENESIS_EVENT_TYPE,
      'agentfootprint.cost.tick',
    ]);
    // run-B's genesis links to run-A's last record — dropping a whole
    // run would break the chain.
    expect(records[2]?.prevHash).toBe(records[1]?.hash);
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it('empty bundle (no events yet) verifies: finalHash === chainHead, zero records', () => {
    const audit = auditExport();
    const bundle = audit.bundle();
    expect(bundle.records).toHaveLength(0);
    expect(bundle.finalHash).toBe(bundle.header.chainHead);
    expect(verifyAuditBundle(bundle)).toEqual({ valid: true, recordsChecked: 0 });
  });

  it('excludes stream.token / stream.thinking_delta by default; includeTokenEvents opts in', () => {
    const silent = auditExport();
    silent.exportEvent(
      envelope('agentfootprint.stream.token', { iteration: 0, tokenIndex: 0, content: 'x' }),
    );
    silent.exportEvent(
      envelope('agentfootprint.stream.thinking_delta', {
        iteration: 0,
        tokenIndex: 0,
        content: 'y',
      }),
    );
    expect(silent.recordCount()).toBe(0); // not even a genesis

    const loud = auditExport({ includeTokenEvents: true });
    loud.exportEvent(
      envelope('agentfootprint.stream.token', { iteration: 0, tokenIndex: 0, content: 'x' }),
    );
    expect(loud.recordCount()).toBe(2); // genesis + token
  });

  it('stop() halts recording but never destroys collected evidence', () => {
    const audit = auditExport();
    audit.exportEvent(envelope('agentfootprint.cost.tick', { scope: 'run' }));
    audit.stop?.();
    audit.stop?.(); // idempotent
    audit.exportEvent(envelope('agentfootprint.cost.tick', { scope: 'run' }));
    expect(audit.recordCount()).toBe(2); // genesis + first tick only
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it('events without meta are still recorded under the unattributed anchor (audit never drops)', () => {
    const audit = auditExport();
    audit.exportEvent({
      type: 'agentfootprint.cost.tick',
      payload: { scope: 'run' },
    } as unknown as AgentfootprintEvent);
    const { records } = audit.bundle();
    expect(records).toHaveLength(2);
    expect(records[1]?.meta.runId).toBe('unattributed');
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it('validate() resolves node:crypto eagerly (attach-time failure contract)', () => {
    expect(() => auditExport().validate?.()).not.toThrow();
  });
});

// ─── UNIT — tamper detection per field ───────────────────────────────

describe('verifyAuditBundle — unit: tamper detection names the exact record', () => {
  const FIELD_MUTATIONS: ReadonlyArray<{
    name: string;
    mutate: (r: Record<string, unknown>) => void;
  }> = [
    {
      name: 'payload value flipped',
      mutate: (r) => ((r.payload as Record<string, unknown>).tokensInput = 999),
    },
    {
      name: 'payload field added',
      mutate: (r) => ((r.payload as Record<string, unknown>).injected = true),
    },
    { name: 'record field added', mutate: (r) => (r.forged = true) },
    {
      name: 'eventType rewritten',
      mutate: (r) => (r.eventType = 'agentfootprint.permission.check'),
    },
    { name: 'timestamp shifted', mutate: (r) => (r.timestamp = (r.timestamp as number) + 1) },
    {
      name: 'meta.runId rewritten',
      mutate: (r) => ((r.meta as Record<string, unknown>).runId = 'other-run'),
    },
    { name: 'seq renumbered', mutate: (r) => (r.seq = 99) },
  ];

  for (const { name, mutate } of FIELD_MUTATIONS) {
    it(`detects: ${name} (brokenAt = the mutated record)`, () => {
      const tampered = mutable(smallChain(3));
      mutate(tampered.records[2] as Record<string, unknown>);
      const result = verifyAuditBundle(tampered as unknown as AuditBundle);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2);
      expect(result.reason).toBeTruthy();
    });
  }

  it('detects a re-hashed record (attacker recomputes the record hash → next link breaks)', () => {
    const tampered = mutable(smallChain(3));
    const record = tampered.records[2] as Record<string, unknown>;
    (record.payload as Record<string, unknown>).tokensInput = 999;
    const { hash: _old, ...preimage } = record;
    void _old;
    record.hash = createHash('sha256').update(canonicalJson(preimage), 'utf8').digest('hex');
    const result = verifyAuditBundle(tampered as unknown as AuditBundle);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3); // the successor's prevHash no longer matches
    expect(result.reason).toMatch(/chain broken/);
  });

  it('detects a deleted record', () => {
    const tampered = mutable(smallChain(3));
    tampered.records.splice(2, 1);
    (tampered.header as Record<string, unknown>).recordCount = tampered.records.length;
    const result = verifyAuditBundle(tampered as unknown as AuditBundle);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects a truncated tail (records dropped, finalHash stale)', () => {
    const tampered = mutable(smallChain(3));
    tampered.records.pop();
    (tampered.header as Record<string, unknown>).recordCount = tampered.records.length;
    const result = verifyAuditBundle(tampered as unknown as AuditBundle);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/finalHash/);
  });

  it('detects header tampering: recordCount, chainHead, format, canonicalization', () => {
    const base = smallChain(2);

    const wrongCount = mutable(base);
    (wrongCount.header as Record<string, unknown>).recordCount = 1;
    expect(verifyAuditBundle(wrongCount as unknown as AuditBundle).valid).toBe(false);

    const wrongHead = mutable(base);
    (wrongHead.header as Record<string, unknown>).chainHead = 'f'.repeat(64);
    expect(verifyAuditBundle(wrongHead as unknown as AuditBundle).valid).toBe(false);

    const wrongFormat = mutable(base);
    (wrongFormat.header as Record<string, unknown>).format = 'someone-elses.audit/1';
    const formatResult = verifyAuditBundle(wrongFormat as unknown as AuditBundle);
    expect(formatResult.valid).toBe(false);
    expect(formatResult.reason).toMatch(/format/);

    const wrongCanon = mutable(base);
    (wrongCanon.header as Record<string, unknown>).canonicalization = 'afp-cjson/2';
    expect(verifyAuditBundle(wrongCanon as unknown as AuditBundle).valid).toBe(false);
  });

  it('header constants are pinned (the offline-verifier contract)', () => {
    const { header } = smallChain(1);
    expect(header.format).toBe(AUDIT_BUNDLE_FORMAT);
    expect(header.hashAlgorithm).toBe('sha-256');
    expect(header.canonicalization).toBe('afp-cjson/1');
  });
});

// ─── FUNCTIONAL — real Agent run ─────────────────────────────────────

async function runRealAgent(opts?: { payloadMode?: 'bounded' | 'verbatim' }) {
  const audit = auditExport({ agent: 'compliance-agent', ...opts });
  const provider = new MockProvider({
    replies: [
      { toolCalls: [{ id: 'tc-1', name: 'lookup', args: { account: 'ACCT-PII-42' } }] },
      'CONTENT-PII-SENTINEL final text',
    ],
  });
  const agent = Agent.create({ provider, model: 'mock-model' })
    .system('You are terse.')
    .tool({
      schema: {
        name: 'lookup',
        description: 'Look up an account',
        inputSchema: { type: 'object' },
      },
      execute: () => 'RESULT-PII-SENTINEL',
    })
    .build();

  const stop = agent.enable.observability({ strategy: audit });
  try {
    const out = await agent.run({ message: 'check the SECRET-PROMPT account' });
    return { audit, out };
  } finally {
    stop();
  }
}

describe('auditExport — functional: real Agent run end-to-end', () => {
  it('captures the run as a verified chain: genesis → decisions → tool call → turn end', async () => {
    const { audit } = await runRealAgent();
    const bundle = audit.bundle();

    expect(bundle.records.length).toBeGreaterThan(4);
    expect(bundle.records[0]?.eventType).toBe(AUDIT_GENESIS_EVENT_TYPE);

    const types = bundle.records.map((r) => r.eventType);
    expect(types).toContain('agentfootprint.agent.turn_start');
    expect(types).toContain('agentfootprint.agent.route_decided');
    expect(types).toContain('agentfootprint.stream.tool_start');
    expect(types).toContain('agentfootprint.stream.tool_end');
    expect(types).toContain('agentfootprint.agent.turn_end');

    // All records share the run anchor from the REAL meta envelope.
    const runIds = new Set(bundle.records.map((r) => r.meta.runId));
    expect(runIds.size).toBe(1);

    const check = verifyAuditBundle(bundle);
    expect(check).toEqual({ valid: true, recordsChecked: bundle.records.length });

    // …and a persisted copy (JSON round-trip) verifies identically.
    expect(verifyAuditBundle(roundTrip(bundle)).valid).toBe(true);
  });

  it('flipping one byte in a real-run bundle names the exact record', async () => {
    const { audit } = await runRealAgent();
    const tampered = mutable(audit.bundle());
    const target = tampered.records.findIndex(
      (r) => r.eventType === 'agentfootprint.stream.tool_start',
    );
    expect(target).toBeGreaterThan(0);
    (tampered.records[target] as Record<string, unknown>).eventType =
      'agentfootprint.stream.tool_started'; // one byte appended
    const result = verifyAuditBundle(tampered as unknown as AuditBundle);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(target);
  });
});

// ─── INTEGRATION — drain segments ────────────────────────────────────

describe('auditExport — integration: drain() keeps the chain intact across segments', () => {
  it('drained segments verify individually AND concatenated end-to-end', async () => {
    const audit = auditExport();
    audit.exportEvent(
      envelope('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }),
    );
    audit.exportEvent(
      envelope('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 0 }),
    );
    const seg1 = audit.drain();

    audit.exportEvent(
      envelope('agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: 0,
        toolCallCount: 0,
      }),
    );
    const seg2 = audit.drain();

    audit.exportEvent(
      envelope('agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: 'a',
        totalInputTokens: 1,
        totalOutputTokens: 1,
        iterationCount: 1,
        durationMs: 2,
      }),
    );
    const seg3 = audit.bundle(); // last segment via snapshot, undrained

    // Segment headers carry the chain head — each picks up where the
    // previous finalHash left off.
    expect(seg1.header.chainHead).toBe(AUDIT_ZERO_HASH);
    expect(seg2.header.chainHead).toBe(seg1.finalHash);
    expect(seg3.header.chainHead).toBe(seg2.finalHash);
    expect(seg2.header.firstSeq).toBe(seg1.header.firstSeq + seg1.records.length);

    for (const seg of [seg1, seg2, seg3]) {
      expect(verifyAuditBundle(roundTrip(seg)).valid).toBe(true);
    }
    const all = verifyAuditBundle([seg1, seg2, seg3].map(roundTrip));
    expect(all.valid).toBe(true);
    expect(all.recordsChecked).toBe(
      seg1.records.length + seg2.records.length + seg3.records.length,
    );
  });

  it('detects a swapped / missing middle segment and cross-segment tampering', () => {
    const audit = auditExport();
    for (let i = 0; i < 3; i++) {
      audit.exportEvent(envelope('agentfootprint.cost.tick', { scope: 'run', tokensInput: i }));
    }
    const seg1 = audit.drain();
    audit.exportEvent(envelope('agentfootprint.cost.tick', { scope: 'run', tokensInput: 9 }));
    const seg2 = audit.drain();

    // Missing first segment → discontinuity (chainHead ≠ ZERO… is fine
    // for a single bundle, but the pair [seg2, seg1] breaks).
    const swapped = verifyAuditBundle([seg2, seg1]);
    expect(swapped.valid).toBe(false);
    expect(swapped.reason).toMatch(/discontinuity|chainHead|firstSeq/);

    // Tamper inside segment 1 → caught even when verifying the pair.
    const tamperedSeg1 = mutable(seg1);
    (
      (tamperedSeg1.records[1] as Record<string, unknown>).payload as Record<string, unknown>
    ).tokensInput = 777;
    const pair = verifyAuditBundle([tamperedSeg1 as unknown as AuditBundle, seg2]);
    expect(pair.valid).toBe(false);
    expect(pair.brokenAt).toBe(1);
  });

  it('a drain mid-run does not disturb a later full verification (real agent)', async () => {
    const audit = auditExport();
    const provider = new MockProvider({ replies: ['done', 'done again'] });
    const agent = Agent.create({ provider, model: 'mock-model' }).build();
    const stop = agent.enable.observability({ strategy: audit });
    try {
      await agent.run({ message: 'one' });
      const seg1 = audit.drain();
      await agent.run({ message: 'two' });
      const seg2 = audit.drain();
      expect(verifyAuditBundle([seg1, seg2]).valid).toBe(true);
      // Two runs → two genesis records across the segments.
      const geneses = [...seg1.records, ...seg2.records].filter(
        (r) => r.eventType === AUDIT_GENESIS_EVENT_TYPE,
      );
      expect(geneses).toHaveLength(2);
    } finally {
      stop();
    }
  });
});

// ─── SECURITY — PII discipline + hash stability ──────────────────────

describe('auditExport — security', () => {
  it('SECURITY: sentinel PII (args, results, prompt, content) never reaches a bounded bundle', async () => {
    const { audit } = await runRealAgent();
    const text = JSON.stringify(audit.bundle());
    expect(text).not.toContain('ACCT-PII-42'); // tool arg VALUE
    expect(text).not.toContain('RESULT-PII-SENTINEL'); // tool result VALUE
    expect(text).not.toContain('SECRET-PROMPT'); // user prompt
    expect(text).not.toContain('CONTENT-PII-SENTINEL'); // LLM content

    // …but the SHAPE survives: key names + types + char counts.
    const toolStart = audit
      .bundle()
      .records.find((r) => r.eventType === 'agentfootprint.stream.tool_start');
    expect((toolStart?.payload as Record<string, unknown>).args).toBe('[keys: account]');
    const toolEnd = audit
      .bundle()
      .records.find((r) => r.eventType === 'agentfootprint.stream.tool_end');
    expect((toolEnd?.payload as Record<string, unknown>).result).toBe('[type: string]');
    const turnStart = audit
      .bundle()
      .records.find((r) => r.eventType === 'agentfootprint.agent.turn_start');
    expect((turnStart?.payload as Record<string, unknown>).userPrompt).toMatch(/^\[\d+ chars\]$/);

    // Content PREVIEWS are bounded too (a preview of short content IS
    // the content); the contentHash still links identical injections.
    const injected = audit
      .bundle()
      .records.find((r) => r.eventType === 'agentfootprint.context.injected');
    const injectedPayload = injected?.payload as Record<string, unknown>;
    expect(injectedPayload.contentSummary).toMatch(/^\[\d+ chars\]$/);
    expect(typeof injectedPayload.contentHash).toBe('string');
  });

  it('SECURITY: error MESSAGE fields are bounded to char markers (messages can echo values)', () => {
    const audit = auditExport();
    audit.exportEvent(
      envelope('agentfootprint.error.fatal', {
        error: 'lookup failed for ACCT-PII-42',
        stage: 'tool-call',
        scope: 'run',
      }),
    );
    const record = audit.bundle().records[1];
    const payload = record?.payload as Record<string, unknown>;
    expect(payload.error).toMatch(/^\[\d+ chars\]$/);
    expect(payload.stage).toBe('tool-call'); // identifiers stay verbatim
    expect(JSON.stringify(audit.bundle())).not.toContain('ACCT-PII-42');
  });

  it("SECURITY: payloadMode 'verbatim' is a REAL disclosure (documented opt-in)", async () => {
    const { audit } = await runRealAgent({ payloadMode: 'verbatim' });
    const text = JSON.stringify(audit.bundle());
    expect(text).toContain('ACCT-PII-42');
    expect(text).toContain('SECRET-PROMPT');
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it('SECURITY: hash stability across JSON key reordering — reordered keys still verify', () => {
    const bundle = smallChain(2);
    // Re-serialize every record with REVERSED key order (a hostile or
    // merely different JSON writer) — canonicalization makes the
    // chain key-order independent.
    const reordered = JSON.parse(
      JSON.stringify(bundle, function reverseKeys(this: unknown, _key: string, value: unknown) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          const entries = Object.entries(value as Record<string, unknown>).reverse();
          return Object.fromEntries(entries);
        }
        return value;
      }),
    ) as AuditBundle;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(bundle)); // order really changed
    expect(verifyAuditBundle(reordered)).toEqual({ valid: true, recordsChecked: 3 });
  });

  it('SECURITY: oversized payload strings are capped (bundle growth is bounded)', () => {
    const audit = auditExport();
    audit.exportEvent(
      envelope('agentfootprint.skill.deactivated', { skillId: 's1', reason: 'x'.repeat(10_000) }),
    );
    const payload = audit.bundle().records[1]?.payload as Record<string, unknown>;
    expect((payload.reason as string).length).toBeLessThanOrEqual(256);
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });
});

// ─── PROPERTY — random sequences + random mutations ──────────────────

/** Deterministic LCG so failures are reproducible from the seed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomValue(rand: () => number, depth = 0): unknown {
  const pick = rand();
  if (depth > 2 || pick < 0.25) return Math.floor(rand() * 1000);
  if (pick < 0.45) return `s${Math.floor(rand() * 1e6).toString(36)}`;
  if (pick < 0.55) return rand() < 0.5;
  if (pick < 0.65) return null;
  if (pick < 0.8) {
    return Array.from({ length: Math.floor(rand() * 4) }, () => randomValue(rand, depth + 1));
  }
  const obj: Record<string, unknown> = {};
  for (let i = Math.floor(rand() * 4); i > 0; i--) {
    obj[`k${Math.floor(rand() * 10)}`] = randomValue(rand, depth + 1);
  }
  return obj;
}

function randomBundle(rand: () => number, eventCount: number): AuditBundle {
  const audit = auditExport();
  for (let i = 0; i < eventCount; i++) {
    const type = ALL_EVENT_TYPES[Math.floor(rand() * ALL_EVENT_TYPES.length)]!;
    const runId = `run-${Math.floor(rand() * 3)}`;
    audit.exportEvent(envelope(type, randomValue(rand), { runId, wallClockMs: 1 + i }));
  }
  return audit.bundle();
}

describe('auditExport — property: chains over random event streams', () => {
  it('any random event sequence produces a verifying chain (50 trials)', () => {
    for (let trial = 0; trial < 50; trial++) {
      const rand = lcg(1000 + trial);
      const bundle = randomBundle(rand, 1 + Math.floor(rand() * 30));
      const result = verifyAuditBundle(roundTrip(bundle));
      expect(result.valid, `trial ${trial}: ${result.reason ?? ''}`).toBe(true);
    }
  });

  it('any single-record scalar mutation is always detected and named (100 trials)', () => {
    for (let trial = 0; trial < 100; trial++) {
      const rand = lcg(9000 + trial);
      const bundle = randomBundle(rand, 2 + Math.floor(rand() * 20));
      const tampered = mutable(bundle);
      const idx = Math.floor(rand() * tampered.records.length);
      const record = tampered.records[idx] as Record<string, unknown>;
      // Mutate one of the scalar chain fields at random.
      const field = (['timestamp', 'eventType', 'prevHash', 'hash'] as const)[
        Math.floor(rand() * 4)
      ]!;
      record[field] =
        field === 'timestamp' ? (record[field] as number) + 1 : `${String(record[field])}x`;
      const result = verifyAuditBundle(tampered as unknown as AuditBundle);
      expect(result.valid, `trial ${trial}: mutated ${field}@${idx}`).toBe(false);
      expect(result.brokenAt, `trial ${trial}: brokenAt missing`).toBeTypeOf('number');
    }
  });
});
