/**
 * The labels (design docs/design/2026-10-script-artifact.md § 4.3): execution
 * evidence, call settlement and result delivery are three facts. Only an
 * explicit exit code proves the program reached an exit; a bare runner verdict
 * is reported as what the runner said, with no exit number; a service error
 * with no exit code is unknown; a timeout, a cancellation or a thrown error
 * with no runner facts is unknown; a completion stays confirmed when its result
 * is withheld; a return without facts is "returned".
 *
 * On a mock runner and mock declared tools, with the E2 record (`exitCode`,
 * `serviceError`, `terminatedBy`, an `ok` that may be absent) in place.
 */

import { describe, expect, it } from 'vitest';

import {
  askHuman,
  CodeSandboxError,
  codeRunnerTool,
  defineTool,
  isPaused,
  type Tool,
} from '../../../../src/index.js';
import type { PermissionChecker } from '../../../../src/provider-contract/types.js';
import { scriptLabelOf, labelWords } from '../../../../src/core/agent/scripts/label.js';
import {
  answer,
  callCode,
  declaredEcho,
  runnerAnswering,
  scriptAgent,
  scriptRows,
} from './fixtures/scriptAgent.js';

const PROGRAM = 'print(sum([1200, 2400]))';

/** Run one call of the code tool under `runner`, with the attachment armed, and read its row. */
async function rowAfter(
  runner: Parameters<typeof codeRunnerTool>[0]['runner'],
  extra?: Partial<Tool>,
) {
  const tool = { ...codeRunnerTool({ runner }), ...extra } as Tool;
  const r = scriptAgent({
    tools: [tool],
    travel: true,
    replies: [callCode('c1', PROGRAM), answer('Done.')],
  });
  const out = await r.agent.run('compute');
  return { ...r, out, row: scriptRows(r.agent).at(-1)! };
}

describe('from execution evidence — an explicit exit code proves an exit', () => {
  it('`completed` from an explicit exitCode: 0', async () => {
    const { row, out } = await rowAfter(
      runnerAnswering({ ok: true, exitCode: 0, stdout: '3600', stderr: '' }),
    );
    expect(row).toMatchObject({ outcome: 'completed', exitCode: 0, text: PROGRAM });
    expect(out).toContain('Script submitted to run_code on call c1 — completed, exit 0.');
  });

  it('a completed script plus a SIZE refusal → completed, resultWithheld, the refusal on the record', async () => {
    const { row, all, out } = await rowAfter(
      runnerAnswering({ ok: true, exitCode: 0, stdout: 'x'.repeat(500), stderr: '' }),
      { resultCeiling: { maxChars: 50 } } as Partial<Tool>,
    );
    expect(row).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      resultWithheld: 'over-ceiling',
    });
    expect(all.some((e) => e.name === 'agentfootprint.tools.result_refused')).toBe(true);
    expect(out).toContain(
      "completed, exit 0; its result was withheld over the tool's ceiling. Attached by the library",
    );
  });

  it('an explicit NON-ZERO exit after partial work → completed-with-failure, never outcome-unknown', async () => {
    const { row, out } = await rowAfter(
      runnerAnswering({ ok: false, exitCode: 7, stdout: 'row 1\nrow 2\n', stderr: 'boom' }),
    );
    expect(row).toMatchObject({ outcome: 'completed-with-failure', exitCode: 7 });
    expect(out).toContain('— completed with failure, exit 7.');
  });
});

describe('a bare runner verdict is what the runner reported — never an exit number', () => {
  it('a successful response WITHOUT an exit → reported-success, and nothing prints "exit 0"', async () => {
    const { row, out, turnEnds } = await rowAfter(
      runnerAnswering({ ok: true, stdout: '3600', stderr: '' }),
    );
    expect(row).toMatchObject({ outcome: 'reported-success' });
    expect(row).not.toHaveProperty('exitCode');
    expect(out).toContain('— runner reported success; no exit code.');
    expect(out).not.toContain('exit 0');
    expect(JSON.stringify(turnEnds.at(-1)!.scripts)).not.toContain('exitCode');
  });

  it('a bare failure verdict, no exit, no service error → reported-failure', async () => {
    const { row } = await rowAfter(runnerAnswering({ ok: false, stdout: '', stderr: 'nope' }));
    expect(row).toMatchObject({ outcome: 'reported-failure' });
    expect(row).not.toHaveProperty('exitCode');
    expect(row).not.toHaveProperty('serviceError');
  });

  it('a stopped process (terminatedBy, no exit) is the runner reporting failure — no exit is made up', async () => {
    const { row } = await rowAfter(
      runnerAnswering({ ok: false, terminatedBy: 'SIGKILL', stdout: '', stderr: '' }),
    );
    expect(row).toMatchObject({ outcome: 'reported-failure' });
    expect(row).not.toHaveProperty('exitCode');
  });

  it('runner facts that report NO outcome (ok absent, no exit) are no execution evidence → returned', async () => {
    const { row, out } = await rowAfter(runnerAnswering({ stdout: '3600', stderr: '' }));
    expect(row).toMatchObject({ outcome: 'returned' });
    expect(out).toContain('— tool call returned; execution not confirmed.');
  });
});

