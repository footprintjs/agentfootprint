/**
 * The bounds over a long conversation (design § 4.4, § 10): one unit — UTF-8
 * payload bytes — and three separate claims, each asserted on its own:
 *
 *   (a) the ELIGIBLE script text the ledger holds — the UTF-8 bytes of every
 *       row that still holds `text` — never exceeds 16 × 32,768 = 512 KiB;
 *   (b) a judged answer is compared against this turn's rows only — at most
 *       32 blocks × 16 rows = 512 comparisons — and earlier turns' rows are
 *       counted, never matched;
 *   (c) prior-turn metadata grows by one fixed-shape row per call and holds
 *       no text.
 *
 * Nothing is asserted about the whole checkpoint or history, which this design
 * does not bound. The 40-turn walk drives the real writer, the real seed
 * restore and the real match over a ledger; a shorter run drives the same
 * through the agent loop end to end.
 */

import { describe, expect, it } from 'vitest';

import { MAX_CODE_REGIONS } from '../../../../src/core/agent/evidence/codeRegions.js';
import { readShownScripts } from '../../../../src/core/agent/scripts/match.js';
import {
  MAX_SCRIPT_BYTES,
  MAX_SCRIPT_ROWS,
  recordScriptRow,
  scriptRowFor,
  scriptRowsOfTurn,
  withoutEarlierScriptText,
} from '../../../../src/core/agent/scripts/rows.js';
import type { ScriptRow } from '../../../../src/core/agent/scripts/types.js';
import { wrapProgram } from '../../../../src/core/agent/scripts/wrapper.js';
import { utf8Length } from '../../../../src/lib/utf8.js';
import type { FindingsLedger } from '../../../../src/core/agent/findings/types.js';
import { answer, runnerAnswering, scriptAgent, scriptRows } from './fixtures/scriptAgent.js';

const BOUND = MAX_SCRIPT_ROWS * MAX_SCRIPT_BYTES; // 512 KiB

/** A program of exactly MAX_SCRIPT_BYTES UTF-8 bytes — 3-byte characters for odd calls. */
function programFor(turn: number, call: number): string {
  const head = `# t${turn} c${call}\n`;
  if (call % 2 === 1) {
    const rest = MAX_SCRIPT_BYTES - utf8Length(head);
    const threes = Math.floor(rest / 3);
    return head + '€'.repeat(threes) + 'x'.repeat(rest - threes * 3);
  }
  return head + 'y'.repeat(MAX_SCRIPT_BYTES - utf8Length(head));
}

const textBytes = (ledger: FindingsLedger): number =>
  ledger.reduce((sum, row) => {
    const text =
      (row as Partial<ScriptRow>).kind === 'script' ? (row as ScriptRow).text : undefined;
    return sum + (text === undefined ? 0 : utf8Length(text));
  }, 0);

