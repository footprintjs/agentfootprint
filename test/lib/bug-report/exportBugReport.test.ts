/**
 * describeBugReport / exportBugReport — 7-pattern tests.
 *
 *   P1 Unit         — the bundle's files, the manifest's counts, the filename
 *   P2 Boundary     — a runner instead of a recording (the honest partial),
 *                     no events, no narrative, an unknown `include` id
 *   P3 Scenario     — a REAL mock agent run, recorded, exported, and read back
 *                     out of the zip
 *   P4 Property     — SELECTION: a unit that is out is out of every file, and
 *                     what was dropped is STATED, not silently absent
 *   P5 Security     — redacted keys listed BY NAME (never values); no machine
 *                     identity in environment.json
 *   P6 Performance  — the oversize warning names a real, droppable unit id
 *   P7 ROI          — the bundle's recording.json is the canon shape, so it
 *                     drops straight into the viewers with no adapter
 *
 * Mock provider only: no key, no network, deterministic.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { describeBugReport, exportBugReport, recordRun } from '../../../src/doors/observe.js';
import type { Recording } from '../../../src/doors/observe.js';

const FIXED = new Date(Date.UTC(2026, 7, 11, 9, 0, 0));

const FIELDS = {
  title: 'Agent answered with a stale price',
  stepsToReproduce: '1. ask for the price\n2. update it\n3. ask again',
  expected: 'the new price',
  actual: 'the old one',
};

const decoder = new TextDecoder();

/** The file bodies, by name, out of a report. */
function filesOf(report: {
  files: readonly { name: string; text: string }[];
}): Map<string, string> {
  return new Map(report.files.map((file) => [file.name, file.text]));
}

/** A hand-made recording — for the shapes a real run will not produce on demand. */
function fakeRecording(options: {
  runId?: string;
  sessionId?: string;
  turns?: number;
  state?: unknown;
  narrative?: readonly string[];
}): Recording {
  const meta = {
    wallClockMs: 0,
    runOffsetMs: 0,
    runtimeStageId: 'seed#0',
    subflowPath: [],
    compositionPath: [],
    runId: options.runId ?? 'run-1',
    ...(options.sessionId !== undefined && { sessionId: options.sessionId }),
  };
  const events: unknown[] = [];
  for (let turn = 0; turn < (options.turns ?? 1); turn++) {
    events.push(
      {
        type: 'agentfootprint.agent.turn_start',
        payload: { turnIndex: turn, userPrompt: `q${turn}` },
        meta,
      },
      {
        type: 'agentfootprint.stream.llm_end',
        payload: { iteration: 0, content: `a${turn}`, toolCallCount: 0, stopReason: 'stop' },
        meta,
      },
      {
        type: 'agentfootprint.agent.turn_end',
        payload: { turnIndex: turn, finalContent: `a${turn}` },
        meta,
      },
    );
  }
  return {
    snapshot: {
      runId: options.runId ?? 'run-1',
      commitLog: [],
      sharedState: options.state ?? {},
      ...(options.narrative && {
        recorders: [
          {
            id: 'narrative',
            name: 'narrative',
            data: options.narrative.map((text) => ({ text, depth: 0 })),
          },
        ],
      }),
    },
    events: events as Recording['events'],
    structure: { nodes: [], edges: [] },
  };
}

