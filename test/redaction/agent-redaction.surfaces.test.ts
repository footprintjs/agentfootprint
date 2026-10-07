/**
 * `Agent.create({ redact })` — every surface that RETAINS or SERVES a run.
 *
 * ONE run of the fixture agent (`./fixture.ts`) under the content-free policy:
 * the conversation's own names plus the tool's fields. Every surface the
 * library hands a run out through is attached BEFORE the run, then each is
 * grepped for the four secrets — the person's message, a tool argument, a tool
 * result, the model's answer. A secret found anywhere is a leak; the one named
 * limit (the answer leaving the chart as a bare string, `run.exit`'s boundary
 * payload — README "Named limits") is taken out first and pinned on its own.
 *
 * The SERVED form is the claim. Whether the agent still RAN on real values is
 * `agent-redaction.live.test.ts`; the policy's reach into composed and nested
 * runs is `agent-redaction.propagation.test.ts`.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { CombinedRecorder, RuntimeSnapshot } from 'footprintjs';

import type { AgentfootprintEvent } from '../../src/events/registry.js';
import {
  auditExport,
  callTraceTool,
  consoleObservability,
  describeBugReport,
  exportBugReport,
  fileObservability,
  otelObservability,
  packRecording,
  recordRun,
  traceToolpack,
  unpackRecording,
  type OtelAttributeValue,
  type OtelSpanLike,
  type OtelTracerLike,
} from '../../src/doors/observe.js';
import { explainRecording } from '../../src/hosting/answerAccounts.js';
import {
  ALL_SECRETS,
  MESSAGE,
  SECRET,
  conversationPolicy,
  fixtureAgent,
  leaksIn,
  locationsOf,
  withoutAnswerBoundary,
} from './fixture.js';

// ─── The one run, with every surface attached ────────────────────────

interface Span {
  readonly name: string;
  readonly attributes: Record<string, OtelAttributeValue>;
  readonly events: { name: string; attributes: Record<string, OtelAttributeValue> }[];
}

function tracerOf(spans: Span[]): OtelTracerLike {
  return {
    startSpan(name, options) {
      const span: Span = { name, attributes: { ...(options?.attributes ?? {}) }, events: [] };
      spans.push(span);
      const like: OtelSpanLike = {
        setAttribute: (key, value) => {
          span.attributes[key] = value;
          return undefined;
        },
        setStatus: () => undefined,
        end: () => undefined,
        spanContext: () => ({ traceId: 't', spanId: `s${spans.indexOf(span)}`, traceFlags: 1 }),
        addEvent: (eventName, attributes) => {
          span.events.push({ name: eventName, attributes: { ...(attributes ?? {}) } });
          return undefined;
        },
      };
      return like;
    },
  };
}

async function runEverySurface() {
  const agent = fixtureAgent({ redact: conversationPolicy() });

  const events: AgentfootprintEvent[] = [];
  agent.on('*', (event) => events.push(event));

  // A consumer's own recorder on the executor — every footprintjs channel.
  const attached: { hook: string; event: unknown }[] = [];
  const hook = (name: string) => (event: unknown) => attached.push({ hook: name, event });
  const consumerRecorder: CombinedRecorder = {
    id: 'consumer-recorder',
    onEmit: hook('onEmit'),
    onWrite: hook('onWrite'),
    onRead: hook('onRead'),
    onCommit: hook('onCommit'),
    onRunStart: hook('onRunStart'),
    onRunEnd: hook('onRunEnd'),
    onSubflowEntry: hook('onSubflowEntry'),
    onSubflowExit: hook('onSubflowExit'),
    onDecision: hook('onDecision'),
  } as unknown as CombinedRecorder;
  agent.attach(consumerRecorder);

  const recorder = recordRun(agent);
  const local = agent.enable.localObservability({ includeSnapshot: true });
  const flowchart = agent.enable.flowchart();

  const consoleLines: string[] = [];
  agent.enable.observability({
    strategy: consoleObservability({
      logger: { log: (line: unknown) => consoleLines.push(String(line)) },
    }),
  });
  const dir = mkdtempSync(join(tmpdir(), 'af-redaction-'));
  const filePath = join(dir, 'events.ndjson');
  const file = agent.enable.observability({
    strategy: fileObservability({ path: filePath, flushIntervalMs: 0 }),
  });
  const audit = auditExport({ payloadMode: 'verbatim' });
  agent.enable.observability({ strategy: audit });
  const spans: Span[] = [];
  agent.enable.observability({
    strategy: otelObservability({
      serviceName: 'redaction-suite',
      tracer: tracerOf(spans),
      captureContent: true,
      captureToolContent: true,
    }),
  });

  const answer = await agent.run({ message: MESSAGE });
  await file.flush();

  const recording = recorder.toRecording();
  return {
    agent,
    answer,
    events,
    attached,
    recording,
    trace: local.getTrace(),
    stepGraph: flowchart.getSnapshot(),
    consoleLines,
    fileText: readFileSync(filePath, 'utf8'),
    auditBundle: audit.bundle(),
    spans,
  };
}

const run = await runEverySurface();

// ─── The surfaces ────────────────────────────────────────────────────

describe('agent redaction — the run itself', () => {
  it('the caller still gets the real answer (the run() return is the caller’s own value)', () => {
    expect(String(run.answer)).toContain(SECRET.answer);
  });
});

describe('agent redaction — snapshot and narrative', () => {
  it('getLastSnapshot() is the redacted view: no secret, placeholders, no fold base', () => {
    const snapshot = run.agent.getLastSnapshot() as RuntimeSnapshot;
    expect(leaksIn(snapshot)).toEqual([]);
    expect(JSON.stringify(snapshot.commitLog)).toContain('REDACTED');
    expect((snapshot.sharedState as Record<string, unknown>)['history']).toBe('REDACTED');
    // footprintjs omits the raw pre-run base from the served view.
    expect(snapshot.initialState).toBeUndefined();
  });

  it('getSnapshot() is the same served view', () => {
    expect(leaksIn(run.agent.getSnapshot())).toEqual([]);
  });

  it('getLastNarrativeEntries() — text and every entry field', () => {
    const entries = run.agent.getLastNarrativeEntries();
    expect(entries.length).toBeGreaterThan(0);
    expect(leaksIn(entries)).toEqual([]);
  });
});

describe('agent redaction — events', () => {
  it('agent.on("*") — every typed event is served', () => {
    expect(run.events.length).toBeGreaterThan(5);
    expect(leaksIn(run.events)).toEqual([]);
    // Served, not dropped: the tool call is still on the record, its argument masked.
    const toolStart = run.events.find((e) => e.type === 'agentfootprint.stream.tool_start');
    expect(toolStart?.payload).toMatchObject({ toolName: 'lookup', args: '[REDACTED]' });
  });

  it('a recorder attached to the executor sees the same served payloads on every channel', () => {
    expect(run.attached.length).toBeGreaterThan(5);
    // `onRunEnd` carries the chart's return — the answer as a bare string, the
    // named limit — so it is checked on its own below.
    const records = run.attached.filter((a) => a.hook !== 'onRunEnd');
    expect(leaksIn(records)).toEqual([]);
    const runEnd = run.attached.filter((a) => a.hook === 'onRunEnd');
    expect(leaksIn(runEnd, [SECRET.user, SECRET.ssn, SECRET.email])).toEqual([]);
  });
});

describe('agent redaction — recordings', () => {
  it('recordRun → toRecording(): snapshot, events and recorder rows', () => {
    expect(leaksIn(run.recording)).toEqual([]);
    expect(JSON.stringify(run.recording)).toContain('REDACTED');
  });

  it('packed and unpacked again — the same served bytes', () => {
    const packed = packRecording(run.recording);
    expect(leaksIn(packed)).toEqual([]);
    expect(leaksIn(unpackRecording(packed))).toEqual([]);
  });

  it('THE NAMED LIMIT, pinned: the answer is only in the run.exit boundary payload', () => {
    // The chart returns the answer as a bare string — a value with no name,
    // which footprintjs serves as it is (README "Named limits"). It is the ONE
    // place the answer survives, and it survives nowhere else.
    const where = locationsOf(run.recording, SECRET.answer);
    expect(where.length).toBeGreaterThan(0);
    expect(locationsOf(withoutAnswerBoundary(run.recording), SECRET.answer)).toEqual([]);
  });
});

describe('agent redaction — local observability', () => {
  it('getTrace() with the snapshot is clean and labels itself "policy"', () => {
    expect(leaksIn(run.trace)).toEqual([]);
    expect(run.trace.redaction).toBe('policy');
  });

  it('enable.flowchart() — the step graph rebuilt from served events', () => {
    expect(leaksIn(run.stepGraph)).toEqual([]);
  });
});

describe('agent redaction — observability strategies', () => {
  it('console', () => {
    expect(run.consoleLines.length).toBeGreaterThan(0);
    expect(leaksIn(run.consoleLines)).toEqual([]);
  });

  it('file (NDJSON on disk)', () => {
    expect(run.fileText.length).toBeGreaterThan(0);
    expect(
      leaksIn(
        run.fileText
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l)),
      ),
    ).toEqual([]);
  });

  it('audit (verbatim payloads, hash-chained)', () => {
    expect(run.auditBundle.records.length).toBeGreaterThan(0);
    expect(leaksIn(run.auditBundle)).toEqual([]);
  });

  it('otel (content capture ON)', () => {
    expect(run.spans.length).toBeGreaterThan(0);
    expect(leaksIn(run.spans)).toEqual([]);
  });
});

describe('agent redaction — reports and accounts', () => {
  it('a bug report built from the recording: every file in the zip', () => {
    const manifest = describeBugReport(run.recording);
    const report = exportBugReport(run.recording, { title: 'redaction suite' });
    const text = new TextDecoder().decode(report.zip);
    for (const secret of ALL_SECRETS) {
      if (secret === SECRET.answer) continue; // the named limit rides the recording file
      expect(text).not.toContain(secret);
    }
    expect(leaksIn(report.files.map((f) => f.name))).toEqual([]);
    // The manifest names what was kept out, by name.
    expect(manifest.redactedKeys).toEqual(expect.arrayContaining(['history']));
  });

  it('a bug report built straight from the runner (snapshot arm)', () => {
    const report = exportBugReport(run.agent, { title: 'redaction suite, runner arm' });
    const files = report.files.map((f) =>
      f.name.endsWith('.json') ? (JSON.parse(f.text) as unknown) : f.text,
    );
    // The snapshot's recorder rows carry the run.exit boundary (the named
    // limit, removed by `leaksIn`); nothing else may carry any secret.
    expect(leaksIn(files)).toEqual([]);
  });

  it('the answer account the hosting op serves ({ account, shown })', () => {
    const body = explainRecording({ data: JSON.stringify(run.recording) }, {});
    expect(body).not.toBeNull();
    expect(leaksIn(body)).toEqual([]);
  });
});

describe('agent redaction — the trace toolpack (a past run served to a model)', () => {
  it('every passive view and the explicit fetch serve no secret', async () => {
    const tools = traceToolpack({
      snapshot: run.agent.getLastSnapshot() as RuntimeSnapshot,
      narrative: run.agent.getLastNarrativeEntries().map((e) => e.text ?? ''),
    });
    const views = await Promise.all([
      callTraceTool(tools, 'run_overview'),
      callTraceTool(tools, 'read_narrative', { maxLines: 500 }),
      callTraceTool(tools, 'who_wrote', { key: 'history' }),
      callTraceTool(tools, 'find_in_trace', { query: 'SECRET', maxHits: 50 }),
      callTraceTool(tools, 'find_in_trace', { query: 'lookup', maxHits: 50 }),
    ]);
    for (const view of views) {
      for (const secret of ALL_SECRETS) expect(view).not.toContain(secret);
    }
  });
});

describe('agent redaction — with no door, nothing changes', () => {
  it('the same run without `redact` keeps every value (byte-identical served path)', async () => {
    const plain = fixtureAgent();
    const recorder = recordRun(plain);
    await plain.run({ message: MESSAGE });
    const recording = recorder.toRecording();
    for (const secret of ALL_SECRETS) expect(JSON.stringify(recording)).toContain(secret);
    expect(JSON.stringify(recording)).not.toContain('REDACTED');
    // The fold base travels when there is no policy.
    expect((plain.getLastSnapshot() as RuntimeSnapshot).initialState).toBeDefined();
  });
});
