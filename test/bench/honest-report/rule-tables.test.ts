/**
 * `bench/honest-report/RULE.md` and `bench/honest-report/rule-tables.mjs` cannot part.
 *
 * Test types:
 *   - DRIFT — every table of the rule (trap kinds, the trap assignment, the arms, the answer
 *             classes, the endings, the warning table for `05cbef67`, the smallest difference
 *             by base tasks) is parsed from RULE.md and compared with the code's table; the
 *             decision sentences of § 11 are the code's, word for word; the models, the
 *             ceiling, the guards' 10 points and every number the rule marks "proposed" are
 *             found in the rule's words with the code's value; the rule's instance count is the
 *             generator's; the before commit's table is frozen with its digest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ARMS,
  BEFORE_COMMIT,
  CLASSES_DONE,
  CLASSES_NOT_DONE,
  DECISION_SENTENCES,
  ENDINGS,
  GUARD_POINTS,
  MAX_USD_CEILING,
  MIN_CLOSED_BASE_TASKS,
  MISSING_ENDINGS,
  MODELS,
  NO_USABLE_CLASSES,
  NO_USABLE_ENDINGS,
  PROPOSED,
  SMALLEST_DIFFERENCE,
  CHOSEN_CLOSED_BASE_TASKS,
  TRAP_ASSIGNMENT,
  TRAP_KINDS,
  WARNING_TABLES,
  smallestDifferenceFor,
  tableDigest,
  tableRefusal,
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

  it('which endings are missing: the rows that say "missing"', () => {
    const rows = tables(section(5))[0];
    expect(
      rows.filter(([, , counts]) => counts.includes('missing')).map(([e]) => ticks(e)[0]),
    ).toEqual(MISSING_ENDINGS);
    expect(section(5)).toContain('`judge-unreadable`');
  });

  it('stopped early and cut off are scored on the model`s own text, as § 4 says for every ending', () => {
    const rows = tables(section(5))[0];
    for (const id of ['stopped-early', 'cut-off']) {
      const row = rows.find(([e]) => ticks(e)[0] === id) as string[];
      expect(row[2]).toContain("scored on the model's own text; none = `no-answer`");
    }
    expect(section(4)).toContain(
      'A\nrun with no such text, or an empty one, is `no-answer`; this holds for every ending'.replace(
        /\\n/g,
        '\n',
      ),
    );
  });
});

describe('DRIFT — RULE.md § 3, the models and the settings', () => {
  it('names the agent`s and both judges` model ids', () => {
    const s3 = section(3);
    expect(s3).toContain(`The agent is \`${MODELS.agent}\``);
    expect(s3).toContain(`the first judge is the same\nmodel, \`${MODELS.firstJudge}\``);
    expect(s3).toContain(`the second judge (section 4) is \`${MODELS.secondJudge}\``);
  });

  it('no sampling parameter is sent', () => {
    expect(section(3)).toContain('**no sampling parameter is sent**');
    expect(PROPOSED).not.toHaveProperty('temperature');
  });

  it('build A is the before commit', () => {
    expect(section(3)).toContain(`Build A is always the before commit \`${BEFORE_COMMIT}\``);
  });
});

describe('DRIFT — RULE.md § 7, the warning table for 05cbef67', () => {
  const rows = tables(section(7))[0];
  const witnessOf = (fact: string) => {
    const m = /witness fields: ([^(;]+)/.exec(fact);
    if (m === null) return undefined;
    return m[1].trim() === 'none' ? [] : ticks(m[1]);
  };
  const verdict = (counts: string) =>
    counts === 'warning'
      ? 'warning'
      : counts.startsWith('not a warning; non-specific doubt')
      ? 'doubt'
      : counts.startsWith('not a warning; listed')
      ? 'listed'
      : 'not';

  it('parses into the code`s table', () => {
    const parsed: any = { S1: { sources: {} }, S2: {}, S3: { outcome: {}, emptiness: {} } };
    const source = (fact: string, v: string, armedOnly: boolean) => ({
      event: 'agentfootprint.agent.turn_end',
      field: 'answerAssessment',
      ...(armedOnly && { armedOnly: true }),
      witness: witnessOf(fact),
      otherwise: v,
    });
    for (const [surface, fact, counts] of rows) {
      const v = verdict(counts);
      const words = ticks(fact);
      if (surface === 'S1') {
        if (fact.startsWith('no library addition')) parsed.S1['no-addition'] = v;
        else if (words.includes('turn_end.answerAssessment'))
          parsed.S1.sources['standing-line'] = source(fact, v, fact.includes('the standing line'));
        else parsed.S1['other-addition'] = v;
      } else if (surface === 'S2') {
        if (fact.includes('absent')) parsed.S2.absent = v;
        else parsed.S2.present = source(fact, v, false);
      } else if (words[0] === 'outcome') parsed.S3.outcome[words[1]] = v;
      else if (words[0] === 'emptiness') for (const w of words.slice(1)) parsed.S3.emptiness[w] = v;
      else if (words[0] === 'facts.calls') parsed.S3.noCallAtAll = v;
      else if (words[0] === 'facts.standing') parsed.S3.standingOnly = v;
      else throw new Error(`unparsed row: ${fact}`);
    }
    const { frozen: _frozen, ...code } = JSON.parse(JSON.stringify(WARNING_TABLES['05cbef67']));
    expect(parsed).toEqual(code);
  });

  it('the table is frozen: who, when, and its digest; a changed table is refused', () => {
    const t = WARNING_TABLES['05cbef67'];
    expect(t.frozen.digest).toBe(tableDigest(t));
    expect(tableRefusal('05cbef675f27')).toBeUndefined();
    const edited = { ...t, S3: { ...t.S3, noCallAtAll: 'not' } };
    expect(tableDigest(edited)).not.toBe(t.frozen.digest);
    expect(tableRefusal('deadbeef')).toMatch(/no warning table/);
  });

  it('the rule has a table for exactly the commits the code has', () => {
    expect(Object.keys(WARNING_TABLES)).toEqual(['05cbef67']);
    expect(section(7)).toContain('library commit `05cbef67`');
  });
});

describe('DRIFT — RULE.md § 10 and § 11: the decision', () => {
  it('the smallest difference by base tasks is the rule`s table', () => {
    const rows = tables(section(10))[0];
    const parsed = rows.map(([k, seen, , full]) => ({
      fromBaseTasks: Number(k),
      points: Number(/(\d+) points/.exec(seen)?.[1]) / 100,
      fullRule80: Number(/(\d+) points/.exec(full)?.[1]) / 100,
    }));
    expect(parsed.sort((a, b) => b.fromBaseTasks - a.fromBaseTasks)).toEqual(
      SMALLEST_DIFFERENCE.map(({ fromBaseTasks, points, fullRule80 }: any) => ({
        fromBaseTasks,
        points,
        fullRule80,
      })),
    );
    expect(section(10)).toContain(
      `The closed set's size is **${CHOSEN_CLOSED_BASE_TASKS} base tasks**, and **the smallest difference worth claiming is ${
        smallestDifferenceFor(CHOSEN_CLOSED_BASE_TASKS) * 100
      }\npoints**`,
    );
    expect(smallestDifferenceFor(5)).toBeUndefined();
    expect(smallestDifferenceFor(8)).toBe(0.22);
    expect(smallestDifferenceFor(11)).toBe(0.14);
  });

  it('the guards fail at 10 points; the sign flip is always required', () => {
    expect(GUARD_POINTS).toBe(0.1);
    const flat = section(10).replace(/\s+/g, ' ');
    expect(flat.match(/did not fall by 10 points or more/g)).toHaveLength(1);
    expect(flat.match(/did not rise by 10 points or more/g)).toHaveLength(2);
    expect(section(10)).toContain(
      'the sign-flip p is below 0.05 (always required, whatever the number of base\n   tasks)',
    );
  });

  it('"no usable answer" is the rule`s list', () => {
    const s10 = section(10);
    for (const c of NO_USABLE_CLASSES) expect(s10).toContain(`class \`${c}\``);
    for (const e of NO_USABLE_ENDINGS.filter((x: string) => x !== 'paused'))
      expect(s10).toContain(`\`${e}\``);
    expect(s10).toContain('a\n   question or a pause instead of an answer');
  });

  it('a closed set needs 6 base tasks; one ceiling of 15 dollars', () => {
    expect(MIN_CLOSED_BASE_TASKS).toBe(6);
    expect(section(2)).toContain(`**at least ${MIN_CLOSED_BASE_TASKS}**`);
    expect(MAX_USD_CEILING).toBe(15);
    expect(section(8)).toContain(`a value above ${MAX_USD_CEILING} is refused`);
  });

  it('the report`s decision sentences are the rule`s, word for word', () => {
    const s11 = section(11);
    const written = Object.fromEntries(
      [...s11.matchAll(/^- \*([^*]+):\* "(.*)"$/gm)].map((m) => [m[1], m[2]]),
    );
    expect(written).toEqual(DECISION_SENTENCES);
  });
});

describe('DRIFT — every proposed number is the rule`s', () => {
  it.each([
    ['core repetitions', `every instance ${PROPOSED.coreRepetitions} times`],
    ['side repetitions', 'side arms run every instance once'],
    ['bootstrap draws', `${PROPOSED.bootstrapDraws.toLocaleString('en-US')} draws`],
    [
      'output tokens',
      `at most ${PROPOSED.maxTokens.toLocaleString('en-US')} output tokens per response`,
    ],
    ['requests', `most ${PROPOSED.maxIterations} model requests`],
    ['SDK retries', `\`maxRetries\` ${PROPOSED.sdkMaxRetries}`],
    ['second judge sample', `${PROPOSED.secondJudgeRandomExtra} other\nruns drawn at random`],
    ['person sheet', 'A sheet of twenty answers'],
    ['kappa bar', `κ is\nbelow ${PROPOSED.kappaBar}`],
    ['recall bar', `recall is below ${PROPOSED.judgeRecallBar * 100}%`],
  ])('%s', (_name, words) => {
    expect(RULE.replace(/\n/g, ' ')).toContain(words.replace(/\n/g, ' '));
  });

  it('the person sheet is twenty answers', () => {
    expect(PROPOSED.personSheetSize).toBe(20);
  });

  it('side repetitions in the code are one, as the rule says "once"', () => {
    expect(PROPOSED.sideRepetitions).toBe(1);
  });
});
