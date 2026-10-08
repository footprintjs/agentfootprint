/**
 * Every surface an agent's run is retained or served through, attached to one
 * agent BEFORE its run — the harness of the redaction suite's surface checks
 * (`agent-redaction.surfaces.test.ts`, `agent-redaction.tool-boundary.test.ts`).
 *
 * `everySurface` runs the agent once and hands back each surface as it was
 * filled; `servedArtifacts` lists every artifact a caller could keep or pass
 * on — the surfaces plus what is BUILT from them (a packed recording, a bug
 * report, the answer account the hosting op serves, the trace toolpack's
 * views) — so a test can assert a value is in none of them.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CombinedRecorder } from 'footprintjs';

import type { AgentfootprintEvent } from '../../src/events/registry.js';
import {
  auditExport,
  callTraceTool,
  consoleObservability,
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
import type { Agent } from '../../src/index.js';

/** One span as the fake tracer kept it. */
export interface Span {
  readonly name: string;
  readonly attributes: Record<string, OtelAttributeValue>;
  readonly events: { name: string; attributes: Record<string, OtelAttributeValue> }[];
}

/** An OpenTelemetry tracer that keeps every span it is handed. */
export function tracerOf(spans: Span[]): OtelTracerLike {
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

/** Attach every surface to `agent`, run it once with `message`, and hand each back. */
export async function everySurface(agent: Agent, message: string) {
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

  const answer = await agent.run({ message });
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

/** What `everySurface` hands back. */
export type Surfaced = Awaited<ReturnType<typeof everySurface>>;

/**
 * Every artifact of the run a caller could keep or pass on, by name: the
 * surfaces themselves and what the library builds from them.
 */
export async function servedArtifacts(r: Surfaced): Promise<Record<string, unknown>> {
  const tools = traceToolpack({
    snapshot: r.agent.getLastSnapshot() as never,
    narrative: r.agent.getLastNarrativeEntries().map((e) => e.text ?? ''),
  });
  const toolpackViews = await Promise.all([
    callTraceTool(tools, 'run_overview'),
    callTraceTool(tools, 'read_narrative', { maxLines: 500 }),
    callTraceTool(tools, 'who_wrote', { key: 'history' }),
    callTraceTool(tools, 'find_in_trace', { query: 'SECRET', maxHits: 50 }),
  ]);
  const packed = packRecording(r.recording);
  return {
    snapshot: r.agent.getLastSnapshot(),
    narrative: r.agent.getLastNarrativeEntries(),
    events: r.events,
    attachedRecorder: r.attached,
    recording: r.recording,
    packedRecording: packed,
    unpackedRecording: unpackRecording(packed),
    trace: r.trace,
    stepGraph: r.stepGraph,
    console: r.consoleLines,
    file: r.fileText,
    audit: r.auditBundle,
    otel: r.spans,
    bugReportZip: new TextDecoder().decode(
      exportBugReport(r.recording, { title: 'redaction suite' }).zip,
    ),
    bugReportFromRunner: exportBugReport(r.agent, { title: 'redaction suite' }).files.map(
      (f) => f.text,
    ),
    answerAccount: explainRecording({ data: JSON.stringify(r.recording) }, {}),
    traceToolpack: toolpackViews,
  };
}