describe('40 turns × 16 calls of 32,768 bytes, 32 blocks per answer', () => {
  // 40 turns of 17 programs of 32 KiB each: seconds under coverage instrumentation.
  it(
    '(a) eligible text ≤ 512 KiB; (b) ≤ 512 comparisons, earlier rows never matched; (c) metadata one row per call, no text',
    { timeout: 60_000 },
    () => {
      const scope: { findingsLedger?: FindingsLedger; scriptsDropped?: number } = {};
      let maxText = 0;
      let previousTurnPrograms: string[] = [];
      for (let turn = 1; turn <= 40; turn++) {
        // The seed restore at the turn boundary: earlier turns' rows lose their text.
        if (scope.findingsLedger !== undefined) {
          scope.findingsLedger = [...withoutEarlierScriptText(scope.findingsLedger, turn)];
          // Nothing an earlier turn submitted is eligible any more.
          expect(textBytes(scope.findingsLedger)).toBe(0);
        }
        const programs: string[] = [];
        // 16 calls keep a row; the 17th is dropped and counted.
        for (let call = 1; call <= MAX_SCRIPT_ROWS + 1; call++) {
          const program = programFor(turn, call);
          programs.push(program);
          const row = scriptRowFor({
            script: { argument: 'code', language: 'python' },
            tool: 'run_code',
            toolCallId: `c${call}`,
            iteration: 1,
            turn,
            proposed: program,
            settlement: 'returned',
            facts: { exitCode: 0 },
          })!;
          expect(row.bytes).toBe(MAX_SCRIPT_BYTES);
          expect(row.text).toBe(program);
          recordScriptRow(scope, row);
        }
        // Within a turn the text only grows (rows are appended), so the turn's
        // end is its high-water mark; the restore above empties it again.
        maxText = Math.max(maxText, textBytes(scope.findingsLedger ?? []));
        expect(scope.scriptsDropped).toBe(turn);

        // (a) at every moment, the text the ledger holds is one turn's worth at most.
        expect(textBytes(scope.findingsLedger ?? [])).toBeLessThanOrEqual(BOUND);

        // (b) an answer with 32 blocks: this turn's programs and the previous turn's.
        const shown = [...programs.slice(0, MAX_SCRIPT_ROWS), ...previousTurnPrograms].slice(
          0,
          MAX_CODE_REGIONS + 4,
        );
        const answerText = shown.map((p) => wrapProgram(p, 'python')).join('\n\n');
        const rows = scriptRowsOfTurn(scope.findingsLedger, turn);
        expect(rows.current.length).toBeLessThanOrEqual(MAX_SCRIPT_ROWS);
        const { verdict } = readShownScripts(answerText, rows, scope.scriptsDropped);
        expect(verdict.blocks.length).toBeLessThanOrEqual(MAX_CODE_REGIONS);
        expect(verdict.blocks.length * rows.current.length).toBeLessThanOrEqual(512);
        // This turn's programs match; an EARLIER turn's never does — counted instead.
        for (const block of verdict.blocks) {
          const program = shown[block.block - 1]!;
          if (programs.slice(0, MAX_SCRIPT_ROWS).includes(program)) {
            expect(block.label).toBe('completed');
          } else {
            expect(block).toMatchObject({ label: 'unmatched' });
          }
        }
        expect(verdict.earlierTurnRows).toBe((turn - 1) * MAX_SCRIPT_ROWS);
        previousTurnPrograms = programs.slice(0, MAX_SCRIPT_ROWS);
      }
      expect(maxText).toBeLessThanOrEqual(BOUND);

      // (c) prior-turn metadata: one fixed-shape row per kept call, and no text.
      const ledger = scope.findingsLedger ?? [];
      expect(ledger).toHaveLength(40 * MAX_SCRIPT_ROWS);
      const prior = ledger.filter((row) => (row as ScriptRow).turn < 40) as ScriptRow[];
      expect(prior).toHaveLength(39 * MAX_SCRIPT_ROWS);
      const keys = new Set(prior.map((row) => Object.keys(row).sort().join(',')));
      expect(keys.size).toBe(1);
      expect(prior.every((row) => row.text === undefined && row.bytes === MAX_SCRIPT_BYTES)).toBe(
        true,
      );
    },
  );
});

describe('end to end — the agent loop keeps the same bounds across turns', () => {
  it('16 calls a turn keep rows, the 17th is counted; earlier turns keep metadata, lose text', async () => {
    const batch = (turn: number) => ({
      content: '',
      toolCalls: Array.from({ length: MAX_SCRIPT_ROWS + 1 }, (_, i) => ({
        id: `t${turn}c${i}`,
        name: 'run_code',
        args: { code: `print(${turn * 100 + i})` },
      })),
      stopReason: 'tool_use' as const,
    });
    const r = scriptAgent({
      runner: runnerAnswering({ ok: true, exitCode: 0, stdout: 'ok', stderr: '' }),
      gate: { posture: 'assist', code: 'match' },
      maxIterations: 4,
      replies: [batch(1), answer('one'), batch(2), answer('two'), batch(3), answer('three')],
    });
    await r.agent.run('turn 1');
    for (const turn of [2, 3]) {
      await r.agent.run({ message: `turn ${turn}`, continueFrom: r.agent.checkpoint()! });
    }
    const rows = scriptRows(r.agent);
    const byTurn = (turn: number) => rows.filter((row) => row.turn === turn);
    expect(byTurn(3)).toHaveLength(MAX_SCRIPT_ROWS);
    expect(byTurn(3).every((row) => typeof row.text === 'string')).toBe(true);
    for (const turn of [1, 2]) {
      expect(byTurn(turn)).toHaveLength(MAX_SCRIPT_ROWS);
      expect(byTurn(turn).every((row) => !('text' in row))).toBe(true);
    }
    // The call past the per-turn rows filed no row and is counted.
    expect(
      (r.agent.getLastSnapshot()?.sharedState as { scriptsDropped?: number }).scriptsDropped,
    ).toBe(1);
    expect(r.checks.at(-1)!.scripts).toMatchObject({ earlierTurnRows: 2 * MAX_SCRIPT_ROWS });
  });
});
