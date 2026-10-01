/**
 * The REGISTERED RULE `time-rule-unread` (`bench/time/RULE-unread.md`) and its transcription
 * (`bench/time/rule-unread.mjs`).
 *
 * Test types:
 *   - UNIT  — the row reader labels a pending free-entry ask, an answered one, a prose ask and a
 *             model-written window from the record alone; U1 passes at exactly the gain and fails
 *             just under it; U2, U3, G1 and G2 each fail on their own breach; a one-arm sheet is
 *             refused;
 *   - DRIFT — every margin in RULE-unread.md's table equals `MARGINS`, and the cases the page
 *             names are the ones the code runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MARGINS,
  NEW_LINE_MARK,
  UNREAD_CASES,
  UNREAD_ONLY,
  judge,
  unreadRowOf,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/time/rule-unread.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'time', 'RULE-unread.md'),
  'utf8',
);

const NEW_LINE = `[A note …] ${NEW_LINE_MARK}yesterday morning”, so the next step is to call …`;
const OLD_LINE = '[A note …] The window for “yesterday morning” is not settled yet: …';

type Raw = Record<string, unknown>;

function raw(arm: string, caseId: string, rep: number, o: Raw = {}): Raw {
  const unread = UNREAD_ONLY.includes(caseId);
  return {
    key: `${arm}/${caseId}/r${rep}`,
    arm,
    caseId,
    rep,
    readLog: [],
    asks: [],
    requests: [{ timeLine: unread ? (arm === 'after' ? NEW_LINE : OLD_LINE) : 'clock' }],
    usage: { calls: 1 },
    usd: 0.002,
    ...(unread
      ? {
          pendingAsk: {
            question: 'q',
            fields: [{ id: 'f1', format: 'time-range', description: 'Which time?', offered: 0 }],
          },
          stuck: true,
        }
      : { answer: 'done' }),
    ...o,
  };
}

/** Both arms × every case × n reps; `patch(arm, caseId, i)` overrides a raw. */
function sheet(n: number, patch: (arm: string, caseId: string, i: number) => Raw = () => ({})) {
  const rows = [];
  for (const caseId of UNREAD_CASES)
    for (const arm of ['before', 'after'])
      for (let i = 0; i < n; i += 1)
        rows.push(unreadRowOf(raw(arm, caseId, i, patch(arm, caseId, i))));
  return rows;
}

/** A before-arm unread run that asked in prose: an answer with a question, no call, no ask. */
const prose: Raw = { answer: 'Which hours did you mean?', pendingAsk: undefined, stuck: false };

const clause = (v: { clauses: { id: string; pass: unknown }[] }, id: string) =>
  v.clauses.find((c) => c.id === id)?.pass;

describe('UNIT — the row reader', () => {
  it('a pending time-range field that offered nothing is the free-entry ask', () => {
    const r = unreadRowOf(raw('after', 'yesterday-morning', 0));
    expect(r).toMatchObject({
      freeEntry: true,
      unread: true,
      servedNewLine: true,
      proseAsk: false,
    });
  });

  it('an answered free-entry ask counts; a confirmation that offered a reading does not', () => {
    const answered = (offered: string[]) =>
      unreadRowOf(
        raw('after', 'last-week', 0, {
          pendingAsk: undefined,
          asks: [
            {
              question: 'q',
              fields: [{ id: 'f1', format: 'time-range', description: 'd' }],
              answers: [{ id: 'f1', kind: 'confirm', offered }],
            },
          ],
          answer: 'done',
        }),
      );
    expect(answered([]).freeEntry).toBe(true);
    expect(answered(['2026-10-02T00:00:00-07:00/2026-10-09T00:00:00-07:00']).freeEntry).toBe(false);
  });

  it('a prose question with no call is "asked in prose"; a read before any ask is "own window"', () => {
    expect(unreadRowOf(raw('before', 'yesterday-morning', 0, prose))).toMatchObject({
      freeEntry: false,
      proseAsk: true,
      servedNewLine: false,
    });
    const own = unreadRowOf(
      raw('before', 'last-week', 0, {
        pendingAsk: undefined,
        stuck: false,
        answer: '3 errors.',
        readLog: [{ tool: 'search_logs', window: { from: 1, to: 2 } }],
      }),
    );
    expect(own).toMatchObject({ ownWindow: true, proseAsk: false, freeEntry: false });
  });
});