describe('unknown stays unknown', () => {
  it('a SERVICE ERROR without an exit → outcome-unknown with serviceError, never completed-with-failure', async () => {
    const { row } = await rowAfter(
      runnerAnswering({
        ok: false,
        serviceError: true,
        stdout: '',
        stderr: 'service refused execution',
      }),
    );
    expect(row).toMatchObject({ outcome: 'outcome-unknown', serviceError: true });
    expect(row).not.toHaveProperty('exitCode');
  });

  it('a remote completion after the client timed out → outcome-unknown, and still after the remote side reports', async () => {
    let remoteFinished = false;
    const runner = runnerAnswering(() => {
      // The "remote" side finishes later; the caller has already stopped waiting.
      setTimeout(() => {
        remoteFinished = true;
      }, 5);
      return Promise.reject(new Error('the code did not finish within 10ms'));
    });
    const { row, agent } = await rowAfter(runner);
    expect(row).toMatchObject({ outcome: 'outcome-unknown' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(remoteFinished).toBe(true);
    // The record holds no fact to promote it with.
    expect(scriptRows(agent).at(-1)).toMatchObject({ outcome: 'outcome-unknown' });
  });

  it('a cancellation → outcome-unknown', async () => {
    const aborted = new Error('The operation was aborted.');
    aborted.name = 'AbortError';
    const { row } = await rowAfter(runnerAnswering(() => Promise.reject(aborted)));
    expect(row).toMatchObject({ outcome: 'outcome-unknown' });
  });

  it('a thrown staging refusal → outcome-unknown', async () => {
    const { row } = await rowAfter(
      runnerAnswering(() =>
        Promise.reject(
          new CodeSandboxError('staged-inputs-unset', 'the staged-input manifest could not be set'),
        ),
      ),
    );
    expect(row).toMatchObject({ outcome: 'outcome-unknown' });
  });
});

describe('from settlement — no runner facts', () => {
  it('a declared tool that RETURNS without executing its argument → returned', async () => {
    const r = scriptAgent({
      tools: [declaredEcho],
      travel: true,
      replies: [callCode('c1', PROGRAM, 'echo_code'), answer('Done.')],
    });
    const out = await r.agent.run('go');
    expect(scriptRows(r.agent).at(-1)).toMatchObject({ outcome: 'returned', tool: 'echo_code' });
    expect(out).toContain('— tool call returned; execution not confirmed.');
  });

  it('a permission refusal → submitted (the call never entered execute)', async () => {
    const deny: PermissionChecker = {
      name: 'deny-code',
      check: async () => ({ result: 'deny', rationale: 'no code today' }),
    };
    const r = scriptAgent({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
      permissionChecker: deny,
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', PROGRAM), answer('Could not run it.')],
    });
    await r.agent.run('go');
    expect(scriptRows(r.agent).at(-1)).toMatchObject({ outcome: 'submitted', text: PROGRAM });
  });

  it('a never-dispatched batch member → submitted', async () => {
    const asker = defineTool<Record<string, never>, string>({
      name: 'ask_person',
      description: 'asks a person',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'which dataset?' }),
    });
    const r = scriptAgent({
      tools: [
        asker,
        codeRunnerTool({
          runner: runnerAnswering({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
        }),
      ],
      gate: { posture: 'assist', code: 'match' },
      replies: [
        {
          content: '',
          toolCalls: [
            { id: 'a1', name: 'ask_person', args: {} },
            { id: 'c2', name: 'run_code', args: { code: PROGRAM } },
          ],
          stopReason: 'tool_use',
        },
        answer('Thanks.'),
      ],
    });
    const first = await r.agent.run('go');
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    await r.agent.resume(first.checkpoint, 'the sales one');
    const rows = scriptRows(r.agent);
    expect(rows.at(-1)).toMatchObject({ toolCallId: 'c2', outcome: 'submitted', text: PROGRAM });
  });
});

describe('the rule, unit by unit — and its words', () => {
  it('execution evidence first, then settlement; delivery never decides', () => {
    expect(scriptLabelOf({ settlement: 'returned', facts: { exitCode: 0 } })).toEqual({
      label: 'completed',
      exitCode: 0,
    });
    expect(scriptLabelOf({ settlement: 'threw', facts: { exitCode: 3 } })).toEqual({
      label: 'completed-with-failure',
      exitCode: 3,
    });
    // An exit code wins over a service flag.
    expect(
      scriptLabelOf({ settlement: 'returned', facts: { exitCode: 2, serviceError: true } }),
    ).toEqual({
      label: 'completed-with-failure',
      exitCode: 2,
    });
    expect(
      scriptLabelOf({ settlement: 'returned', facts: { ok: false, serviceError: true } }),
    ).toEqual({
      label: 'outcome-unknown',
      serviceError: true,
    });
    expect(scriptLabelOf({ settlement: 'returned', facts: { ok: true } })).toEqual({
      label: 'reported-success',
    });
    expect(scriptLabelOf({ settlement: 'returned', facts: {} })).toEqual({ label: 'returned' });
    expect(scriptLabelOf({ settlement: 'threw', facts: {} })).toEqual({ label: 'outcome-unknown' });
    expect(scriptLabelOf({ settlement: 'returned' })).toEqual({ label: 'returned' });
    expect(scriptLabelOf({ settlement: 'threw' })).toEqual({ label: 'outcome-unknown' });
    expect(scriptLabelOf({ settlement: 'not-entered' })).toEqual({ label: 'submitted' });
  });

  it('only completed and completed-with-failure carry an exit number, and only the recorded one', () => {
    expect(labelWords('completed')).toBe('completed, exit 0');
    expect(labelWords('completed-with-failure', 7)).toBe('completed with failure, exit 7');
    for (const label of [
      'submitted',
      'returned',
      'reported-success',
      'reported-failure',
      'outcome-unknown',
    ] as const) {
      expect(labelWords(label, 0)).not.toMatch(/exit \d/);
    }
  });
});
