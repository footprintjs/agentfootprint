/**
 * The three 9.50.0 recording-surface facts SURVIVE THE ENVELOPE — written to
 * disk by `persistRecording` + `fileRecordingSink`, re-read as bytes, parsed.
 *
 * These facts exist for OFFLINE consumers (the lens's SkillGraph debugger, a
 * triage platform reading archives), so the live event stream proving them is
 * not enough: the claim worth pinning is that a written-and-reread envelope
 * file still carries
 *
 *   1. `skill.graph_declared` — the author's nodes + edges as data,
 *   2. `context.evaluated.cursorMove.reachable` — the gate's set per move,
 *   3. `stream.llm_start.systemPromptText` — ONLY when the run opted in.
 *
 * The third is asserted BOTH ways (present when on, ABSENT from the archived
 * bytes by default) because the default is a privacy promise about what lands
 * on disk, not just about what fires in memory.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { persistRecording } from '../../../src/recorders/observability/recordingEnvelope.js';
import { fileRecordingSink } from '../../../src/recorders/observability/fileRecordingSink.js';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-recording-surface-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const routedGraph = () => {
  const a = defineSkill({ id: 'triage', description: 'first look', body: 'TRIAGE BODY' });
  const b = defineSkill({ id: 'billing', description: 'refunds', body: 'BILLING BODY' });
  return skillGraph().entry(a).route(a, b, { onToolReturn: 'probe' }).build();
};

type EventRow = { type: string; payload: Record<string, unknown> };

/** Run a skill-routed agent, persist the envelope, re-read the FILE. */
async function archivedEvents(opts?: { recordSystemPrompt?: boolean }): Promise<EventRow[]> {
  const agent = Agent.create({
    provider: mock({ reply: 'done' }),
    model: 'mock',
    ...(opts?.recordSystemPrompt !== undefined && {
      recordSystemPrompt: opts.recordSystemPrompt,
    }),
  })
    .system('You are support.')
    .skillGraph(routedGraph())
    .build();
  const rec = recordRun(agent);
  await agent.run({ message: 'hello' });

  const directory = tempDir();
  await persistRecording(rec, {
    sink: fileRecordingSink({ directory }),
    run: { complete: true },
  });
  rec.stop();

  const files = readdirSync(directory).filter((f) => f.endsWith('.json'));
  expect(files).toHaveLength(1);
  const envelope = JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as {
    recording: { events: EventRow[] };
  };
  return envelope.recording.events;
}

describe('the three 9.50.0 facts round-trip through a written+reread envelope', () => {
  it('1. skill.graph_declared — the declared map is in the archive, as data', async () => {
    const events = await archivedEvents();
    const declared = events.filter((e) => e.type === 'agentfootprint.skill.graph_declared');
    expect(declared).toHaveLength(1);
    const payload = declared[0]!.payload as {
      nodes: Array<{ id: string; kind: string; description?: string }>;
      edges: Array<{ from: string | null; to: string; kind: string }>;
    };
    expect(payload.nodes.map((n) => n.id).sort()).toEqual(['billing', 'triage']);
    expect(payload.nodes.find((n) => n.id === 'billing')?.description).toBe('refunds');
    expect(payload.edges).toContainEqual({ from: null, to: 'triage', kind: 'entry' });
    // The graph auto-captions an unlabeled route ("on probe") — the declared
    // map carries the author's edge verbatim, caption included.
    expect(payload.edges.find((e) => e.from === 'triage')).toMatchObject({
      from: 'triage',
      to: 'billing',
      kind: 'on-tool-return',
    });
  });

  it('2. cursorMove.reachable — the typed set is on the archived move', async () => {
    const events = await archivedEvents();
    const evaluated = events.filter((e) => e.type === 'agentfootprint.context.evaluated');
    expect(evaluated.length).toBeGreaterThan(0);
    const move = evaluated[0]!.payload.cursorMove as {
      to?: string;
      reachable?: readonly string[];
    };
    expect(move.to).toBe('triage');
    expect(move.reachable).toEqual(['billing']);
  });

  it('3a. systemPromptText — ON: the archived llm_start carries the assembled prompt verbatim', async () => {
    const events = await archivedEvents({ recordSystemPrompt: true });
    const starts = events.filter((e) => e.type === 'agentfootprint.stream.llm_start');
    expect(starts.length).toBeGreaterThan(0);
    const text = starts[0]!.payload.systemPromptText as string;
    expect(text).toContain('You are support.');
    expect(text).toContain('TRIAGE BODY');
    expect(starts[0]!.payload.systemPromptChars).toBe(text.length);
  });

  it('3b. systemPromptText — DEFAULT: the archived BYTES do not contain the key (the privacy promise is about the disk)', async () => {
    const events = await archivedEvents();
    const starts = events.filter((e) => e.type === 'agentfootprint.stream.llm_start');
    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) expect('systemPromptText' in s.payload).toBe(false);
    // Belt and braces: the string never made it into the archive AT ALL.
    expect(JSON.stringify(events)).not.toContain('systemPromptText');
  });
});
