/**
 * The live half of `ctx.progress` (9.54.0) — a mid-call report reaches the
 * surface a PERSON watches, not only the record.
 *
 * The gap this closes came back from a consumer integration against 9.52.0 /
 * 9.53.0, and their sentence is the spec: `tool_progress` "is emitted by the
 * tool-call stage and in the event registry, but no status strategy consumes
 * it — so it lands on the record, not in the browser." Everything downstream
 * of that was a hand-rolled side channel for the middle of a long call, which
 * is exactly half the feature written twice.
 *
 * These are end-to-end runs — real Agent, real tool registry, real dispatcher,
 * mock provider — read through the two doors a consumer actually wires:
 *
 *   • `agent.enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine }) })`
 *     — the uniform path, the one a chat bubble sits behind.
 *   • `attachStatus(dispatcher, { onStatus })` — the low-level helper.
 *
 * What is pinned:
 *
 *   1. A report carrying `message` puts the tool author's sentence on the
 *      live line, verbatim, WHILE the call is still running (asserted against
 *      the position of `tool_end`, not merely against the final list).
 *   2. A report carrying no `message` still moves the line — the generic,
 *      honest one — and never pretty-prints the payload.
 *   3. Both faces come from ONE call: the structured payload is on the record
 *      untouched while the sentence is on the screen.
 *   4. A tool that never reports produces byte-identical status lines to the
 *      ones it produced before this existed.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import type { ToolExecutionContext } from '../../src/core/tools.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { chatBubbleLiveStatus } from '../../src/strategies/defaults/chatBubbleLiveStatus.js';
import { attachStatus } from '../../src/recorders/observability/StatusRecorder.js';
import type { EventDispatcher } from '../../src/events/dispatcher.js';

/** The consumer's tool: one call, two reports — one with words, one without. */
const screenReader = (report: boolean) =>
  defineTool({
    name: 'screen_reader',
    description: 'Read what is on the screen',
    execute: (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
      if (report) {
        ctx.progress({ message: 'Looking at your screen…', page: 1 });
        ctx.progress({ done: 2, total: 2, region: 'sidebar' });
      }
      return 'a sidebar and a chart';
    },
  });

const oneCall = () =>
  mock({
    replies: [
      { toolCalls: [{ id: 'tc-1', name: 'screen_reader', args: {} }] },
      { content: 'I can see a sidebar and a chart.' },
    ],
  });

function buildAgent(report: boolean): Agent {
  return Agent.create({ provider: oneCall(), model: 'mock', maxIterations: 3 })
    .system('You look at screens.')
    .tool(screenReader(report))
    .build();
}

const VERBATIM = 'Looking at your screen…';
const GENERIC = '`screen_reader` reported progress (2 so far)…';

/** Run once, collecting the live status lines a chat bubble would render,
 *  interleaved with a marker for the moment the tool call ended. */
async function runForLines(report: boolean): Promise<{ lines: string[]; endedAt: number }> {
  const agent = buildAgent(report);
  const lines: string[] = [];
  let endedAt = -1;
  agent.on('agentfootprint.stream.tool_end', () => (endedAt = lines.length));
  agent.enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine: (l) => lines.push(l) }) });
  await agent.run({ message: 'what is on my screen?' });
  return { lines, endedAt };
}

describe('live status consumes tool_progress — the chat-bubble door', () => {
  it('shows the author’s sentence verbatim, mid-call', async () => {
    const { lines, endedAt } = await runForLines(true);
    expect(lines).toContain(VERBATIM);
    // Mid-call is the whole claim: the sentence must be on the line BEFORE
    // the call it describes finished. A report that only shows up in the
    // final list would be a slower record, not a live status.
    expect(endedAt).toBeGreaterThan(-1);
    expect(lines.indexOf(VERBATIM)).toBeLessThan(endedAt);
  });

  it('a report with no `message` still moves the line — the generic one', async () => {
    const { lines, endedAt } = await runForLines(true);
    expect(lines).toContain(GENERIC);
    expect(lines.indexOf(GENERIC)).toBeLessThan(endedAt);
    expect(lines.indexOf(GENERIC)).toBeGreaterThan(lines.indexOf(VERBATIM));
  });

  it('never dumps the author’s payload into the human line', async () => {
    const { lines } = await runForLines(true);
    for (const line of lines) {
      expect(line).not.toContain('sidebar"');
      expect(line).not.toContain('{');
      expect(line).not.toContain('"done"');
    }
  });

  it('one call, two faces — the sentence on screen, the payload on the record', async () => {
    const agent = buildAgent(true);
    const lines: string[] = [];
    const payloads: unknown[] = [];
    agent.on('agentfootprint.stream.tool_progress', (e) => payloads.push(e.payload.payload));
    agent.enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine: (l) => lines.push(l) }) });
    await agent.run({ message: 'what is on my screen?' });

    expect(lines).toContain(VERBATIM);
    // Untouched: the record still carries every field, including the ones the
    // line deliberately never says.
    expect(payloads).toEqual([
      { message: 'Looking at your screen…', page: 1 },
      { done: 2, total: 2, region: 'sidebar' },
    ]);
  });
});

describe('live status consumes tool_progress — the attachStatus door', () => {
  it('carries both lines to the low-level onStatus callback', async () => {
    const agent = buildAgent(true);
    const seen: string[] = [];
    const dispatcher = (agent as unknown as { dispatcher: EventDispatcher }).dispatcher;
    attachStatus(dispatcher, { onStatus: (s) => seen.push(s) });
    await agent.run({ message: 'what is on my screen?' });

    expect(seen).toContain(VERBATIM);
    expect(seen).toContain('screen_reader reported progress (2 so far)');
    expect(seen.indexOf(VERBATIM)).toBeLessThan(
      seen.findIndex((s) => s.startsWith('Got result from')),
    );
  });
});

describe('a tool that never reports', () => {
  it('produces byte-identical status lines to the ones it produced before 9.54.0', async () => {
    const { lines } = await runForLines(false);
    expect(lines).toContain('Working on `screen_reader`…');
    for (const line of lines) expect(line).not.toContain('reported progress');
    // The pre-9.54.0 shape, stated in full rather than probed: nothing about
    // a quiet tool's live status moved.
    expect(lines.filter((l) => l.includes('screen_reader'))).toEqual([
      'Working on `screen_reader`…',
    ]);
  });
});
