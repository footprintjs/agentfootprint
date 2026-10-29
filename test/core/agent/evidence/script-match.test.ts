/**
 * The match rule (design docs/design/2026-10-script-artifact.md § 5): a fenced
 * block is script content only when it equals, byte for byte after removing the
 * Markdown wrapper, a program ONE call of THIS turn submitted to a declared
 * code-running tool. Code is never evidence: a match yields no candidates and
 * grounds nothing; a miss is prose, checked as today.
 *
 * Functional (match / miss) · Security (the review's counterexamples, laundering,
 * rewritten scripts, factual text in a fence) · Edge (multibyte bounds, earlier
 * turns, undeclared tools) · Property (seeded: any program round-trips, any
 * one-byte change misses).
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  codeRunnerTool,
  defineTool,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { readShownScripts } from '../../../../src/core/agent/scripts/match.js';
import {
  MAX_SCRIPT_BYTES,
  scriptRowFor,
  scriptRowsOfTurn,
} from '../../../../src/core/agent/scripts/rows.js';
import { wrapProgram } from '../../../../src/core/agent/scripts/wrapper.js';
import type { ScriptRow } from '../../../../src/core/agent/scripts/types.js';
import { seeded } from '../../../helpers/seededText.js';
import {
  answer,
  callCode,
  fenced,
  runnerAnswering,
  scriptAgent,
  scriptRows,
  stateOf,
} from './fixtures/scriptAgent.js';

/** A runner that ran the program and printed `out`, exit 0. */
const printing = (out: string) =>
  runnerAnswering({ ok: true, exitCode: 0, stdout: out, stderr: '' });

/** A turn-1 row for `program`, as the dispatch loop files it. */
const rowFor = (program: string, id = 'c1', turn = 1): ScriptRow =>
  scriptRowFor({
    script: { argument: 'code', language: 'python' },
    tool: 'run_code',
    toolCallId: id,
    iteration: 1,
    turn,
    proposed: { code: program },
    settlement: 'returned',
    facts: { ok: true, exitCode: 0 },
  })!;

const read = (answerText: string, rows: readonly ScriptRow[]) =>
  readShownScripts(answerText, { current: rows, earlier: 0 });

const PROGRAM = 'threshold = 0.01\nprint(f"{0.0421:.2f}")\nprint(sum([1200, 2400]))';

describe('functional — a block that equals a submission is script content', () => {
  it('the script submitted, shown byte for byte → matched, labelled, no candidates from it', async () => {
    const { agent, checks } = scriptAgent({
      runner: printing('3600'),
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', PROGRAM), answer(`The total is 3600.\n\n${fenced(PROGRAM)}`)],
    });
    await agent.run('total?');
    const check = checks.at(-1)!;
    expect(check.action).toBe('grounded');
    expect(check.unsupported).toEqual([]);
    expect(check.scripts).toEqual({
      blocks: [{ block: 1, label: 'completed', exitCode: 0, toolCallId: 'c1', tool: 'run_code' }],
      earlierTurnRows: 0,
      regionsDropped: 0,
    });
  });

  it('an invented constant inside a real script is not flagged; the same constant in the prose is', async () => {
    const program = 'threshold = 98765\nprint(1)';
    const { agent, checks } = scriptAgent({
      runner: printing('1'),
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', program), answer(`The threshold was 98765.\n\n${fenced(program)}`)],
    });
    await agent.run('go');
    const check = checks.at(-1)!;
    expect(check.unsupported).toEqual([{ value: '98765', shape: 'number', region: 'prose' }]);
    expect((check.scripts as { blocks: unknown[] }).blocks).toHaveLength(1);
  });

  it('under code: check (the default) the same answer reads the whole block as prose', async () => {
    const program = 'threshold = 98765\nprint(1)';
    const { agent, checks } = scriptAgent({
      runner: printing('1'),
      gate: { posture: 'assist' },
      replies: [callCode('c1', program), answer(`Done.\n\n${fenced(program)}`)],
    });
    await agent.run('go');
    expect(checks.at(-1)!.unsupported).toEqual([{ value: '98765', shape: 'number' }]);
    expect(checks.at(-1)!.scripts).toBeUndefined();
    expect(scriptRows(agent)).toEqual([]);
  });
});

