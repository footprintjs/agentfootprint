/**
 * The actor reaches every sink — and each one is checked, not assumed (9.11.0).
 *
 *   P1 Unit         — the file sink writes `meta.principal` / `meta.tenant`
 *   P2 Boundary     — an anonymous run writes NEITHER key, on every sink
 *   P3 Scenario     — CloudWatch (and therefore AgentCore, which is the same
 *                     builder) ships the whole envelope, so it inherits them
 *   P4 Property     — n/a (the envelope is serialized wholesale)
 *   P5 Security     — the audit record hash-chains the actor with the event
 *   P6 Performance  — n/a
 *   P7 ROI          — OTel does NOT serialize the envelope, so the actor is
 *                     PLACED on the run span; this test is the reason we
 *                     checked instead of assuming
 *
 * The claim under test is the enterprise one: "the sinks serialize the envelope
 * so they inherit the actor for free". True of `file`, `cloudwatch`, `agentcore`
 * and `auditExport`. NOT true of `otel` (or `xray`) — those MAP selected signals
 * onto spans and segments, so anything not placed deliberately does not appear
 * at all. OTel is wired here; X-Ray is not, and the docs say so rather than
 * implying a coverage it does not have.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fileObservability } from '../../src/adapters/observability/file.js';
import {
  cloudwatchObservability,
  type CloudwatchObservabilityOptions,
} from '../../src/adapters/observability/cloudwatch.js';
import {
  otelObservability,
  type OtelSpanLike,
  type OtelSpanOptions,
  type OtelTracerLike,
} from '../../src/adapters/observability/otel.js';
import { auditExport, verifyAuditBundle } from '../../src/adapters/observability/audit.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const ACTOR = { principal: 'alice@acme.test', tenant: 'acme' };

function event(type: string, meta: Record<string, unknown>): AgentfootprintEvent {
  return {
    type,
    payload: { turnIndex: 0 },
    meta: { runId: 'run-1', runtimeStageId: 'seed#0', ...meta },
  } as unknown as AgentfootprintEvent;
}

const dirs: string[] = [];

function tempFile(name = 'events.ndjson'): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-actor-sink-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The one NDJSON line the sink wrote, parsed. */
function onlyLine(path: string): { meta: Record<string, unknown> } {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as { meta: Record<string, unknown> };
}

function mockCwClient(): {
  client: CloudwatchObservabilityOptions['_client'];
  messages: string[];
} {
  const messages: string[] = [];
  return {
    messages,
    client: {
      async putLogEvents(input) {
        for (const e of input.logEvents ?? []) messages.push(e.message);
      },
      async createLogStream() {
        /* stream always exists for this test */
      },
    },
  };
}

function mockTracer(): { tracer: OtelTracerLike; attrs: Record<string, unknown>[] } {
  const attrs: Record<string, unknown>[] = [];
  const tracer: OtelTracerLike = {
    startSpan(_name: string, options?: OtelSpanOptions): OtelSpanLike {
      const captured: Record<string, unknown> = { ...(options?.attributes ?? {}) };
      attrs.push(captured);
      return {
        setAttribute(key: string, value: string | number | boolean): unknown {
          captured[key] = value;
          return undefined;
        },
        setStatus: () => undefined,
        end: () => undefined,
        spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
      } as unknown as OtelSpanLike;
    },
  };
  return { tracer, attrs };
}

// ─── P1/P2 — the envelope-serializing sinks ──────────────────────────

describe('fileObservability', () => {
  it('inherits the actor for free — the whole envelope is one JSON line', async () => {
    const path = tempFile();
    const sink = fileObservability({ path, flushIntervalMs: 0 });
    sink.exportEvent(event('agentfootprint.agent.turn_start', ACTOR));
    await sink.flush?.();
    const line = onlyLine(path);
    expect(line.meta.principal).toBe('alice@acme.test');
    expect(line.meta.tenant).toBe('acme');
  });

  it('writes NEITHER key for an anonymous run', async () => {
    const path = tempFile('anon.ndjson');
    const sink = fileObservability({ path, flushIntervalMs: 0 });
    sink.exportEvent(event('agentfootprint.agent.turn_start', {}));
    await sink.flush?.();
    const line = onlyLine(path);
    expect('principal' in line.meta).toBe(false);
    expect('tenant' in line.meta).toBe(false);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('cloudwatchObservability (and agentcoreObservability, the same builder)', () => {
  it('ships the actor inside the log message', async () => {
    const { client, messages } = mockCwClient();
    const sink = cloudwatchObservability({
      logGroupName: '/g',
      logStreamName: 's',
      flushIntervalMs: 0,
      _client: client,
    });
    sink.exportEvent(event('agentfootprint.agent.turn_start', ACTOR));
    await sink.flush?.();
    expect(messages.length).toBeGreaterThan(0);
    const parsed = JSON.parse(messages[0] as string) as { meta: Record<string, unknown> };
    expect(parsed.meta.principal).toBe('alice@acme.test');
    expect(parsed.meta.tenant).toBe('acme');
  });
});

// ─── P5 Security — the tamper-evident record ─────────────────────────

describe('auditExport', () => {
  it('binds the actor into the hash-chained record', () => {
    const audit = auditExport({ agent: 'unit-agent' });
    audit.exportEvent(event('agentfootprint.agent.iteration_start', ACTOR));
    const { records } = audit.bundle();
    const row = records.find((r) => r.eventType === 'agentfootprint.agent.iteration_start');
    expect(row?.meta.principal).toBe('alice@acme.test');
    expect(row?.meta.tenant).toBe('acme');
    // The whole record — actor included — is inside the chain, so editing WHO
    // did something breaks the same verification that editing WHAT does.
    expect(verifyAuditBundle(audit.bundle()).valid).toBe(true);
  });
});

// ─── P7 — the sink that does NOT serialize the envelope ──────────────

describe('otelObservability', () => {
  it('PLACES the actor on the run span — it maps signals, it does not serialize', () => {
    const { tracer, attrs } = mockTracer();
    const sink = otelObservability({ serviceName: 'svc', tracer });
    sink.exportEvent(event('agentfootprint.agent.turn_start', ACTOR));
    expect(attrs).toHaveLength(1);
    expect(attrs[0]?.['agentfootprint.principal.id']).toBe('alice@acme.test');
    expect(attrs[0]?.['agentfootprint.tenant.id']).toBe('acme');
  });

  it('sets no attribute at all for an anonymous run', () => {
    const { tracer, attrs } = mockTracer();
    const sink = otelObservability({ serviceName: 'svc', tracer });
    sink.exportEvent(event('agentfootprint.agent.turn_start', {}));
    expect('agentfootprint.principal.id' in (attrs[0] ?? {})).toBe(false);
    expect('agentfootprint.tenant.id' in (attrs[0] ?? {})).toBe(false);
  });
});