/** A recorded run of a real (mock-backed) agent. */
async function realRecording(sessionId?: string): Promise<Recording> {
  let call = 0;
  const provider = mock({
    respond: () => {
      call++;
      return call === 1
        ? {
            content: 'looking it up',
            toolCalls: [{ id: 't1', name: 'get_price', args: { sku: 'A-1' } }],
            stopReason: 'tool_use',
          }
        : { content: 'the price is 42', toolCalls: [], stopReason: 'stop' };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
    .system('You are a pricing assistant.')
    .tools([
      defineTool({
        name: 'get_price',
        description: 'current price for a sku',
        inputSchema: { type: 'object', properties: { sku: { type: 'string' } } },
        execute: async () => ({ price: 42 }),
      }),
    ])
    .build();

  const recorder = recordRun(agent);
  await agent.run({ message: 'what is the price of A-1?' }, sessionId ? { sessionId } : undefined);
  const recording = recorder.toRecording();
  recorder.stop();
  return recording;
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('exportBugReport — P1 unit', () => {
  it('P1 a single recording becomes manifest.json + recording.json + the derived files', () => {
    const report = exportBugReport(fakeRecording({ narrative: ['seed ran'] }), {
      ...FIELDS,
      now: FIXED,
    });
    expect(report.files.map((file) => file.name)).toEqual([
      'manifest.json',
      'recording.json',
      'conversation.json',
      'narrative.txt',
      'environment.json',
    ]);
    expect(report.files[0]!.name).toBe('manifest.json');
  });

  it('P1 the manifest counts what is in the bundle', () => {
    const report = exportBugReport(fakeRecording({ turns: 3 }), { ...FIELDS, now: FIXED });
    expect(report.manifest.counts).toMatchObject({ conversations: 1, runs: 1, turns: 3 });
    expect(report.manifest.counts.events).toBe(9);
    expect(report.manifest.totalBytes).toBe(
      report.manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    );
  });

  it('P1 the filename is dated and slugged from the title', () => {
    const report = exportBugReport(fakeRecording({}), { ...FIELDS, now: FIXED });
    expect(report.filename).toBe('2026-08-11-agent-answered-with-a-stale-price.zip');
  });

  it('P1 the reporter’s prose rides both the manifest and environment.json', () => {
    const report = exportBugReport(fakeRecording({}), {
      ...FIELDS,
      appVersion: '4.2.0',
      now: FIXED,
    });
    expect(report.manifest.report).toMatchObject({
      title: FIELDS.title,
      expected: 'the new price',
    });
    const environment = JSON.parse(filesOf(report).get('environment.json')!) as {
      appVersion?: string;
      report?: { actual?: string };
    };
    expect(environment.appVersion).toBe('4.2.0');
    expect(environment.report?.actual).toBe('the old one');
  });

  it('P1 several runs of ONE session are ONE conversation', () => {
    const manifest = describeBugReport([
      fakeRecording({ runId: 'r1', sessionId: 's-42' }),
      fakeRecording({ runId: 'r2', sessionId: 's-42' }),
      fakeRecording({ runId: 'r3' }),
    ]);
    const conversations = manifest.units.filter((unit) => unit.kind === 'conversation');
    expect(conversations).toHaveLength(2);
    expect(conversations[0]).toMatchObject({ id: 'conv-1', sessionId: 's-42', runCount: 2 });
    expect(conversations[1]).toMatchObject({ id: 'conv-2', runCount: 1 });
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('exportBugReport — P2 boundary', () => {
  it('P2 a RUNNER exports state + chart and SAYS the timeline is missing', async () => {
    const agent = Agent.create({
      provider: mock({ respond: () => ({ content: 'hi', toolCalls: [], stopReason: 'stop' }) }),
      model: 'mock',
    }).build();
    await agent.run({ message: 'hello' });

    const manifest = describeBugReport(agent);
    expect(manifest.notes.join(' ')).toMatch(/NO event timeline.*recordRun\(agent\) before run/s);
    expect(manifest.counts.events).toBe(0);
    // …and it is still a usable bundle: the snapshot and the chart are there.
    const report = exportBugReport(agent, { ...FIELDS, now: FIXED });
    const recording = JSON.parse(filesOf(report).get('recording.json')!) as Recording;
    expect(recording.snapshot).toBeDefined();
    expect(recording.structure).toBeDefined();
  });

  it('P2 a runner that has not run is refused, naming the fix', () => {
    const agent = Agent.create({
      provider: mock({ respond: () => ({ content: 'x', toolCalls: [], stopReason: 'stop' }) }),
      model: 'mock',
    }).build();
    expect(() => describeBugReport(agent)).toThrow(/has not run yet/);
  });

  it('P2 no narrative recorder → no narrative.txt, and a note explains it', () => {
    const manifest = describeBugReport(fakeRecording({}));
    expect(manifest.units.map((unit) => unit.id)).not.toContain('file-narrative');
    expect(manifest.notes.join(' ')).toMatch(/No narrative.txt.*narrative\(\)/s);
  });

  it('P2 no conversational events → no conversation.json, and a note explains it', () => {
    const bare: Recording = { snapshot: { commitLog: [] }, events: [], structure: {} };
    const manifest = describeBugReport(bare);
    expect(manifest.units.map((unit) => unit.id)).not.toContain('file-conversation');
    expect(manifest.notes.join(' ')).toMatch(/no turn, LLM or tool activity/);
  });

  it('P2 an unknown `include` id is refused, listing the real ones', () => {
    expect(() =>
      exportBugReport(fakeRecording({}), { ...FIELDS, include: ['conv-9'], now: FIXED }),
    ).toThrow(/'conv-9'.*Available: conv-1/s);
  });

  it('P2 a selection with no conversation is refused — that is the report this replaces', () => {
    expect(() =>
      exportBugReport(fakeRecording({}), {
        ...FIELDS,
        include: ['file-environment'],
        now: FIXED,
      }),
    ).toThrow(/includes no conversation.*Include at least one of: conv-1/s);
  });

  it('P2 a missing title is refused', () => {
    expect(() => exportBugReport(fakeRecording({}), { ...FIELDS, title: '  ' })).toThrow(
      /`title` is required/,
    );
  });
});

// ─── P3 Scenario — a real mock run ───────────────────────────────────

describe('exportBugReport — P3 scenario', () => {
  it('P3 records a real agent turn and bundles it, transcript included', async () => {
    const recording = await realRecording('s-live');
    const report = exportBugReport(recording, { ...FIELDS, now: FIXED });
    const files = filesOf(report);

    const transcript = JSON.parse(files.get('conversation.json')!) as {
      conversations: {
        id: string;
        sessionId?: string;
        turns: {
          user?: string;
          steps: { kind: string; name?: string; content?: string }[];
          final?: string;
        }[];
      }[];
    };
    const turn = transcript.conversations[0]!.turns[0]!;
    expect(transcript.conversations[0]!.sessionId).toBe('s-live');
    expect(turn.user).toBe('what is the price of A-1?');
    expect(turn.final).toBe('the price is 42');
    expect(turn.steps.filter((step) => step.kind === 'tool')[0]!.name).toBe('get_price');
    expect(turn.steps.filter((step) => step.kind === 'assistant')).toHaveLength(2);
  });

  it('P3 the zip contains exactly the files the manifest lists', async () => {
    const report = exportBugReport(await realRecording(), { ...FIELDS, now: FIXED });
    // Read the names back out of the central directory rather than trusting `files`.
    const namesInZip = centralDirectoryNames(report.zip);
    expect(namesInZip).toEqual(report.manifest.files.map((file) => file.name));
    expect(namesInZip).toContain('manifest.json');
  });

  it('P3 the manifest inside the zip is the manifest that was returned', async () => {
    const report = exportBugReport(await realRecording(), { ...FIELDS, now: FIXED });
    expect(JSON.parse(filesOf(report).get('manifest.json')!)).toEqual(
      JSON.parse(JSON.stringify(report.manifest)),
    );
  });
});

/** Walk the central directory for the entry names — a reader's view of the zip. */
function centralDirectoryNames(archive: Uint8Array): string[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let at = archive.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(at + 28, true);
    names.push(decoder.decode(archive.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return names;
}

// ─── P4 Property — selection ─────────────────────────────────────────

describe('exportBugReport — P4 property (selection)', () => {
  const three = () => [
    fakeRecording({ runId: 'r1', turns: 1 }),
    fakeRecording({ runId: 'r2', turns: 2 }),
    fakeRecording({ runId: 'r3', turns: 3 }),
  ];

  it('P4 a unit that is out is out of EVERY file', () => {
    const report = exportBugReport(three(), {
      ...FIELDS,
      include: ['conv-1', 'conv-3', 'file-conversation', 'file-environment'],
      now: FIXED,
    });
    const names = report.files.map((file) => file.name);
    expect(names).toContain('conversations/conv-1.json');
    expect(names).toContain('conversations/conv-3.json');
    expect(names).not.toContain('conversations/conv-2.json');

    const transcript = JSON.parse(filesOf(report).get('conversation.json')!) as {
      conversations: { id: string }[];
    };
    expect(transcript.conversations.map((conversation) => conversation.id)).toEqual([
      'conv-1',
      'conv-3',
    ]);
  });

  it('P4 what was left out is STATED by count, never a silent absence', () => {
    const report = exportBugReport(three(), {
      ...FIELDS,
      include: ['conv-1', 'file-environment'],
      now: FIXED,
    });
    expect(report.manifest.excluded).toMatchObject({ conversations: 2, files: 1 });
    expect(report.manifest.excluded.turns).toBe(5); // 2 + 3
    expect(report.manifest.excluded.events).toBe(15); // 6 + 9
    expect(report.manifest.excluded.unitIds).toContain('conv-2');
    expect(report.manifest.warnings.join(' ')).toMatch(
      /deliberately excluded 2 of 3 conversations.*SUBSET/s,
    );
  });

  it('P4 the offer is unchanged by the selection — every unit stays listed', () => {
    const report = exportBugReport(three(), { ...FIELDS, include: ['conv-2'], now: FIXED });
    expect(report.manifest.units.map((unit) => unit.id)).toContain('conv-1');
    expect(report.manifest.selected).toEqual(['conv-2']);
  });

  it('P4 no `include` = everything, and nothing is reported as excluded', () => {
    const report = exportBugReport(three(), { ...FIELDS, now: FIXED });
    expect(report.manifest.excluded).toMatchObject({ conversations: 0, files: 0, unitIds: [] });
    expect(report.manifest.warnings.join(' ')).not.toMatch(/deliberately excluded/);
  });

  it('P4 describeBugReport offers every unit with its own size and counts', () => {
    const manifest = describeBugReport(three());
    const conv2 = manifest.units.find((unit) => unit.id === 'conv-2')!;
    expect(conv2).toMatchObject({ kind: 'conversation', turnCount: 2, eventCount: 6 });
    expect(conv2.bytes).toBeGreaterThan(0);
    expect(conv2.label).toContain('2 turns');
    expect(manifest.selected).toEqual(manifest.units.map((unit) => unit.id));
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('exportBugReport — P5 security', () => {
  it('P5 redacted keys are listed BY NAME, and no value goes with them', () => {
    const recording = fakeRecording({
      state: {
        apiKey: '[REDACTED]',
        customer: { ssn: '[REDACTED]', name: 'Ada' },
        price: 42,
      },
    });
    const manifest = describeBugReport(recording);
    expect(manifest.redactedKeys).toEqual(['apiKey', 'ssn']);
    // The list is names. Nothing in it is a value, and the values were never here.
    expect(JSON.stringify(manifest.redactedKeys)).not.toContain('Ada');
  });

  it('P5 an empty list is explained rather than left to look like "nothing secret"', () => {
    const manifest = describeBugReport(fakeRecording({ state: { price: 42 } }));
    expect(manifest.redactedKeys).toEqual([]);
    expect(manifest.notes.join(' ')).toMatch(
      /no RedactionPolicy.*Everything in this bundle is the real value/s,
    );
  });

  it('P5 environment.json carries versions and NO machine identity', () => {
    const report = exportBugReport(fakeRecording({}), { ...FIELDS, now: FIXED });
    const environment = JSON.parse(filesOf(report).get('environment.json')!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(environment).sort()).toEqual([
      'agentfootprint',
      'arch',
      'footprintjs',
      'node',
      'platform',
      'report',
    ]);
    const text = filesOf(report).get('environment.json')!;
    for (const leak of [
      process.cwd(),
      String(process.env.USER ?? '__no_user__'),
      String(process.env.HOME ?? '__no_home__'),
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('P5 nothing in the bundle is scrubbed here — redaction happened upstream', () => {
    // A value that a policy did NOT cover stays exactly as the run recorded it:
    // a second, later policy would only disagree with the first.
    const report = exportBugReport(fakeRecording({ state: { note: 'plain text' } }), {
      ...FIELDS,
      now: FIXED,
    });
    expect(filesOf(report).get('recording.json')).toContain('plain text');
  });
});

// ─── P6 Performance / size ───────────────────────────────────────────

describe('exportBugReport — P6 performance', () => {
  const heavy = (runId: string, padding: number): Recording =>
    fakeRecording({ runId, state: { blob: 'x'.repeat(padding) } });

  it('P6 over the ceiling: a loud warning plus hints that name real unit ids', () => {
    const manifest = describeBugReport(
      [heavy('r1', 2000), heavy('r2', 60_000), heavy('r3', 5000)],
      { warnOverBytes: 50_000 },
    );
    expect(manifest.oversize).toBeDefined();
    expect(manifest.warnings.join(' ')).toMatch(/over the 48.8 KB ceiling/);
    const hints = manifest.oversize!.trimHints.join(' ');
    expect(hints).toMatch(/Drop conv-2/);
    // Every hint names a unit that actually exists and can actually be dropped.
    for (const id of hints.match(/conv-\d+/g) ?? []) {
      expect(manifest.units.map((unit) => unit.id)).toContain(id);
    }
  });

  it('P6 the hints never propose dropping the last conversation', () => {
    const manifest = describeBugReport([heavy('r1', 80_000), heavy('r2', 80_000)], {
      warnOverBytes: 1000,
    });
    const dropped = (manifest.oversize!.trimHints.join(' ').match(/conv-\d+/g) ?? []).length;
    expect(dropped).toBeLessThan(2);
  });

  it('P6 under the ceiling there is no oversize verdict at all', () => {
    const manifest = describeBugReport(fakeRecording({}));
    expect(manifest.oversize).toBeUndefined();
    expect(manifest.warnings).toEqual([]);
  });

  it('P6 the zip is the sum of its files plus header overhead (stored, not compressed)', () => {
    const report = exportBugReport(fakeRecording({}), { ...FIELDS, now: FIXED });
    const payload = report.files.reduce((sum, file) => sum + file.bytes.length, 0);
    expect(report.zip.length).toBeGreaterThan(payload);
    expect(report.zip.length).toBeLessThan(payload + 1000);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('exportBugReport — P7 ROI', () => {
  it('P7 recording.json is the CANON shape — no unwrapping in the viewer', async () => {
    const report = exportBugReport(await realRecording(), { ...FIELDS, now: FIXED });
    const parsed = JSON.parse(filesOf(report).get('recording.json')!) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['events', 'snapshot', 'structure']);
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  it('P7 many conversations become one file each, keyed by the unit id', () => {
    const report = exportBugReport(
      [fakeRecording({ runId: 'r1' }), fakeRecording({ runId: 'r2' })],
      { ...FIELDS, now: FIXED },
    );
    const names = report.files.map((file) => file.name);
    expect(names).toContain('conversations/conv-1.json');
    expect(names).toContain('conversations/conv-2.json');
    expect(names).not.toContain('recording.json');
  });

  it('P7 describe then export is the whole consent flow, in two calls', () => {
    const input = [fakeRecording({ runId: 'r1' }), fakeRecording({ runId: 'r2' })];
    const offer = describeBugReport(input);
    const consented = offer.units.filter((unit) => unit.id !== 'conv-2').map((unit) => unit.id);
    const report = exportBugReport(input, { ...FIELDS, include: consented, now: FIXED });
    expect(report.manifest.selected).toEqual(consented);
    expect(report.zip.length).toBeGreaterThan(0);
  });
});