describe('functional — a block that equals no submission is prose, labelled unmatched', () => {
  it('an ALTERED script (one constant changed) is a miss; the changed constant is flagged as code', async () => {
    const altered = PROGRAM.replace('1200', '1300');
    const { agent, checks } = scriptAgent({
      runner: printing('3600'),
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', PROGRAM), answer(`Total: 3600.\n\n${fenced(altered)}`)],
    });
    await agent.run('total?');
    const check = checks.at(-1)!;
    expect(check.scripts).toMatchObject({
      blocks: [{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }],
    });
    const values = check.unsupported as Array<{ value: string; region?: string }>;
    expect(values).toContainEqual({ value: '1300', shape: 'number', region: 'code' });
    // The block was read as prose: its constants are candidates, the unchanged ones flagged too.
    expect(values.map((v) => v.value)).toContain('2400');
  });

  it('factual text in a ```text fence is a miss: 1200 is flagged', async () => {
    const { agent, checks } = scriptAgent({
      runner: printing('ok'),
      gate: { posture: 'assist', code: 'match' },
      replies: [
        callCode('c1', 'print("ok")'),
        answer(fenced('Customer B owes 1200 dollars.', 'text')),
      ],
    });
    await agent.run('who owes?');
    const check = checks.at(-1)!;
    expect(check.scripts).toMatchObject({ blocks: [{ label: 'unmatched' }] });
    expect(check.unsupported).toEqual([{ value: '1200', shape: 'number', region: 'code' }]);
  });

  it('a copy with ONE trailing blank line added is a miss', () => {
    const verdict = read(fenced(`${PROGRAM}\n`), [rowFor(PROGRAM)]).verdict;
    expect(verdict.blocks[0]).toMatchObject({
      label: 'unmatched',
      reason: 'no-submission-this-turn',
    });
  });
});

