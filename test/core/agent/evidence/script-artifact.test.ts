/**
 * The attachment (design docs/design/2026-10-script-artifact.md § 4):
 * `.scriptTravelsWithTheAnswer()` attaches the recorded program itself, under
 * the answer, labelled from the execution record — data on `turn_end.scripts`
 * always, text after the `---` separator on a prose answer. The model never
 * retypes it, so there is nothing to check.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  checkInApproved,
  codeRunnerTool,
  isPaused,
  slidingWindow,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { conversationRedaction } from '../../../../src/doors/security.js';
import {
  resolveScriptTravel,
  scriptLabelLine,
  scriptsBlock,
  scriptsOfAnswer,
} from '../../../../src/core/agent/scripts/attachment.js';
import { labelWords } from '../../../../src/core/agent/scripts/label.js';
import { scriptRowFor } from '../../../../src/core/agent/scripts/rows.js';
import type {
  ScriptLabel,
  ScriptRow,
  TurnEndScripts,
} from '../../../../src/core/agent/scripts/types.js';
import { codeRegionsOf } from '../../../../src/core/agent/evidence/codeRegions.js';
import { pausedRequest } from '../../../helpers/pausedRequest.js';
import {
  answer,
  callCode,
  fenced,
  runnerAnswering,
  scriptAgent,
  scriptRows,
} from './fixtures/scriptAgent.js';

const ok = runnerAnswering({ ok: true, exitCode: 0, stdout: '42', stderr: '' });
const P1 = 'rows = load()\nprint(len(rows))';
const P2 = 'print(41 + 1)';

const scriptsOf = (turnEnd: Record<string, unknown> | undefined): TurnEndScripts =>
  turnEnd?.scripts as TurnEndScripts;

describe('which — the last call that reached the tool, or every one', () => {
  it("'last' (the default) attaches the last call, labelled; the answer gains the block after ---", async () => {
    const { agent, turnEnds } = scriptAgent({
      runner: ok,
      travel: true,
      replies: [callCode('c1', P1), callCode('c2', P2), answer('The answer is 42.')],
    });
    const out = await agent.run('compute');
    expect(out).toBe(
      'The answer is 42.\n\n---\n\n' +
        'Script submitted to `run_code` on call `c2` — completed, exit 0. Attached by the library from the run record:\n\n' +
        '```python\nprint(41 + 1)\n```',
    );
    expect(scriptsOf(turnEnds.at(-1))).toEqual({
      shown: [
        {
          toolCallId: 'c2',
          dispatch: 2,
          tool: 'run_code',
          language: 'python',
          label: 'completed',
          exitCode: 0,
          bytes: 13,
          lines: 1,
          text: P2,
        },
      ],
      omitted: 0,
    });
    // The text the person reads equals what the record holds: one fenced region, the program exactly.
    const regions = codeRegionsOf(out as string).regions;
    expect(regions.map((r) => r.content)).toEqual([P2]);
  });

  it("'all' attaches every call that reached the tool, at most 8, the rest counted as omitted", async () => {
    const calls = Array.from({ length: 10 }, (_, i) => callCode(`c${i + 1}`, `print(${i})`));
    const { agent, turnEnds } = scriptAgent({
      runner: ok,
      travel: { which: 'all' },
      maxIterations: 12,
      replies: [...calls, answer('Done.')],
    });
    const out = (await agent.run('go')) as string;
    const scripts = scriptsOf(turnEnds.at(-1));
    expect(scripts.shown.map((s) => s.toolCallId)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
    ]);
    expect(scripts.omitted).toBe(2);
    expect(out).toContain('2 more scripts were submitted this turn and are not shown here.');
  });

  it('a call that never reached the tool is not attached', async () => {
    const { agent, turnEnds } = scriptAgent({
      runner: ok,
      travel: { which: 'all' },
      permissionChecker: {
        name: 'deny-second',
        check: async (req) => ({
          result: (req.context as { code?: string } | undefined)?.code === P2 ? 'deny' : 'allow',
        }),
      } as never,
      replies: [callCode('c1', P1), callCode('c2', P2), answer('Done.')],
    });
    await agent.run('go');
    expect(scriptsOf(turnEnds.at(-1)).shown.map((s) => s.toolCallId)).toEqual(['c1']);
  });
});

describe('the text form and the data form', () => {
  it('a TYPED answer gets the data only — its bytes are never edited', async () => {
    const { agent, turnEnds } = scriptAgent({
      runner: ok,
      travel: true,
      outputSchema: true,
      replies: [callCode('c1', P2), answer('{"total":42}')],
    });
    const out = await agent.run('compute');
    expect(out).toBe('{"total":42}');
    expect(scriptsOf(turnEnds.at(-1)).shown[0]).toMatchObject({ toolCallId: 'c1', text: P2 });
  });

  it('appended even when the model showed a MATCHED block — the model’s copy never decides', async () => {
    const shown = `Here is the script:\n\n${fenced(P2)}`;
    const { agent, checks } = scriptAgent({
      runner: ok,
      travel: true,
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', P2), answer(shown)],
    });
    const out = (await agent.run('compute')) as string;
    expect((checks.at(-1)!.scripts as { blocks: Array<{ label: string }> }).blocks[0]!.label).toBe(
      'completed',
    );
    expect(
      out.startsWith(`${shown}\n\n---\n\nScript submitted to \`run_code\` on call \`c1\``),
    ).toBe(true);
  });

  it('one label line per label — the label’s own words, the call named, never a destination', () => {
    const labels: Array<[ScriptLabel, number | undefined, string]> = [
      ['submitted', undefined, 'submitted'],
      ['returned', undefined, 'tool call returned; execution not confirmed'],
      ['reported-success', undefined, 'runner reported success; no exit code'],
      ['reported-failure', undefined, 'runner reported failure; no exit code'],
      ['completed', 0, 'completed, exit 0'],
      ['completed-with-failure', 7, 'completed with failure, exit 7'],
      ['outcome-unknown', undefined, 'outcome unknown'],
    ];
    for (const [label, exitCode, words] of labels) {
      expect(labelWords(label, exitCode)).toBe(words);
      expect(
        scriptLabelLine({
          toolCallId: 'c9',
          tool: 'run_code',
          label,
          ...(exitCode !== undefined && { exitCode }),
          bytes: 1,
          lines: 1,
          text: 'x',
        }),
      ).toBe(
        `Script submitted to \`run_code\` on call \`c9\` — ${words}. Attached by the library from the run record:`,
      );
    }
  });
});

describe('the library’s fence', () => {
  const rowWith = (program: string): ScriptRow => ({
    ...scriptRowFor({
      script: { argument: 'code', language: 'python' },
      tool: 'run_code',
      toolCallId: 'c1',
      iteration: 1,
      turn: 1,
      proposed: program,
      settlement: 'returned',
      facts: { exitCode: 0 },
    })!,
    dispatch: 1,
  });
  const textOf = (program: string, maxBytes = 4_000) =>
    scriptsBlock(scriptsOfAnswer([rowWith(program)], { which: 'last', maxBytes }));

  it.each([
    ['no backticks', 'print(1)', '```'],
    ['three backticks', 's = "```"', '````'],
    ['four backticks', 's = "````"', '`````'],
  ])('a program with %s gets a fence of max(3, longestRun + 1)', (_label, program, fence) => {
    const text = textOf(program);
    expect(text).toContain(`\n\n${fence}python\n${program}\n${fence}`);
    expect(codeRegionsOf(text).regions.map((r) => r.content)).toEqual([program]);
  });

  it('maxBytes cuts at a CODE-POINT boundary and says the program is incomplete', () => {
    const program = 'é'.repeat(10); // 20 bytes
    const data = scriptsOfAnswer([rowWith(program)], { which: 'last', maxBytes: 7 });
    expect(data.shown[0]).toMatchObject({ bytes: 20, truncated: { shownBytes: 6 }, text: 'ééé' });
    expect(scriptsBlock(data)).toContain(
      '```\n[incomplete: showing 6 of 20 bytes — not the whole program]',
    );
  });

  it('an over-size program has no text on its row: counted, and the text says it is not shown', () => {
    const big = rowWith('x'.repeat(40_000));
    expect(big.text).toBeUndefined();
    const data = scriptsOfAnswer([big], { which: 'last', maxBytes: 4_000 });
    expect(data.shown).toEqual([]);
    expect(data.omitted).toBe(1);
    expect(scriptsBlock(data)).toBe(
      'One script of 40000 bytes (`run_code`, call `c1`) is over the bound and is not shown.',
    );
  });
});

describe('refusals at build', () => {
  it('refused with no registered tool that declares `script` — an arm that could never attach anything', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' })
        .scriptTravelsWithTheAnswer()
        .build(),
    ).toThrow(/no registered tool declares `script`/);
  });

  it('options are checked where they are typed', () => {
    expect(() => resolveScriptTravel({ which: 'cited' as never })).toThrow(/which 'cited'/);
    expect(() => resolveScriptTravel({ maxBytes: 0 })).toThrow(/maxBytes/);
    expect(() => resolveScriptTravel({ maxBytes: 1.5 })).toThrow(/maxBytes/);
    expect(() => resolveScriptTravel({ extra: 1 } as never)).toThrow(/unknown option/);
    expect(resolveScriptTravel()).toEqual({ which: 'last', maxBytes: 4_000 });
  });
});

describe('the record across a redaction policy, a pause and a window', () => {
  it('turn_end.scripts under a redaction policy: the text kept out, the label and counts kept', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const agent = Agent.create({
      provider: mock({
        replies: [callCode('c1', 'print("SECRET-CODE")'), answer('Done.')] as never,
      }),
      model: 'mock',
      redact: conversationRedaction(),
    })
      .tool(codeRunnerTool({ runner: ok }))
      .scriptTravelsWithTheAnswer()
      .build();
    agent.on('agentfootprint.agent.turn_end', (e) =>
      events.push(e as unknown as { type: string; payload: Record<string, unknown> }),
    );
    await agent.run('go');
    const scripts = events.at(-1)!.payload.scripts as TurnEndScripts;
    expect(scripts.shown[0]).toMatchObject({
      label: 'completed',
      exitCode: 0,
      bytes: 20,
      lines: 1,
    });
    expect(scripts.shown[0]!.text).not.toContain('SECRET-CODE');
  });

  it('the row after a PAUSE and resume (a check-in approved): filed once settled, labelled from the run', async () => {
    const r = scriptAgent({
      runner: ok,
      checkIn: 'always',
      travel: true,
      replies: [callCode('c1', P2), answer('The answer is 42.')],
    });
    const first = await r.agent.run('compute');
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    // At the pause the call is open: `submitted`, without its text.
    const atPause = (first.checkpoint.sharedState?.findingsLedger ?? []) as Array<
      Record<string, unknown>
    >;
    expect(atPause.filter((row) => row.kind === 'script')).toEqual([
      expect.objectContaining({ toolCallId: 'c1', outcome: 'submitted', bytes: 13 }),
    ]);
    expect(atPause.find((row) => row.kind === 'script')).not.toHaveProperty('text');
    const out = await r.agent.resume(
      first.checkpoint,
      checkInApproved({ request: pausedRequest(first), by: 'alice' }),
    );
    expect(out).toContain('Script submitted to `run_code` on call `c1` — completed, exit 0.');
    // Append only, last wins: the settled row carries the text.
    expect(scriptRows(r.agent).at(-1)).toMatchObject({ outcome: 'completed', text: P2 });
    // The resumed execute boundary takes the runner's facts too.
    expect(r.codeRuns).toHaveLength(1);
  });

  it('the row after a WINDOW strategy dropped the assistant message that carried the call', async () => {
    const calls = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => callCode(id, `print(${i})`));
    const runner = ok;
    const agent = Agent.create({
      provider: mock({ replies: [...calls, answer('Done.')] as never }),
      model: 'mock',
      maxIterations: 8,
    })
      .tool(codeRunnerTool({ runner }))
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .scriptTravelsWithTheAnswer({ which: 'all' })
      .build();
    const out = (await agent.run('go')) as string;
    const history = (
      agent.getLastSnapshot()?.sharedState as {
        history: Array<{ toolCalls?: Array<{ id: string }> }>;
      }
    ).history;
    // The window dropped c1's assistant message from history…
    expect(history.some((m) => m.toolCalls?.some((c) => c.id === 'c1'))).toBe(false);
    // …the ledger kept its row, and the attachment carries its program.
    expect(scriptRows(agent).find((row) => row.toolCallId === 'c1')).toMatchObject({
      text: 'print(0)',
    });
    expect(out).toContain('Script submitted to `run_code` on call `c1` — completed, exit 0.');
  });
});
