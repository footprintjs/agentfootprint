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
import { z } from 'zod';
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
import {
  Agent,
  absent,
  coverage,
  defineTool,
  fromIdentity,
  hostFilled,
  type AnswerCoverage,
  type AnswerNegatives,
} from '../../src/index.js';
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
      // Bare prevHash clobber (stored hash untouched) — caught by the
      // LINKAGE check, not the per-record hash check. Named so the
      // deterministic table is complete audit evidence (review finding).
      name: 'prevHash clobbered',
      mutate: (r) => (r.prevHash = 'f'.repeat(64)),
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

  // Head-truncation guard (adversarial-review finding): finalHash anchoring
  // alone cannot catch dropping the FIRST K records — the verifier instead
  // enforces `firstSeq 0 ⟺ zero-hash chainHead` in BOTH directions, so a
  // head-truncated forgery must visibly claim firstSeq > 0.
  it('rejects head truncation that keeps firstSeq 0 with a forged chainHead', () => {
    const tampered = mutable(smallChain(3));
    const survivor = tampered.records[2] as Record<string, unknown>;
    tampered.records.splice(0, 2); // drop genesis + first event
    const header = tampered.header as Record<string, unknown>;
    header.chainHead = survivor.prevHash; // forge: chain now "starts" at the survivor
    header.recordCount = tampered.records.length;
    // firstSeq left at 0 — the naive forgery
    const result = verifyAuditBundle(tampered as unknown as AuditBundle);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/head-truncation guard/);
  });

  it('rejects a zero-hash chainHead claiming firstSeq > 0', () => {
    const tampered = mutable(smallChain(2));
    (tampered.header as Record<string, unknown>).firstSeq = 5;
    const result = verifyAuditBundle(tampered as unknown as AuditBundle);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/head-truncation guard/);
  });

  it('a legit non-first segment (firstSeq > 0, nonzero chainHead) still verifies standalone', () => {
    // Build via drain: segment 2 starts mid-chain by construction.
    const audit = auditExport();
    audit.exportEvent(
      envelope('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }),
    );
    const seg1 = audit.drain();
    audit.exportEvent(
      envelope('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 0 }),
    );
    const seg2 = audit.drain();
    expect(seg2.header.firstSeq).toBeGreaterThan(0);
    expect(seg2.header.chainHead).toBe(seg1.finalHash);
    expect(verifyAuditBundle(seg2).valid).toBe(true); // standalone mid-segment is fine
    expect(verifyAuditBundle([seg1, seg2]).valid).toBe(true);
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

// ─── SECURITY — a typed answer's limits and negatives (turn_end) ─────

/** The payload of a bundle's `turn_end` record, as chained. */
function turnEndOf(bundle: AuditBundle): Record<string, unknown> {
  const record = bundle.records.find((r) => r.eventType === 'agentfootprint.agent.turn_end');
  expect(record, 'the bundle holds the turn_end record').toBeDefined();
  return record?.payload as Record<string, unknown>;
}

const CHARS = /^\[\d+ chars\]$/;

/** A typed agent whose one tool declares every kind of limit and has a value assumed. */
async function runTypedLimitsAgent(opts?: { payloadMode?: 'bounded' | 'verbatim' }) {
  const audit = auditExport(opts);
  const ordersTool = defineTool({
    name: 'orders_search',
    description: 'Open orders for one region.',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string', description: 'Region code.' } },
      required: ['region'],
    },
    // The model leaves `region` out; the tool's rule fills it — an assumed value.
    askOrAssume: { region: { assume: 'LIMITS-ASSUMED-REGION' } },
    execute: () =>
      coverage(
        { open: 3 },
        {
          checked: ['LIMITS-CHECKED orders of the customer'],
          notChecked: [{ what: 'LIMITS-NOT-CHECKED archive', why: 'LIMITS-WHY timed out' }],
          cannotCover: [
            {
              what: 'LIMITS-CANNOT-COVER orders placed by phone',
              why: 'LIMITS-WHY no phone collector',
              short: 'LIMITS-SHORT phone',
              kind: 'scope',
            },
          ],
          inProgress: [
            { what: 'LIMITS-IN-PROGRESS refunds', why: 'LIMITS-WHY still settling', count: 2 },
          ],
          period: {
            queried: { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' },
            held: 'unknown',
            readAt: '2026-10-02T00:00:05Z',
          },
        },
      ),
  });
  const agent = Agent.create({
    provider: new MockProvider({
      replies: [
        { toolCalls: [{ id: 'tc-1', name: 'orders_search', args: {} }] },
        JSON.stringify({ open: 3 }),
      ],
    }),
    model: 'mock-model',
  })
    .tool(ordersTool)
    .outputSchema(z.object({ open: z.number() }).strict())
    .limitsTravelWithTheAnswer()
    .build();
  const emitted: AnswerCoverage[] = [];
  agent.on('agentfootprint.agent.turn_end', (e) => {
    if (e.payload.answerCoverage !== undefined) emitted.push(e.payload.answerCoverage as never);
  });
  const stop = agent.enable.observability({ strategy: audit });
  try {
    await agent.run({ message: 'how many open orders?' });
  } finally {
    stop();
  }
  return { audit, emitted };
}

const LIMITS_CONTENT = [
  'LIMITS-ASSUMED-REGION',
  'LIMITS-CHECKED',
  'LIMITS-NOT-CHECKED',
  'LIMITS-CANNOT-COVER',
  'LIMITS-SHORT',
  'LIMITS-IN-PROGRESS',
  'LIMITS-WHY',
  '2026-10-01T00:00:00Z',
  '2026-10-02T00:00:05Z',
];

/** A typed agent whose answer carries one negative the library composes from a recorded read. */
async function runNegativesAgent() {
  const audit = auditExport();
  const readTool = hostFilled(
    defineTool({
      name: 'read_incidents',
      description: 'Read incidents for the service in the authenticated tenant.',
      inputSchema: {
        type: 'object',
        properties: { service: { type: 'string' }, tenant: { type: 'string' } },
        required: ['service', 'tenant'],
      },
      effects: 'read',
      search: {
        source: { what: 'the incident store', said: ['incident store'] },
        subject: { what: 'incidents', said: ['incidents'] },
        arguments: [
          { name: 'service', role: 'population' },
          { name: 'tenant', role: 'filter' },
        ],
        complete: 'within-arguments',
      },
      execute: () => absent({ what: 'incidents', checked: 'declared' }),
    }),
    { tenant: fromIdentity('tenant') },
  );
  const parser = {
    parse(input: unknown): { negatives: unknown[] } {
      const value = input as { negatives?: unknown[] } | null;
      if (!value || !Array.isArray(value.negatives)) throw new Error('missing citations');
      return { negatives: value.negatives };
    },
  };
  const jsonSchema = {
    type: 'object',
    properties: {
      negatives: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
            restsOn: { type: 'array', items: { type: 'string' } },
          },
          required: ['kind', 'restsOn'],
          additionalProperties: false,
        },
      },
    },
    required: ['negatives'],
    additionalProperties: false,
  };
  const agent = Agent.create({
    provider: new MockProvider({
      replies: [
        {
          toolCalls: [{ id: 'a', name: 'read_incidents', args: { service: 'NEGATIVES-SERVICE' } }],
        },
        JSON.stringify({ negatives: [{ kind: 'none', restsOn: ['r1'] }] }),
      ],
    }),
    model: 'mock-model',
  })
    .tool(readTool)
    .outputSchema(parser, { jsonSchema })
    .negativeClaims({ field: 'negatives', tools: ['read_incidents'] })
    .build();
  const emitted: AnswerNegatives[] = [];
  agent.on('agentfootprint.agent.turn_end', (e) => {
    if (e.payload.answerNegatives !== undefined) emitted.push(e.payload.answerNegatives);
  });
  const stop = agent.enable.observability({ strategy: audit });
  try {
    await agent.run({
      message: 'Any incidents for that service?',
      identity: {
        tenant: 'tenant-fixture',
        principal: 'tester',
        conversationId: 'audit-negatives',
      },
    });
  } finally {
    stop();
  }
  return { audit, emitted };
}

describe("auditExport — security: a typed answer's limits and negatives (turn_end)", () => {
  it('SECURITY: a real run’s limits reach a bounded bundle as their shape, never their sentences, instants or assumed values', async () => {
    const { audit, emitted } = await runTypedLimitsAgent();
    // The run really carried every kind of limit on its turn_end…
    expect(emitted).toHaveLength(1);
    const live = emitted[0]!;
    const liveText = JSON.stringify(live);
    for (const content of LIMITS_CONTENT) expect(liveText).toContain(content);

    // …and the chained record holds none of it.
    const recorded = turnEndOf(audit.bundle()).answerCoverage as AnswerCoverage;
    const recordedText = JSON.stringify(recorded);
    for (const content of LIMITS_CONTENT) expect(recordedText, content).not.toContain(content);
    // Nor does any other record: the tool's own `tools.coverage_declared` event
    // carries the same sentences, and the chain bounds them there too.
    const bundleText = JSON.stringify(audit.bundle());
    for (const content of LIMITS_CONTENT) expect(bundleText, content).not.toContain(content);

    // The shape survives: every list, its length, the names, ids, counts and kinds.
    expect(recorded.checked).toHaveLength(live.checked.length);
    expect(recorded.notChecked).toHaveLength(live.notChecked.length);
    expect(recorded.cannotCover).toEqual(
      live.cannotCover.map((item) => ({
        what: `[${item.what.length} chars]`,
        why: `[${item.why!.length} chars]`,
        short: `[${item.short!.length} chars]`,
        kind: 'scope',
      })),
    );
    expect(recorded.assumed).toEqual([
      {
        toolName: 'orders_search',
        argument: 'region',
        value: '[21 chars]',
        hidden: false,
      },
    ]);
    expect(recorded.inProgress?.[0]).toMatchObject({
      toolName: 'orders_search',
      toolCallId: 'tc-1',
    });
    expect(recorded.inProgress?.[0]?.items[0]).toEqual({
      what: `[${live.inProgress![0]!.items[0]!.what.length} chars]`,
      why: `[${live.inProgress![0]!.items[0]!.why!.length} chars]`,
      count: 2,
    });
    expect(recorded.periods?.[0]).toEqual({
      toolName: 'orders_search',
      toolCallId: 'tc-1',
      queried: { from: '[20 chars]', to: '[20 chars]' },
      // The library's own word — the tool said it cannot vouch for the store.
      held: 'unknown',
      readAt: '[20 chars]',
    });
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it('SECURITY: a real run’s negatives reach a bounded bundle with codes and ids, never the statement or the population', async () => {
    const { audit, emitted } = await runNegativesAgent();
    expect(emitted).toHaveLength(1);
    const live = emitted[0]!;
    // The library's statement names the population the read covered.
    expect(live.claims[0]?.statement).toContain('NEGATIVES-SERVICE');
    expect(live.claims[0]?.about).toBe('NEGATIVES-SERVICE');

    const recorded = turnEndOf(audit.bundle()).answerNegatives as AnswerNegatives;
    expect(JSON.stringify(recorded)).not.toContain('NEGATIVES-SERVICE');
    // Nor does any other record of the run.
    expect(JSON.stringify(audit.bundle())).not.toContain('NEGATIVES-SERVICE');
    expect(recorded.claims[0]?.statement).toMatch(CHARS);
    expect(recorded.claims[0]?.about).toMatch(CHARS);
    // Everything the check decided rides as it was.
    const { claims: liveClaims, ...liveRecord } = live;
    const { claims: recordedClaims, ...recordedRecord } = recorded;
    expect(recordedRecord).toEqual(liveRecord);
    expect(recordedClaims).toEqual(
      liveClaims.map((claim) => ({
        ...claim,
        about: `[${String(claim.about).length} chars]`,
        statement: `[${claim.statement.length} chars]`,
      })),
    );
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it("SECURITY: payloadMode 'verbatim' still carries the limits whole (documented opt-in)", async () => {
    const { audit } = await runTypedLimitsAgent({ payloadMode: 'verbatim' });
    const recordedText = JSON.stringify(turnEndOf(audit.bundle()).answerCoverage);
    for (const content of LIMITS_CONTENT) expect(recordedText).toContain(content);
  });

  it('EDGE: a field the shape does not name, and a value that is not the shape, is a marker', () => {
    const audit = auditExport();
    audit.exportEvent(
      envelope('agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: '{}',
        answerCoverage: {
          // An own field set to `undefined` is absent, as JSON has it.
          checked: [{ what: 'EDGE-WHAT', why: undefined, futureProse: 'EDGE-FUTURE-ITEM' }],
          notChecked: 'EDGE-NOT-A-LIST',
          cannotCover: [null, 7, 'EDGE-BARE-STRING'],
          periods: [{ toolName: 't', queried: 'EDGE-NOT-A-WINDOW', held: { from: 'EDGE-FROM' } }],
          futureList: [{ what: 'EDGE-FUTURE-FIELD' }],
        },
        answerNegatives: {
          field: 'negatives',
          claims: [{ kind: 'none', about: 42, statement: 'EDGE-STATEMENT', note: 'EDGE-NOTE' }],
          checks: [{ id: 'c', future: { quote: 'EDGE-FUTURE-CHECK' } }],
        },
      }),
    );
    const payload = turnEndOf(audit.bundle());
    expect(JSON.stringify(payload)).not.toMatch(/EDGE-/);
    expect(payload.answerCoverage).toEqual({
      checked: [{ what: '[9 chars]', futureProse: '[16 chars]' }],
      notChecked: '[15 chars]',
      cannotCover: ['[type: null]', '[type: number]', '[16 chars]'],
      periods: [{ toolName: 't', queried: '[17 chars]', held: { from: '[9 chars]' } }],
      futureList: '[type: object]',
    });
    expect(payload.answerNegatives).toEqual({
      field: 'negatives',
      claims: [
        { kind: 'none', about: '[type: number]', statement: '[14 chars]', note: '[9 chars]' },
      ],
      checks: [{ id: 'c', future: '[type: object]' }],
    });
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });

  it('EDGE: a long list is capped like every list, each kept entry bounded', () => {
    const audit = auditExport();
    const checked = Array.from({ length: 40 }, (_, i) => ({ what: `EDGE-ITEM-${i}` }));
    audit.exportEvent(
      envelope('agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: '{}',
        answerCoverage: { checked, notChecked: [], cannotCover: [] },
      }),
    );
    const limits = turnEndOf(audit.bundle()).answerCoverage as { checked: unknown[] };
    expect(limits.checked).toHaveLength(33);
    expect(limits.checked[32]).toBe('…+8 more');
    expect(JSON.stringify(limits)).not.toMatch(/EDGE-/);
  });
});

// ─── SECURITY — every event whose content sits beside structure ──────

/** The bounded payload one event becomes. */
function boundedOf(type: string, payload: unknown): unknown {
  const audit = auditExport();
  audit.exportEvent(envelope(type, payload));
  return audit.bundle().records[1]?.payload;
}

describe('auditExport — security: content beside structure, event by event', () => {
  it("SECURITY: decide() evidence rides as the engine summarized it; a router's reason is a marker", () => {
    const decided = {
      conditionalId: 'tier',
      chosen: 'gold',
      rationale: "predicate for 'gold' returned true",
      evidence: { rules: [{ label: 'big spender', matched: true }], chosen: 'gold' },
    };
    expect(boundedOf('agentfootprint.composition.route_decided', decided)).toEqual(decided);
    expect(
      boundedOf('agentfootprint.composition.route_decided', {
        conditionalId: 'router',
        chosen: 'refunds',
        rationale: "router chose 'refunds'",
        evidence: { reason: 'EDGE-ROUTER: the customer said refund', inRoster: true },
      }),
    ).toEqual({
      conditionalId: 'router',
      chosen: 'refunds',
      rationale: "router chose 'refunds'",
      evidence: '[keys: reason, inRoster]',
    });
  });

  it("SECURITY: a pause's own reason is a marker; the library's fixed reason stays", () => {
    expect(
      boundedOf('agentfootprint.pause.request', {
        reason: 'EDGE-PAUSE: approve the refund of 9000?',
        questionPayload: { question: 'EDGE-PAUSE' },
      }),
    ).toEqual({ reason: '[39 chars]', questionPayload: '[keys: question]' });
    expect(
      boundedOf('agentfootprint.pause.request', {
        reason: 'stage requested pause',
        questionPayload: { data: 1 },
      }),
    ).toEqual({ reason: 'stage requested pause', questionPayload: '[keys: data]' });
  });

  it('EDGE: a declared "none" stays — no next page, no question, a store the tool cannot vouch for', () => {
    expect(
      boundedOf('agentfootprint.tools.semantics_declared', {
        toolName: 't',
        toolCallId: 'c',
        iteration: 1,
        semantics: { af_semantics: true, note: 'n', paging: { next: null }, clarify: null },
      }),
    ).toEqual({
      toolName: 't',
      toolCallId: 'c',
      iteration: 1,
      semantics: { af_semantics: true, note: 'n', paging: { next: null }, clarify: null },
    });
    expect(
      boundedOf('agentfootprint.tools.coverage_declared', {
        toolName: 't',
        toolCallId: 'c',
        iteration: 1,
        period: { queried: { from: 'EDGE-FROM', to: 'EDGE-TO' }, held: 'unknown' },
      }),
    ).toEqual({
      toolName: 't',
      toolCallId: 'c',
      iteration: 1,
      period: { queried: { from: '[9 chars]', to: '[7 chars]' }, held: 'unknown' },
    });
  });

  it('EDGE: a whole-event shape fails closed — an unnamed field, or a payload that is not an object', () => {
    expect(
      boundedOf('agentfootprint.map.parked', {
        mapId: 'orders-map',
        iteration: 3,
        by: 'lexical',
        idleCalls: 3,
        witness: 'EDGE-WITNESS',
        futureQuote: 'EDGE-FUTURE',
      }),
    ).toEqual({
      mapId: 'orders-map',
      iteration: 3,
      by: 'lexical',
      idleCalls: 3,
      witness: '[12 chars]',
      futureQuote: '[11 chars]',
    });
    expect(boundedOf('agentfootprint.map.parked', 'EDGE-NOT-AN-OBJECT')).toBe('[18 chars]');
  });

  it("SECURITY: payloadMode 'verbatim' still carries every event whole (documented opt-in)", () => {
    const audit = auditExport({ payloadMode: 'verbatim' });
    audit.exportEvent(
      envelope('agentfootprint.map.engaged', {
        mapId: 'm',
        iteration: 1,
        by: 'lexical',
        witness: 'EDGE-VERBATIM-WITNESS',
      }),
    );
    expect(JSON.stringify(audit.bundle())).toContain('EDGE-VERBATIM-WITNESS');
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

/**
 * Random limits and negatives: every content leaf is a `PROP-` string, every
 * record leaf is not, so the bounded record must be the input with exactly
 * those strings replaced by their `'[N chars]'` marker — an oracle that never
 * reads the exporter's own shape tables.
 */
function randomLimitsAndNegatives(rand: () => number, trial: number) {
  let n = 0;
  const text = () => `PROP-${trial}-${n++}-${Math.floor(rand() * 1e9).toString(36)}`;
  const some = <T>(make: () => T): T[] => Array.from({ length: Math.floor(rand() * 4) }, make);
  const maybe = <T extends object>(value: T): T | Record<string, never> =>
    rand() < 0.5 ? value : {};
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rand() * values.length)]!;
  const item = () => ({
    what: text(),
    ...maybe({ why: text() }),
    ...maybe({ short: text() }),
    ...maybe({ kind: pick(['existence', 'scope'] as const) }),
  });
  const window = () => ({ from: text(), to: text() });
  const answerCoverage = {
    checked: some(item),
    notChecked: some(item),
    cannotCover: some(item),
    ...maybe({
      periods: some(() => ({
        toolName: pick(['orders', 'refunds']),
        ...maybe({ toolCallId: `call-${n}` }),
        queried: window(),
        held: rand() < 0.3 ? 'unknown' : window(),
        ...maybe({ readAt: text() }),
      })),
    }),
    ...maybe({
      inProgress: some(() => ({
        toolName: 'orders',
        ...maybe({ toolCallId: `call-${n}` }),
        items: some(() => ({
          what: text(),
          ...maybe({ why: text() }),
          ...maybe({ short: text() }),
          ...maybe({ count: 1 + Math.floor(rand() * 9) }),
        })),
      })),
    }),
    ...maybe({
      assumed: some(() => ({
        toolName: 'orders',
        argument: pick(['region', 'window']),
        value: text(),
        hidden: rand() < 0.5,
      })),
    }),
  };
  const answerNegatives = {
    field: 'negatives',
    version: '2',
    delivery: pick(['as-checked', 'recorded', 'fallback'] as const),
    claims: some(() => ({
      kind: pick(['none', 'not-found', 'complete', 'unknown'] as const),
      ...maybe({ about: text() }),
      restsOn: some(() => `r${1 + Math.floor(rand() * 9)}`),
      statement: text(),
      delivery: 'record-composed',
      version: '2',
    })),
    checks: some(() => ({
      id: `agent:negative-claims:negatives#${n}`,
      path: `negatives[${n}]`,
      index: n,
      kind: 'none',
      code: pick(['established', 'stale-turn', 'search-incomplete']),
      disposition: pick(['checked-fail', 'not-applicable', 'unreachable']),
      tools: ['orders'],
      results: [`claim-result/ns/run-1/${n}`],
      ...maybe({ staleSince: { turn: 1, readAt: '2026-10-29T09:00:00.000Z' } }),
    })),
    coverage: some(() => ({ tool: 'orders', checked: Math.floor(rand() * 5) })),
    actions: some(() => ({ tool: 'refund', outcome: pick(['ok', 'error', 'not-run'] as const) })),
  };
  return { answerCoverage, answerNegatives };
}

/** `value` with every `PROP-` string replaced by its `'[N chars]'` marker. */
function withContentMarked(value: unknown): unknown {
  if (typeof value === 'string')
    return value.startsWith('PROP-') ? `[${value.length} chars]` : value;
  if (Array.isArray(value)) return value.map(withContentMarked);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withContentMarked(v)]));
  }
  return value;
}

describe("auditExport — property: a typed answer's limits and negatives in a bounded bundle", () => {
  it('every content leaf is its marker, every record leaf and list length is kept (100 trials)', () => {
    for (let trial = 0; trial < 100; trial++) {
      const rand = lcg(4200 + trial);
      const content = randomLimitsAndNegatives(rand, trial);
      const audit = auditExport();
      audit.exportEvent(
        envelope('agentfootprint.agent.turn_end', { turnIndex: 0, finalContent: '{}', ...content }),
      );
      const bundle = audit.bundle();
      expect(JSON.stringify(bundle), `trial ${trial}`).not.toContain('PROP-');
      const payload = turnEndOf(bundle);
      expect(payload.answerCoverage, `trial ${trial}`).toEqual(
        withContentMarked(content.answerCoverage),
      );
      expect(payload.answerNegatives, `trial ${trial}`).toEqual(
        withContentMarked(content.answerNegatives),
      );
      expect(verifyAuditBundle(roundTrip(bundle)).valid, `trial ${trial}`).toBe(true);
    }
  });
});