describe("security — the review's counterexamples are misses, in both directions", () => {
  const withSpaces = 'print(len("""A  \nB"""))';
  const withoutSpaces = 'print(len("""A\nB"""))';
  const decomposed = 'print(len("é"))';
  const composed = 'print(len("é"))';

  it.each([
    ['trailing spaces inside a literal', withSpaces, withoutSpaces],
    ['trailing spaces inside a literal (reverse)', withoutSpaces, withSpaces],
    ['a combining mark vs its NFC form', decomposed, composed],
    ['an NFC form vs the combining mark (reverse)', composed, decomposed],
  ])('%s', (_label, submitted, shown) => {
    expect(shown).not.toBe(submitted);
    const { verdict, prose } = read(fenced(shown), [rowFor(submitted)]);
    expect(verdict.blocks).toEqual([
      { block: 1, label: 'unmatched', reason: 'no-submission-this-turn' },
    ]);
    // A miss stays in the text the gate reads.
    expect(prose).toContain(shown);
  });

  it('tokens from an unrelated call’s ARGUMENTS never count — with and without a matched block', async () => {
    const lookup = 'secret = 77777\nprint("done")';
    const shown = 'print(2 + 2)';
    for (const withBlock of [false, true]) {
      const { agent, checks } = scriptAgent({
        runner: printing('done'),
        gate: { posture: 'assist', code: 'match' },
        replies: [
          callCode('c1', lookup),
          callCode('c2', shown),
          answer(`The secret is 77777.${withBlock ? `\n\n${fenced(shown)}` : ''}`),
        ],
      });
      await agent.run('secret?');
      expect(checks.at(-1)!.unsupported).toEqual([
        { value: '77777', shape: 'number', region: 'prose' },
      ]);
    }
  });

  it('two byte-identical submissions: the LATEST is named, the rest counted', () => {
    const { verdict } = read(fenced(PROGRAM), [rowFor(PROGRAM, 'c1'), rowFor(PROGRAM, 'c2')]);
    expect(verdict.blocks).toEqual([
      {
        block: 1,
        label: 'completed',
        exitCode: 0,
        toolCallId: 'c2',
        tool: 'run_code',
        alsoMatches: 1,
      },
    ]);
  });

  it('two submissions one byte apart: the block equals at most one of them', () => {
    const other = `${PROGRAM} `;
    const { verdict } = read(fenced(other), [rowFor(PROGRAM, 'c1'), rowFor(other, 'c2')]);
    expect(verdict.blocks).toEqual([
      { block: 1, label: 'completed', exitCode: 0, toolCallId: 'c2', tool: 'run_code' },
    ]);
  });

  it('a REWRITTEN script: the original is a miss, the submitted text matches, the earlier text is on no row or event', async () => {
    const original = 'print("draft 4242")';
    const submitted = 'print("safe")';
    const rewrite: ToolMiddleware = {
      name: 'swap-program',
      onToolCall: (c) =>
        c.toolName === 'run_code' ? allow({ ...c.args, code: submitted }, 'policy') : allow(),
    };
    const run = async (shown: string) => {
      const events: Array<{ name: string; payload: unknown }> = [];
      const agent = Agent.create({
        provider: mock({ replies: [callCode('c1', original), answer(fenced(shown))] as never }),
        model: 'mock',
        maxIterations: 4,
      })
        .tool(codeRunnerTool({ runner: printing('safe') }))
        .toolMiddleware(rewrite)
        .namesAndNumbersFromEvidence({ posture: 'assist', code: 'match' })
        .watch({
          id: 'all',
          onEmit: (e: { name: string; payload?: unknown }) =>
            events.push({ name: e.name, payload: e.payload }),
        })
        .build();
      await agent.run('go');
      return { agent, events };
    };
    const asProposed = await run(original);
    const evidence = asProposed.events.filter(
      (e) => e.name === 'agentfootprint.agent.evidence_checked',
    );
    expect((evidence.at(-1)!.payload as { scripts: { blocks: unknown[] } }).scripts.blocks).toEqual(
      [{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }],
    );
    const rows = scriptRows(asProposed.agent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: submitted, rewritten: true, outcome: 'completed' });
    // The earlier text is on no ROW and on no script-record event (history keeps the emission).
    expect(JSON.stringify(stateOf(asProposed.agent).findingsLedger)).not.toContain('4242');
    for (const e of asProposed.events.filter((x) => /evidence_checked|code_run/.test(x.name))) {
      expect(JSON.stringify(e.payload)).not.toContain('draft 4242');
    }

    const asSubmitted = await run(submitted);
    const matched = asSubmitted.events.filter(
      (e) => e.name === 'agentfootprint.agent.evidence_checked',
    );
    expect((matched.at(-1)!.payload as { scripts: { blocks: unknown[] } }).scripts.blocks).toEqual([
      { block: 1, label: 'completed', exitCode: 0, toolCallId: 'c1', tool: 'run_code' },
    ]);
  });
});

