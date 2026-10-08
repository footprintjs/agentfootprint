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
 * Every surface has its CONTROL: the same run with no policy, through the same
 * surface, must carry the secrets — so a surface that never shows content
 * cannot pass by being empty. And with no policy, every served surface is the
 * run's real one, byte for byte (the last section).
 *
 * The SERVED form is the claim. Whether the agent still RAN on real values is
 * `agent-redaction.live.test.ts`; the policy's reach into composed and nested
 * runs is `agent-redaction.propagation.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy, RuntimeSnapshot } from 'footprintjs';

import type { AgentfootprintEvent } from '../../src/events/registry.js';
import {
  callTraceTool,
  describeBugReport,
  exportBugReport,
  packRecording,
  recordRun,
  traceToolpack,
  unpackRecording,
} from '../../src/doors/observe.js';
import { explainRecording } from '../../src/hosting/answerAccounts.js';
import { runnerLive } from '../../src/core/runnerLive.js';
import { REDACTION_MARKER_ID } from '../../src/redaction/marker.js';
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
import { everySurface, type Surfaced } from './everySurface.js';

// ─── The one run, with every surface attached (`./everySurface.ts`) ──

const runEverySurface = (redact: RedactionPolicy | undefined) =>
  everySurface(fixtureAgent(redact !== undefined ? { redact } : {}), MESSAGE);

const run = await runEverySurface(conversationPolicy());
/** The same run, every surface attached, with no policy. */
const control = await runEverySurface(undefined);

/**
 * The surface `pick` reads: the control run's must carry a secret (so the
 * surface really shows content), the served run's must carry none.
 */
function expectServed(pick: (r: Surfaced) => unknown, secrets?: readonly string[]): void {
  expect(leaksIn(pick(control), secrets).length).toBeGreaterThan(0);
  expect(leaksIn(pick(run), secrets)).toEqual([]);
}

// ─── The surfaces ────────────────────────────────────────────────────

describe('agent redaction — the run itself', () => {
  it('the caller still gets the real answer (the run() return is the caller’s own value)', () => {
    expect(String(run.answer)).toContain(SECRET.answer);
  });
});

describe('agent redaction — snapshot and narrative', () => {
  it('getLastSnapshot() is the redacted view: no secret, placeholders, no fold base', () => {
    expectServed((r) => r.agent.getLastSnapshot());
    const snapshot = run.agent.getLastSnapshot() as RuntimeSnapshot;
    expect(JSON.stringify(snapshot.commitLog)).toContain('REDACTED');
    expect((snapshot.sharedState as Record<string, unknown>)['history']).toBe('REDACTED');
    // footprintjs omits the raw pre-run base from the served view.
    expect(snapshot.initialState).toBeUndefined();
  });

  it('getSnapshot() is the same served view', () => {
    expectServed((r) => r.agent.getSnapshot());
  });

  it('getLastNarrativeEntries() — text and every entry field', () => {
    expect(run.agent.getLastNarrativeEntries().length).toBeGreaterThan(0);
    expectServed((r) => r.agent.getLastNarrativeEntries());
  });
});

describe('agent redaction — events', () => {
  it('agent.on("*") — every typed event is served', () => {
    expect(run.events.length).toBeGreaterThan(5);
    expectServed((r) => r.events);
    // Served, not dropped: the tool call is still on the record, its argument
    // masked — and its name too, which is no library word.
    const toolStart = run.events.find((e) => e.type === 'agentfootprint.stream.tool_start');
    expect(toolStart?.payload).toMatchObject({ toolName: '[REDACTED]', args: '[REDACTED]' });
    // The same events, in the same order, with and without the policy.
    expect(run.events.map((e) => e.type)).toEqual(control.events.map((e) => e.type));
  });

  it('a recorder attached to the executor sees the same served payloads on every channel', () => {
    expect(run.attached.length).toBeGreaterThan(5);
    // `onRunEnd` carries the chart's return — the answer as a bare string, the
    // named limit — so it is checked on its own below.
    expectServed((r) => r.attached.filter((a) => a.hook !== 'onRunEnd'));
    // `onRunEnd` holds the answer and nothing else of the conversation, with
    // or without the policy: the named limit, and only it.
    const runEnd = (r: Surfaced) => r.attached.filter((a) => a.hook === 'onRunEnd');
    expect(locationsOf(runEnd(control), SECRET.answer).length).toBeGreaterThan(0);
    expect(leaksIn(runEnd(run), [SECRET.user, SECRET.ssn, SECRET.email])).toEqual([]);
  });
});

describe('agent redaction — recordings', () => {
  it('recordRun → toRecording(): snapshot, events and recorder rows', () => {
    expectServed((r) => r.recording);
    expect(JSON.stringify(run.recording)).toContain('REDACTED');
  });

  it('packed and unpacked again — the same served bytes', () => {
    expectServed((r) => packRecording(r.recording));
    expectServed((r) => unpackRecording(packRecording(r.recording)));
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
    expectServed((r) => r.trace);
    expect(run.trace.redaction).toBe('policy');
  });

  it('enable.flowchart() — the step graph rebuilt from served events', () => {
    expectServed((r) => r.stepGraph);
  });
});

describe('agent redaction — observability strategies', () => {
  it('console', () => {
    expect(run.consoleLines.length).toBeGreaterThan(0);
    expectServed((r) => r.consoleLines);
  });

  it('file (NDJSON on disk)', () => {
    expect(run.fileText.length).toBeGreaterThan(0);
    expectServed((r) =>
      r.fileText
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as unknown),
    );
  });

  it('audit (verbatim payloads, hash-chained)', () => {
    expect(run.auditBundle.records.length).toBeGreaterThan(0);
    expectServed((r) => r.auditBundle);
  });

  it('otel (content capture ON)', () => {
    expect(run.spans.length).toBeGreaterThan(0);
    expectServed((r) => r.spans);
  });
});

describe('agent redaction — reports and accounts', () => {
  it('a bug report built from the recording: every file in the zip', () => {
    // The named limit rides the recording file inside the zip, so the answer
    // is left out of this check (the zip is compared as text).
    const zipText = (r: Surfaced): string =>
      new TextDecoder().decode(exportBugReport(r.recording, { title: 'redaction suite' }).zip);
    const others = ALL_SECRETS.filter((secret) => secret !== SECRET.answer);
    expect(others.some((secret) => zipText(control).includes(secret))).toBe(true);
    for (const secret of others) expect(zipText(run)).not.toContain(secret);
    const report = exportBugReport(run.recording, { title: 'redaction suite' });
    expect(leaksIn(report.files.map((f) => f.name))).toEqual([]);
    // The manifest names what was kept out, by name.
    expect(describeBugReport(run.recording).redactedKeys).toEqual(
      expect.arrayContaining(['history']),
    );
  });

  it('a bug report built straight from the runner (snapshot arm)', () => {
    // The snapshot's recorder rows carry the run.exit boundary (the named
    // limit, removed by `leaksIn`); nothing else may carry any secret.
    expectServed((r) =>
      exportBugReport(r.agent, { title: 'redaction suite, runner arm' }).files.map((f) =>
        f.name.endsWith('.json') ? (JSON.parse(f.text) as unknown) : f.text,
      ),
    );
  });

  it('the answer account the hosting op serves ({ account, shown })', () => {
    expect(explainRecording({ data: JSON.stringify(run.recording) }, {})).not.toBeNull();
    expectServed((r) => explainRecording({ data: JSON.stringify(r.recording) }, {}));
  });
});

describe('agent redaction — the trace toolpack (a past run served to a model)', () => {
  it('every passive view and the explicit fetch serve no secret', async () => {
    const viewsOf = async (r: Surfaced): Promise<string[]> => {
      const tools = traceToolpack({
        snapshot: r.agent.getLastSnapshot() as RuntimeSnapshot,
        narrative: r.agent.getLastNarrativeEntries().map((e) => e.text ?? ''),
      });
      return Promise.all([
        callTraceTool(tools, 'run_overview'),
        callTraceTool(tools, 'read_narrative', { maxLines: 500 }),
        callTraceTool(tools, 'who_wrote', { key: 'history' }),
        callTraceTool(tools, 'find_in_trace', { query: 'SECRET', maxHits: 50 }),
        callTraceTool(tools, 'find_in_trace', { query: 'lookup', maxHits: 50 }),
      ]);
    };
    const controlViews = (await viewsOf(control)).join('\n');
    expect(ALL_SECRETS.some((secret) => controlViews.includes(secret))).toBe(true);
    for (const view of await viewsOf(run)) {
      for (const secret of ALL_SECRETS) expect(view).not.toContain(secret);
    }
  });
});

describe('agent redaction — with no door, nothing changes', () => {
  it('every served surface IS the real run: the snapshot and the events', async () => {
    const plain = fixtureAgent();
    const live = runnerLive(plain)!;
    const real: unknown[] = [];
    const served: unknown[] = [];
    live.onRealEvent((event) => real.push(event));
    plain.on('*', (event) => served.push(event));
    await plain.run({ message: MESSAGE });
    // The served snapshot is footprintjs's own, byte for byte — no mirror, the
    // fold base present, no marker row.
    expect(JSON.stringify(plain.getLastSnapshot())).toBe(JSON.stringify(live.liveSnapshot()));
    expect((plain.getLastSnapshot() as RuntimeSnapshot).initialState).toBeDefined();
    expect(JSON.stringify(plain.getLastSnapshot())).not.toContain(REDACTION_MARKER_ID);
    // Every event reaches a consumer as its producer made it: the same types,
    // payloads and stage, in the same order (an emitted event's real twin is
    // built at its source, so its meta is the stage's, not the same object).
    const shape = (events: unknown[]) =>
      (events as AgentfootprintEvent[]).map((e) => ({
        type: e.type,
        payload: e.payload,
        runId: e.meta?.runId,
        runtimeStageId: e.meta?.runtimeStageId,
      }));
    expect(served.length).toBeGreaterThan(5);
    expect(shape(served)).toEqual(shape(real));
    // And every surface of the control run carries the values.
    for (const secret of ALL_SECRETS) expect(JSON.stringify(control.recording)).toContain(secret);
    expect(JSON.stringify(control.recording)).not.toContain('REDACTED');
  });
});
