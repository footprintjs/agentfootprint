/**
 * `ctx.progress` — a long-running tool says where it is, mid-call (9.52.0).
 *
 * The silence this closes is real and was reported from the field: a twelve-hop
 * graph walk is ONE tool call, so the record shows `stream.tool_start`, forty
 * seconds of nothing, then `stream.tool_end`. Nobody watching — a person, a UI,
 * an operator reading the archive afterwards — can tell working from hung.
 *
 * The claims pinned here:
 *
 *   1. N calls to `ctx.progress` file N `agentfootprint.stream.tool_progress`
 *      events, in call order, all BETWEEN this call's `tool_start` and its
 *      `tool_end` (a report that lands after the end is not progress).
 *   2. Identity is stamped by the FRAMEWORK — `toolCallId`, `toolName`,
 *      `iteration` — and matches the dispatch the tool actually ran under. The
 *      tool sends only its own payload, forwarded verbatim.
 *   3. Both delivery paths carry it with no wiring of their own: an attached
 *      `agent.on(...)` listener AND the real `toSSE` stream.
 *   4. Nothing listening is safe: no throw, and the tool's result is unchanged.
 *   5. A tool that never reports produces the SAME event stream as before this
 *      feature existed — zero `tool_progress` rows, nothing else shifted.
 *   6. It survives the recording envelope: written to disk by
 *      `persistRecording`, re-read as bytes, still there and still stamped.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool } from '../../../src/index.js';
import type { ToolExecutionContext } from '../../../src/core/tools.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { toSSE } from '../../../src/stream.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { persistRecording } from '../../../src/recorders/observability/recordingEnvelope.js';
import { fileRecordingSink } from '../../../src/recorders/observability/fileRecordingSink.js';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-tool-progress-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

type Row = { type: string; payload: Record<string, unknown> };

/** The external team's shape: one long walk that reports each hop. */
function walkTool(hops: number, seen?: ToolExecutionContext[]) {
  return defineTool({
    name: 'walk_graph',
    description: 'Walk the dependency graph',
    execute: (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
      seen?.push(ctx);
      for (let i = 1; i <= hops; i += 1) {
        ctx.progress({ done: i, total: hops, hop: `node-${String(i)}` });
      }
      return `walked ${String(hops)} hops`;
    },
  });
}

/** A tool that reports nothing at all — the "before this existed" baseline. */
const quietTool = defineTool({
  name: 'walk_graph',
  description: 'Walk the dependency graph',
  execute: () => 'walked 12 hops',
});

/** One scripted turn: call the tool once, then answer. */
const oneToolCall = () =>
  mock({
    replies: [
      { toolCalls: [{ id: 'tc-walk', name: 'walk_graph', args: { root: 'app' } }] },
      { content: 'done' },
    ],
  });

function agentWith(tool: ReturnType<typeof defineTool>): Agent {
  return Agent.create({ provider: oneToolCall(), model: 'mock', maxIterations: 3 })
    .system('You are the walker.')
    .tool(tool)
    .build();
}

/** Run an agent while collecting every dispatched event, in order. */
async function runCollecting(agent: Agent): Promise<{ answer: unknown; rows: Row[] }> {
  const rows: Row[] = [];
  agent.on('*', (e) => rows.push({ type: e.type, payload: e.payload as Record<string, unknown> }));
  const answer = await agent.run({ message: 'walk it' });
  return { answer, rows };
}

// ─── unit: the reports, their order, and who stamps what ──────────────────

