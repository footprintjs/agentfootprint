/**
 * What a script row attests is bound to the exact dispatch it describes.
 *
 *   - The runner's facts reach the dispatch that ran the program, and no
 *     other: two agents sharing one code-running tool, whose providers issue
 *     the same call id, never trade outcomes.
 *   - The program on the row is the one the tool was HANDED, captured before
 *     any app code runs: a tool that edits its argument afterwards does not
 *     rewrite the record.
 *   - A row belongs to a dispatch, never to a provider id: a reused id is a new
 *     call (counted against the per-turn rows, attached in execution order),
 *     and a pause and its settlement are one call.
 */

import { describe, expect, it } from 'vitest';

import {
  askHuman,
  checkInApproved,
  codeRunnerTool,
  defineTool,
  isPaused,
} from '../../../../src/index.js';
import { MAX_SCRIPT_BYTES, MAX_SCRIPT_ROWS } from '../../../../src/core/agent/scripts/rows.js';
import { utf8Length } from '../../../../src/lib/utf8.js';
import { pausedRequest } from '../../../helpers/pausedRequest.js';
import {
  answer,
  callCode,
  runnerAnswering,
  scriptAgent,
  scriptRows,
  stateOf,
  type CodeExecution,
} from './fixtures/scriptAgent.js';

const PROGRAM_A = 'print("A")';
const PROGRAM_B = 'print("B")';

describe('the runner’s facts reach the exact dispatch that ran', () => {
  it('two agents share one code-running tool and their providers reuse one call id: no outcome is traded', async () => {
    // Both executions wait on one gate, released by the second — so the two
    // runs finish in the same tick and their facts land together.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    const shared = codeRunnerTool({
      runner: runnerAnswering(async (exec: CodeExecution) => {
        started += 1;
        if (started === 2) release();
        await gate;
        return exec.code === PROGRAM_A
          ? { ok: true, exitCode: 0, stdout: 'a', stderr: '' }
          : { ok: false, exitCode: 7, stdout: '', stderr: 'b' };
      }),
    });
    const a = scriptAgent({
      tools: [shared],
      travel: true,
      replies: [callCode('same-provider-id', PROGRAM_A), answer('A done.')],
    });
    const b = scriptAgent({
      tools: [shared],
      travel: true,
      replies: [callCode('same-provider-id', PROGRAM_B), answer('B done.')],
    });
    await Promise.all([a.agent.run('a'), b.agent.run('b')]);
    const shownOf = (turnEnds: Array<Record<string, unknown>>) =>
      (turnEnds.at(-1)?.scripts as { shown: Array<Record<string, unknown>> }).shown[0];
    expect(shownOf(a.turnEnds)).toMatchObject({ text: PROGRAM_A, label: 'completed', exitCode: 0 });
    expect(shownOf(b.turnEnds)).toMatchObject({
      text: PROGRAM_B,
      label: 'completed-with-failure',
      exitCode: 7,
    });
    // Each dispatch emitted its own code_run, once.
    expect(a.codeRuns).toHaveLength(1);
    expect(b.codeRuns).toHaveLength(1);
  });

  it('a direct execute outside any agent still files its facts by call id (the public map)', async () => {
    const { codeRunsOf } = await import('../../../../src/index.js');
    const tool = codeRunnerTool({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    });
    // A direct execute: a hand-built context, as a script or a test builds one.
    await tool.execute({ code: 'x' }, {
      toolCallId: 'direct-1',
      iteration: 0,
      runId: 'r1',
      teardownScopes: ['call', 'run', 'session', 'shutdown'],
      onTeardown: () => {},
    } as never);
    expect(codeRunsOf(tool)?.get('direct-1')).toMatchObject({ exitCode: 0 });
  });
});

/** A declared code-running tool that edits the program it was handed, then returns. */
const editingTool = defineTool<{ code: string }, string>({
  name: 'run_code',
  description: 'Runs a program, then rewrites its own argument.',
  inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  script: { argument: 'code', language: 'python' },
  execute: async (args) => {
    (args as { code: string }).code = 'print("EDITED AFTER RECEIPT")';
    return 'ran';
  },
});

describe('the program on the row is the one the tool was handed', () => {
  it('a tool that edits its argument after receiving it does not rewrite the record', async () => {
    const { agent, turnEnds } = scriptAgent({
      tools: [editingTool],
      travel: true,
      replies: [callCode('c1', PROGRAM_A), answer('Done.')],
    });
    await agent.run('go');
    expect(scriptRows(agent).at(-1)).toMatchObject({ text: PROGRAM_A, outcome: 'returned' });
    expect(scriptRows(agent).at(-1)).not.toHaveProperty('rewritten');
    const shown = (turnEnds.at(-1)?.scripts as { shown: Array<{ text: string }> }).shown;
    expect(shown[0]?.text).toBe(PROGRAM_A);
  });

  it('a wrapper around the real code runner that edits the argument after the run: the program that ran, with its facts', async () => {
    const inner = codeRunnerTool({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '1', stderr: '' }),
    });
    const wrapper = defineTool<{ code: string }, string>({
      name: 'run_code',
      description: 'Runs the program through the code runner.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      script: { argument: 'code', language: 'python' },
      execute: async (args, ctx) => {
        const out = await inner.execute(args, ctx);
        (args as { code: string }).code = 'print("EDITED AFTER THE RUN")';
        return out;
      },
    });
    const { agent } = scriptAgent({
      tools: [wrapper],
      travel: true,
      replies: [callCode('c1', PROGRAM_A), answer('Done.')],
    });
    await agent.run('go');
    expect(scriptRows(agent).at(-1)).toMatchObject({
      text: PROGRAM_A,
      outcome: 'completed',
      exitCode: 0,
    });
  });

  it('after a pause and resume, the program the resumed execute was handed — not an edit made during it', async () => {
    const pausing = defineTool<{ code: string }, string>({
      name: 'run_code',
      description: 'Runs a program, then rewrites its own argument.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      script: { argument: 'code', language: 'python' },
      checkIn: 'always',
      execute: async (args) => {
        (args as { code: string }).code = 'print("EDITED ON RESUME")';
        return 'ran';
      },
    });
    const r = scriptAgent({
      tools: [pausing],
      travel: true,
      replies: [callCode('c1', PROGRAM_A), answer('Done.')],
    });
    const first = await r.agent.run('go');
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    await r.agent.resume(
      first.checkpoint,
      checkInApproved({ request: pausedRequest(first), by: 'alice' }),
    );
    const rows = scriptRows(r.agent);
    expect(rows.at(-1)).toMatchObject({ text: PROGRAM_A, outcome: 'returned' });
    // The pause and its settlement are ONE call: one dispatch, counted once.
    expect(new Set(rows.map((row) => row.dispatch)).size).toBe(1);
  });
});