describe('edge — one unit: UTF-8 payload bytes', () => {
  it('32,768 characters of a 3-byte character (98,304 bytes) are over the bound: unmatched over-size', async () => {
    const big = '€'.repeat(32_768);
    const { agent, checks } = scriptAgent({
      runner: printing('ok'),
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', big), answer(fenced(big, ''))],
    });
    await agent.run('go');
    expect((checks.at(-1)!.scripts as { blocks: unknown[] }).blocks).toEqual([
      { block: 1, label: 'unmatched', reason: 'over-size' },
    ]);
    const [row] = scriptRows(agent);
    expect(row).toMatchObject({ bytes: 98_304, outcome: 'completed' });
    expect(row).not.toHaveProperty('text');
  });

  it('10,922 characters of it (32,766 bytes) are within the bound: matched; `bytes` is the UTF-8 length', async () => {
    const fits = '€'.repeat(10_922);
    const { agent, checks } = scriptAgent({
      runner: printing('ok'),
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', fits), answer(fenced(fits, ''))],
    });
    await agent.run('go');
    expect((checks.at(-1)!.scripts as { blocks: Array<{ label: string }> }).blocks[0]!.label).toBe(
      'completed',
    );
    const [row] = scriptRows(agent);
    expect(row).toMatchObject({ bytes: 32_766, text: fits });
    expect(32_766).toBeLessThanOrEqual(MAX_SCRIPT_BYTES);
  });

  it('a block equal to an EARLIER turn’s program is a miss of THIS turn, the earlier row counted', async () => {
    const replies = [
      callCode('c1', PROGRAM),
      answer('First turn done.'),
      answer(`Again:\n\n${fenced(PROGRAM)}`),
    ];
    const first = scriptAgent({
      runner: printing('3600'),
      gate: { posture: 'assist', code: 'match' },
      replies,
    });
    await first.agent.run('turn one');
    const checkpoint = first.agent.checkpoint()!;
    await first.agent.run({ message: 'turn two', continueFrom: checkpoint });
    const check = first.checks.at(-1)!;
    expect(check.scripts).toEqual({
      blocks: [{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }],
      earlierTurnRows: 1,
      regionsDropped: 0,
    });
    // The earlier turn's row kept its facts and lost its text at the turn boundary.
    const [earlier] = scriptRows(first.agent);
    expect(earlier).toMatchObject({ toolCallId: 'c1', turn: 1, outcome: 'completed' });
    expect(earlier).not.toHaveProperty('text');
  });

  it('an earlier turn’s row that still HOLDS its text is never compared — the turn alone decides', () => {
    // The seed drops earlier text at the restore door; this pins the match's own
    // rule without that help: a ledger handed over with a turn-1 row intact.
    const ledger = [rowFor(PROGRAM, 'c1', 1)];
    expect(ledger[0]).toHaveProperty('text', PROGRAM);
    const turn = scriptRowsOfTurn(ledger, 2);
    expect(turn).toEqual({ current: [], earlier: 1 });
    const { verdict, prose } = readShownScripts(fenced(PROGRAM), turn);
    expect(verdict).toEqual({
      blocks: [{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }],
      earlierTurnRows: 1,
      regionsDropped: 0,
    });
    expect(prose).toContain(PROGRAM);
    // The same row read for its own turn matches.
    expect(scriptRowsOfTurn(ledger, 1)).toEqual({ current: ledger, earlier: 0 });
  });

  it('a tool that does NOT declare `script` files no submission: every block is a miss', async () => {
    const undeclared = defineTool<{ code: string }, string>({
      name: 'run_code',
      description: 'runs code (but does not say so)',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
      execute: () => 'ok',
    });
    const { agent, checks } = scriptAgent({
      tools: [undeclared],
      gate: { posture: 'assist', code: 'match' },
      replies: [callCode('c1', 'print(4444)'), answer(fenced('print(4444)'))],
    });
    await agent.run('go');
    expect(checks.at(-1)!.scripts).toMatchObject({
      blocks: [{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }],
    });
    expect(scriptRows(agent)).toEqual([]);
  });
});

describe('property — the library’s attachment unwraps to the program; any one-byte change misses', () => {
  const PIECES = [
    'a',
    ' ',
    '\n',
    '\r',
    '\r\n',
    '\t',
    '`',
    '```',
    '~~~',
    'é',
    'é',
    '"""',
    '0.01',
    '😀',
  ];
  const next = seeded(20261029);
  const programs = Array.from({ length: 300 }, () => {
    let p = '';
    const n = Math.floor(next() * 12);
    for (let i = 0; i < n; i++) p += PIECES[Math.floor(next() * PIECES.length)];
    return p;
  });

  it('for every program, the attachment with its wrapper removed equals the program byte for byte', () => {
    for (const program of programs) {
      const { verdict } = read(`Answer.\n\n${wrapProgram(program, 'python')}\n`, [rowFor(program)]);
      expect(verdict.blocks).toEqual([
        { block: 1, label: 'completed', exitCode: 0, toolCallId: 'c1', tool: 'run_code' },
      ]);
    }
  });

  it('any single change anywhere in the content — a space, a line ending, a combining mark, a byte in a literal — is a miss', () => {
    const edits: Array<(p: string, at: number) => string> = [
      (p, at) => `${p.slice(0, at)} ${p.slice(at)}`,
      (p, at) => `${p.slice(0, at)}\r${p.slice(at)}`,
      (p, at) => `${p.slice(0, at)}́${p.slice(at)}`,
      (p, at) => (at < p.length ? `${p.slice(0, at)}${p.slice(at + 1)}` : `${p}x`),
    ];
    for (const program of programs) {
      for (const edit of edits) {
        const at = Math.floor(next() * (program.length + 1));
        const changed = edit(program, at);
        if (changed === program) continue;
        const { verdict } = read(wrapProgram(changed, 'python'), [rowFor(program)]);
        expect(verdict.blocks[0]).toMatchObject({ label: 'unmatched' });
      }
    }
  });
});
