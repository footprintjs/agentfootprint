/**
 * `bench/honest-report/RULE.md` and `bench/honest-report/rule-tables.mjs` cannot part.
 *
 * Test types:
 *   - DRIFT — every table of the rule (trap kinds, the trap assignment, the arms, the answer
 *             classes, the endings, the warning table for `05cbef67`) is parsed from RULE.md and
 *             compared with the code's table; every number the rule marks "proposed" is found in
 *             the rule's words with the code's value; the rule's instance count is the
 *             generator's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ARMS,
  CLASSES_DONE,
  CLASSES_NOT_DONE,
  ENDINGS,
  PROPOSED,
  TRAP_ASSIGNMENT,
  TRAP_KINDS,
  WARNING_TABLES,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/honest-report/rule-tables.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { loadSet } from '../../../bench/honest-report/tasks/sets.mjs';

const RULE = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'honest-report', 'RULE.md'),
  'utf8',
);

/** The section of RULE.md under the heading that starts with `## <n>.`. */
function section(n: number): string {
  const start = RULE.indexOf(`\n## ${n}. `);
  const end = RULE.indexOf('\n## ', start + 1);
  return RULE.slice(start, end < 0 ? undefined : end);
}

/** Markdown tables of a text, as rows of cells (header row and separator dropped). */
function tables(text: string): string[][][] {
  const out: string[][][] = [];
  let current: string[][] | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (current === undefined) current = [cells];
      else current.push(cells);
    } else if (current !== undefined) {
      out.push(current.slice(2));
      current = undefined;
    }
  }
  if (current !== undefined) out.push(current.slice(2));
  return out;
}

const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('DRIFT — RULE.md § 2', () => {
  const [kinds, assignment] = tables(section(2));

  it('the trap kinds and their loudness', () => {
    expect(kinds.map(([trap, loud]) => ({ id: ticks(trap)[0], loudness: loud }))).toEqual(
      TRAP_KINDS,
    );
  });

  it('which traps each base task carries', () => {
    const parsed = Object.fromEntries(
      assignment.map(([task, kind, loud, silent]) => [
        ticks(task)[0],
        { kind, loud: ticks(loud), silent: ticks(silent) },
      ]),
    );
    expect(parsed).toEqual(TRAP_ASSIGNMENT);
  });

  it('at least half of every base task`s traps are silent', () => {
    for (const row of Object.values(TRAP_ASSIGNMENT) as { loud: string[]; silent: string[] }[])
      expect(row.silent.length).toBeGreaterThanOrEqual(row.loud.length);
  });

  it('the instance count the rule states is the generator`s', () => {
    const stated = Number(/= (\d+) instances/.exec(section(2))?.[1]);
    expect(loadSet().instances).toHaveLength(stated);
  });
});

describe('DRIFT — RULE.md § 3, § 4, § 5', () => {
  it('the arms', () => {
    expect(tables(section(3))[0].map(([arm]) => ticks(arm)[0])).toEqual(
      ARMS.map((a: { id: string }) => a.id),
    );
  });

  it('the answer classes when the end state is not done, and which count in measure 1', () => {
    const rows = tables(section(4))[0];
    expect(
      rows.map(([cls, , counts]) => ({ id: ticks(cls)[0], inMeasure1: counts === 'yes' })),
    ).toEqual(CLASSES_NOT_DONE);
  });

  it('the answer classes when the end state is done', () => {
    const s4 = section(4);
    const start = s4.indexOf('For a run whose end state is `done`');
    const paragraph = s4.slice(start, s4.indexOf('\n\n', start)).replace(/\([^)]*\)/g, '');
    expect(ticks(paragraph).slice(1)).toEqual(CLASSES_DONE);
  });

  it('the endings and whether each stays in the denominator', () => {
    const rows = tables(section(5))[0];
    expect(
      rows.map(([ending, , , inDen]) => ({
        id: ticks(ending)[0],
        inDenominator: inDen.startsWith('yes'),
      })),
    ).toEqual(
      ENDINGS.map((e: { id: string; inDenominator: boolean }) => ({
        id: e.id,
        inDenominator: e.inDenominator,
      })),
    );
  });
});

describe('DRIFT — RULE.md § 7, the warning table for 05cbef67', () => {
  const rows = tables(section(7))[0];
  const verdict = (counts: string) =>
    counts === 'warning'
      ? 'warning'
      : counts.startsWith('not a warning; non-specific doubt')
      ? 'doubt'
      : counts.startsWith('not a warning; listed')
      ? 'listed'
      : 'not';

  it('parses into the code`s table', () => {
    const parsed: any = { S1: {}, S2: {}, S3: { outcome: {}, emptiness: {} } };
    for (const [surface, fact, counts] of rows) {
      const v = verdict(counts);
      const words = ticks(fact);
      if (surface === 'S1')
        parsed.S1[
          fact.startsWith('no library addition')
            ? 'no-addition'
            : words.includes('turn_end.answerAssessment')
            ? 'standing-line'
            : 'other-addition'
        ] = v;
      else if (surface === 'S2') parsed.S2[fact.includes('absent') ? 'absent' : 'present'] = v;
      else if (words[0] === 'outcome') parsed.S3.outcome[words[1]] = v;
      else if (words[0] === 'emptiness') for (const w of words.slice(1)) parsed.S3.emptiness[w] = v;
      else if (words[0] === 'facts.calls') parsed.S3.noCallAtAll = v;
      else if (words[0] === 'facts.standing') parsed.S3.standingOnly = v;
      else throw new Error(`unparsed row: ${fact}`);
    }
    expect(parsed).toEqual(JSON.parse(JSON.stringify(WARNING_TABLES['05cbef67'])));
  });

  it('the rule has a table for exactly the commits the code has', () => {
    expect(Object.keys(WARNING_TABLES)).toEqual(['05cbef67']);
    expect(section(7)).toContain('library commit `05cbef67`');
  });
});

describe('DRIFT — every proposed number is the rule`s', () => {
  it.each([
    ['smallest difference', `${PROPOSED.smallestDifference * 100} percentage points`],
    ['core repetitions', `every instance ${PROPOSED.coreRepetitions} times`],
    ['side repetitions', 'side arms run every instance once'],
    ['bootstrap draws', `${PROPOSED.bootstrapDraws.toLocaleString('en-US')} draws`],
    ['temperature', `temperature ${PROPOSED.temperature} (sent explicitly`],
    ['output tokens', `at\nmost ${PROPOSED.maxTokens.toLocaleString('en-US')} output tokens`],
    ['requests', `most ${PROPOSED.maxIterations} model requests`],
    ['SDK retries', `\`maxRetries\` ${PROPOSED.sdkMaxRetries}`],
    ['person sample', `${PROPOSED.personRandomExtra} other free-text runs`],
    ['second reader', `re-reads ${PROPOSED.personSecondReader} of them`],
    ['kappa bar', `κ is below ${PROPOSED.kappaBar}`],
    ['judge sensitivity', `fewer than ${PROPOSED.judgeSensitivityBar * 100}%`],
    ['sign flip from', `at least ${PROPOSED.signFlipNeededFromBaseTasks} base tasks`],
  ])('%s', (_name, words) => {
    expect(RULE.replace(/\n/g, ' ')).toContain(words.replace(/\n/g, ' '));
  });

  it('side repetitions in the code are one, as the rule says "once"', () => {
    expect(PROPOSED.sideRepetitions).toBe(1);
  });
});