describe('ctx.progress — the reports land, stamped by the framework', () => {
  it('N calls file N tool_progress events, in call order', async () => {
    const { rows } = await runCollecting(agentWith(walkTool(12)));
    const progress = rows.filter((r) => r.type === 'agentfootprint.stream.tool_progress');
    expect(progress).toHaveLength(12);
    expect(progress.map((p) => (p.payload.payload as { done: number }).done)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('every report is stamped with the dispatch it ran under — never the tool’s to state', async () => {
    const seen: ToolExecutionContext[] = [];
    const { rows } = await runCollecting(agentWith(walkTool(3, seen)));
    const ctx = seen[0];
    expect(ctx).toBeDefined();
    const progress = rows.filter((r) => r.type === 'agentfootprint.stream.tool_progress');
    // Asserted BEFORE the loop: a `for` over an empty list checks nothing, and
    // "no reports at all" is exactly the failure this test must catch.
    expect(progress).toHaveLength(3);
    for (const row of progress) {
      expect(row.payload.toolCallId).toBe('tc-walk');
      expect(row.payload.toolCallId).toBe(ctx!.toolCallId);
      expect(row.payload.toolName).toBe('walk_graph');
      expect(row.payload.iteration).toBe(ctx!.iteration);
      expect(typeof row.payload.iteration).toBe('number');
    }
  });

  it('the payload is the author’s data, forwarded verbatim (nested shape intact)', async () => {
    const rich = defineTool({
      name: 'walk_graph',
      description: 'Walk the dependency graph',
      execute: (_a: Record<string, unknown>, ctx: ToolExecutionContext) => {
        ctx.progress({ phase: 'expand', detail: { visited: ['a', 'b'], depth: 2 }, pct: 0.25 });
        return 'ok';
      },
    });
    const { rows } = await runCollecting(agentWith(rich));
    const only = rows.filter((r) => r.type === 'agentfootprint.stream.tool_progress');
    expect(only).toHaveLength(1);
    expect(only[0]!.payload.payload).toEqual({
      phase: 'expand',
      detail: { visited: ['a', 'b'], depth: 2 },
      pct: 0.25,
    });
  });

  it('a non-object payload rides untouched too (a status string is a valid report)', async () => {
    const stringy = defineTool({
      name: 'walk_graph',
      description: 'Walk the dependency graph',
      execute: (_a: Record<string, unknown>, ctx: ToolExecutionContext) => {
        ctx.progress('hop 3 of 12');
        return 'ok';
      },
    });
    const { rows } = await runCollecting(agentWith(stringy));
    const only = rows.filter((r) => r.type === 'agentfootprint.stream.tool_progress');
    expect(only.map((r) => r.payload.payload)).toEqual(['hop 3 of 12']);
  });
});

// ─── functional: ordering against the call’s own boundaries ───────────────

describe('ctx.progress — every report is INSIDE its own call', () => {
  it('all 12 land after tool_start and before tool_end', async () => {
    const { rows } = await runCollecting(agentWith(walkTool(12)));
    const at = (type: string) => rows.findIndex((r) => r.type === type);
    const start = at('agentfootprint.stream.tool_start');
    const end = at('agentfootprint.stream.tool_end');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const progressIdx = rows
      .map((r, i) => (r.type === 'agentfootprint.stream.tool_progress' ? i : -1))
      .filter((i) => i >= 0);
    expect(progressIdx).toHaveLength(12);
    for (const i of progressIdx) {
      expect(i).toBeGreaterThan(start);
      expect(i).toBeLessThan(end);
    }
  });
});

// ─── integration: the two delivery paths, no wiring of their own ──────────

describe('ctx.progress — reaches the SSE stream through the real toSSE path', () => {
  it('the stream carries all three reports, stamped with the toolCallId', async () => {
    const agent = agentWith(walkTool(3));
    const chunks: string[] = [];
    const stream = toSSE(agent, {
      filter: (e) => e.type.startsWith('agentfootprint.stream.'),
    });
    const collect = (async () => {
      for await (const c of stream) chunks.push(c);
    })();
    await agent.run({ message: 'walk it' });
    await new Promise((r) => setTimeout(r, 10));
    // `toSSE` ends on turn_end, which this filter drops — close the iterator.
    void collect;

    const reports = chunks.filter((c) => c.includes('agentfootprint.stream.tool_progress'));
    expect(reports).toHaveLength(3);
    for (const chunk of reports) {
      expect(chunk.startsWith('event: agentfootprint.stream.tool_progress\ndata: ')).toBe(true);
      const data = JSON.parse(chunk.slice(chunk.indexOf('data: ') + 6)) as {
        payload: { toolCallId: string; toolName: string; payload: { total: number } };
      };
      expect(data.payload.toolCallId).toBe('tc-walk');
      expect(data.payload.toolName).toBe('walk_graph');
      expect(data.payload.payload.total).toBe(3);
    }
  });
});

// ─── boundary: nothing listening, and nothing reported ────────────────────

describe('ctx.progress — the quiet cases stay quiet', () => {
  it('no listener: the tool runs to completion and its result is unchanged', async () => {
    // The tool records that it got PAST its twelve reports. Asserting only the
    // final answer would not catch a throwing `progress`: a tool that blows up
    // is caught, its error handed to the model as the tool result, and the
    // scripted mock still says 'done'. The flag is what makes this test real.
    let finished = false;
    const walker = defineTool({
      name: 'walk_graph',
      description: 'Walk the dependency graph',
      execute: (_a: Record<string, unknown>, ctx: ToolExecutionContext) => {
        for (let i = 1; i <= 12; i += 1) ctx.progress({ done: i, total: 12 });
        finished = true;
        return 'walked 12 hops';
      },
    });
    const agent = agentWith(walker);
    // No `.on(...)`, no recorder, no stream — the reports have nowhere to go.
    const answer = await agent.run({ message: 'walk it' });
    expect(finished).toBe(true);
    expect(answer).toBe('done');
  });

  it('a tool that never reports files no tool_progress rows, and shifts nothing else', async () => {
    const reported = await runCollecting(agentWith(walkTool(12)));
    const quiet = await runCollecting(agentWith(quietTool));

    expect(quiet.rows.some((r) => r.type === 'agentfootprint.stream.tool_progress')).toBe(false);
    expect(quiet.answer).toBe(reported.answer);
    // The quiet run's stream is EXACTLY the reporting run's stream with the
    // progress rows removed — the feature adds events and moves none.
    expect(quiet.rows.map((r) => r.type)).toEqual(
      reported.rows.map((r) => r.type).filter((t) => t !== 'agentfootprint.stream.tool_progress'),
    );
  });

  it('the tool result the MODEL reads is untouched by reporting', async () => {
    const { rows } = await runCollecting(agentWith(walkTool(12)));
    const end = rows.find((r) => r.type === 'agentfootprint.stream.tool_end');
    expect(end?.payload.result).toBe('walked 12 hops');
  });
});

// ─── the archive: reports survive the envelope round-trip ─────────────────

describe('ctx.progress — the reports are in the recording, on disk', () => {
  it('a written-and-reread envelope still carries all 12, stamped', async () => {
    const agent = agentWith(walkTool(12));
    const rec = recordRun(agent);
    await agent.run({ message: 'walk it' });
    const directory = tempDir();
    await persistRecording(rec, {
      sink: fileRecordingSink({ directory }),
      run: { complete: true },
    });
    rec.stop();

    const files = readdirSync(directory).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const envelope = JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as {
      recording: { events: Row[] };
    };
    const progress = envelope.recording.events.filter(
      (e) => e.type === 'agentfootprint.stream.tool_progress',
    );
    expect(progress).toHaveLength(12);
    expect(progress[0]!.payload.toolCallId).toBe('tc-walk');
    expect(progress[11]!.payload.payload).toEqual({ done: 12, total: 12, hop: 'node-12' });
  });
});