describe('a call that asks a person from INSIDE execute', () => {
  it('edits its argument, then asks: the row that settles it keeps the program it was handed', async () => {
    const asking = defineTool<{ code: string }, string>({
      name: 'run_code',
      description: 'Runs a program after a person says so.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      script: { argument: 'code', language: 'python' },
      execute: (args) => {
        (args as { code: string }).code = 'print("EDITED BEFORE ASKING")';
        return askHuman({ question: 'Run it?' }) as never;
      },
    });
    const r = scriptAgent({
      tools: [asking],
      travel: true,
      replies: [callCode('c1', PROGRAM_A), answer('Done.')],
    });
    const first = await r.agent.run('go');
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    await r.agent.resume(first.checkpoint, 'yes');
    const rows = scriptRows(r.agent);
    expect(rows.at(-1)).toMatchObject({ text: PROGRAM_A });
    expect(rows.at(-1)).not.toHaveProperty('rewritten');
    // The pause and its settlement are one dispatch.
    expect(new Set(rows.map((row) => row.dispatch)).size).toBe(1);
  });
});

describe('a row belongs to a dispatch, never to a provider id', () => {
  it('a/A, b/B, a/C: the LAST call executed is attached, and each is its own row', async () => {
    const { agent, turnEnds } = scriptAgent({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
      travel: { which: 'last' },
      replies: [
        callCode('a', 'print("A")'),
        callCode('b', 'print("B")'),
        callCode('a', 'print("C")'),
        answer('Done.'),
      ],
    });
    await agent.run('go');
    const shown = (turnEnds.at(-1)?.scripts as { shown: Array<{ text: string }> }).shown;
    expect(shown.map((s) => s.text)).toEqual(['print("C")']);
    const rows = scriptRows(agent);
    expect(rows.map((row) => [row.toolCallId, row.dispatch])).toEqual([
      ['a', 1],
      ['b', 2],
      ['a', 3],
    ]);
  });

  it('which: all attaches every executed call in execution order', async () => {
    const { agent, turnEnds } = scriptAgent({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
      travel: { which: 'all' },
      replies: [
        callCode('a', 'print("A")'),
        callCode('b', 'print("B")'),
        callCode('a', 'print("C")'),
        answer('Done.'),
      ],
    });
    await agent.run('go');
    const shown = (turnEnds.at(-1)?.scripts as { shown: Array<{ text: string }> }).shown;
    expect(shown.map((s) => s.text)).toEqual(['print("A")', 'print("B")', 'print("C")']);
  });

  it(`${
    MAX_SCRIPT_ROWS + 1
  } calls reusing ONE id, each ${MAX_SCRIPT_BYTES} bytes: the bound and the count hold`, async () => {
    const programOf = (i: number): string => {
      const head = `# ${i}\n`;
      return head + 'y'.repeat(MAX_SCRIPT_BYTES - utf8Length(head));
    };
    const calls = Array.from({ length: MAX_SCRIPT_ROWS + 1 }, (_, i) =>
      callCode('a', programOf(i)),
    );
    const { agent, turnEnds } = scriptAgent({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
      travel: { which: 'all' },
      maxIterations: MAX_SCRIPT_ROWS + 4,
      replies: [...calls, answer('Done.')],
    });
    await agent.run('go');
    const rows = scriptRows(agent);
    const textBytes = rows.reduce(
      (sum, row) => sum + (typeof row.text === 'string' ? utf8Length(row.text) : 0),
      0,
    );
    expect(textBytes).toBeLessThanOrEqual(MAX_SCRIPT_ROWS * MAX_SCRIPT_BYTES);
    expect(new Set(rows.map((row) => row.dispatch)).size).toBe(MAX_SCRIPT_ROWS);
    expect(stateOf(agent).scriptsDropped).toBe(1);
    const scripts = turnEnds.at(-1)?.scripts as { shown: unknown[]; omitted: number };
    // Eight attached; the other eight rows and the dropped call are counted.
    expect(scripts.shown).toHaveLength(8);
    expect(scripts.omitted).toBe(MAX_SCRIPT_ROWS - 8 + 1);
  }, 60_000);
});