describe('UNIT — the verdict', () => {
  // before: every unread run asks in prose; after: the ask opens on `k` of 15 per case.
  const withGain = (k: number) =>
    sheet(15, (arm, caseId, i) =>
      UNREAD_ONLY.includes(caseId) && (arm === 'before' || i >= k) ? prose : {},
    );

  it('PASS when the ask opens on every after run and never before', () => {
    const v = judge(withGain(15));
    expect(v.verdict).toBe('PASS');
    expect(v.clauses.map((c: { id: string }) => c.id)).toEqual(['U1', 'U2', 'U3', 'G1', 'G2']);
  });

  it('U1 passes at exactly the gain and fails just under it', () => {
    expect(clause(judge(withGain(6)), 'U1')).toBe(true); // 12/30 = 0.40
    expect(clause(judge(withGain(5)), 'U1')).toBe(false); // 10/30 ≈ 0.33
  });

  it('U2 fails when after’s controls stop completing', () => {
    const v = judge(
      sheet(15, (arm, caseId, i) =>
        UNREAD_ONLY.includes(caseId)
          ? arm === 'before'
            ? prose
            : {}
          : arm === 'after' && i < 4
          ? { answer: undefined, stuck: true }
          : {},
      ),
    );
    expect(clause(v, 'U2')).toBe(false);
  });

  it('U3 fails on one control time ask the before arm did not raise', () => {
    const v = judge(
      sheet(15, (arm, caseId, i) =>
        UNREAD_ONLY.includes(caseId)
          ? arm === 'before'
            ? prose
            : {}
          : arm === 'after' && caseId === 'c-node' && i === 0
          ? {
              asks: [
                {
                  question: 'q',
                  fields: [{ id: 'f1', format: 'time-range', description: 'd' }],
                  answers: [{ id: 'f1', offered: [] }],
                },
              ],
            }
          : {},
      ),
    );
    expect(clause(v, 'U3')).toBe(false);
  });

  it('G1 fails past the error rate; G2 fails when before served the new line', () => {
    const errors = judge(
      sheet(15, (arm, caseId, i) =>
        UNREAD_ONLY.includes(caseId) && arm === 'before'
          ? prose
          : arm === 'after' && i < 2
          ? { error: 'boom', answer: undefined, pendingAsk: undefined }
          : {},
      ),
    );
    expect(clause(errors, 'G1')).toBe(false);
    const leaked = judge(
      sheet(15, (arm, caseId) =>
        UNREAD_ONLY.includes(caseId) && arm === 'before'
          ? { ...prose, requests: [{ timeLine: NEW_LINE }] }
          : {},
      ),
    );
    expect(clause(leaked, 'G2')).toBe(false);
  });

  it('refuses a sheet without both arms', () => {
    expect(() => judge(sheet(2).filter((r: { arm: string }) => r.arm === 'after'))).toThrow(
      /arms before and after/,
    );
  });
});

describe('DRIFT — RULE-unread.md and the code cannot part', () => {
  it('every margin in the table equals MARGINS', () => {
    const table = RULE_MD.slice(RULE_MD.indexOf('## Margins'));
    const found: Record<string, number> = {};
    for (const m of table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) found[m[1]!] = Number(m[2]);
    expect(found).toEqual({ ...MARGINS });
  });

  it('the cases table names exactly the cases the code runs, unread first', () => {
    const table = RULE_MD.slice(
      RULE_MD.indexOf('## The cases'),
      RULE_MD.indexOf('## The protocol'),
    );
    const named = [...table.matchAll(/^\| (unread|control) \| `([a-z0-9-]+)` \|/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(named.map((n) => n[1])).toEqual([...UNREAD_CASES]);
    expect(named.filter((n) => n[0] === 'unread').map((n) => n[1])).toEqual([...UNREAD_ONLY]);
  });
});
