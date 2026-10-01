/**
 * The ONE served time line's voice (time follow-ups, packet "serving";
 * `agent/arguments/serve.ts` · `timeLine`, `pendingSentence`;
 * `coverage/period.ts` · `periodCheckLine`).
 *
 * Law: the late time line opens ONCE with who says it — the library, not the
 * person, and not a correction from them — whichever halves it holds; a
 * sentence about an unconfirmed window says what the library holds, never what
 * the person did not do; a quote the library holds no reading of says its form
 * asks for the zone, never that it shows a reading; a shifted read is served to
 * the model as its conclusion — the part of the window the result does not
 * cover, in the person's zone, and that the answer says so.
 *
 * Why: the T6b paid run (Haiku 4.5, `bench/time/runs/haiku45-t6b-r1`) — after
 * the unmarked "the person has not confirmed it" sentence, 37 of 37 answers
 * opened "You're right… I apologize"; the T8 bench — after a pause the
 * two-range "shifted window" line did not stop claims about the asked window
 * (11/20).
 *
 * Test types:
 *   unit          — `readerWindowsOf` names a zone-only pending quote in `pendingZones`;
 *                   the pending half's three form clauses; the shifted conclusion's two shapes;
 *   property      — over seeded random halves, the opening is said exactly once, first;
 *                   over seeded shifted ranges, the conclusion names exactly the missing range;
 *   byte identity — no `pendingZones` serves the pending half's earlier bytes; the PERSON's
 *                   shifted line keeps its bytes; the halves themselves carry no opening.
 * Functional/scenario through real agents: english-run.test.ts (zone-only, unconfirmed),
 * limits-served.test.ts (the shifted read after a check-in pause, `timeLine`);
 * registration: test/modelFacingSurfaces.test.ts; the rebuild: receipt-conformance.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { defineTool } from '../../../src/index.js';
import { readerWindowsOf } from '../../../src/core/time/bind.js';
import type { ClockRow, TimeReadingRow } from '../../../src/core/time/rows.js';
import { bindPresentation } from '../../../src/core/time/present.js';
import { periodCheckLine } from '../../../src/core/agent/coverage/period.js';
import {
  TIME_LINE_SOURCE,
  timeLine,
  timeWindowsLine,
} from '../../../src/core/agent/arguments/serve.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const FIELD = '10/09/26 8 AM to 8:40 AM PST';

const clock: ClockRow = {
  kind: 'clock',
  turn: 1,
  iteration: 1,
  now: NOW,
  nowSource: 'app',
  zone: LA,
  zoneSource: 'run',
};

/** A rule reading of `quote`: open on `open`, with `n` candidates (none for a zone it cannot resolve). */
function reading(quote: string, mention: number, n: number, open: string[]): TimeReadingRow {
  const range = { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' };
  return {
    kind: 'time-reading',
    turn: 1,
    iteration: 1,
    reader: { id: 'fixture/rule', version: '1', kind: 'rule', locale: 'en-US' },
    tzdata: 'unknown',
    mentions: 2,
    mention,
    quote,
    parses: [],
    candidates: Array.from({ length: n }, (_, i) => ({
      window: { kind: 'range', range },
      range,
      zone: LA,
      grain: 'day',
      said: [],
      implied: [],
      anchor: 'message',
      reader: { id: 'fixture/rule', kind: 'rule' },
      notes: [],
      reading: {},
      parse: i,
    })),
    choice: { by: 'open', remaining: Array.from({ length: n }, (_, i) => i), open },
  } as TimeReadingRow;
}

const epoch = defineTool({
  name: 'client_activity',
  description: 'Client operations over a window.',
  inputSchema: {
    type: 'object',
    properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
  },
  askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'start_time', as: 'epoch-ms' },
        to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
      },
    ],
  } as never,
  execute: () => 'ok',
});
const winning = new Map<string, unknown>([['client_activity', epoch]]);
const served = [(epoch as unknown as { schema: unknown }).schema];
const halves = (windows: object) =>
  timeWindowsLine(served as never, winning as never, windows as never);

const TAIL =
  ' client_activity is called with start_time, end_time left out (or the call is refused with ' +
  'the reason). So the next step is that call — not a question about the time in the reply, ' +
  'and not a window written into the call, which would run unconfirmed.';

/** A small seeded generator (mulberry32) — the same draws every run. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('readerWindowsOf — a pending quote the library holds no reading of', () => {
  it('no candidate, open on the zone → named in pendingZones; a reading to confirm is not', () => {
    const ledger = [clock, reading(FIELD, 0, 0, ['zone']), reading('yesterday', 1, 1, ['confirm'])];
    expect(readerWindowsOf(ledger)).toEqual({
      now: NOW,
      windows: [],
      pending: [FIELD, 'yesterday'],
      pendingZones: [FIELD],
    });
  });
  it('byte identity — no zone-only quote → no pendingZones key', () => {
    const w = readerWindowsOf([clock, reading('yesterday', 0, 2, ['date-order', 'confirm'])]);
    expect(w).not.toHaveProperty('pendingZones');
  });
});

describe('the pending half — the form clause says what the form really does', () => {
  it('a reading to confirm → the earlier bytes, unchanged', () => {
    expect(halves({ now: NOW, windows: [], pending: ['yesterday'] })).toBe(
      "The window for “yesterday” is not settled yet: the person confirms it in the library's own " +
        'form, which shows its reading of those words with the zone and opens when' +
        TAIL,
    );
  });
  it('a zone-only quote → the form asks for the zone; it never "shows its reading"', () => {
    const text = halves({ now: NOW, windows: [], pending: [FIELD], pendingZones: [FIELD] })!;
    expect(text).toBe(
      `The window for “${FIELD}” is not settled yet: the library holds no reading of those ` +
        'words until it knows which time zone they name, so its own form asks the person for ' +
        'that zone, and it opens when' +
        TAIL,
    );
    expect(text).not.toContain('shows its reading');
  });
  it('both → each quote named with what its form does', () => {
    expect(
      halves({ now: NOW, windows: [], pending: [FIELD, 'yesterday'], pendingZones: [FIELD] }),
    ).toBe(
      `The window for “${FIELD}”, “yesterday” is not settled yet: the person confirms ` +
        "“yesterday” in the library's own form, which shows its reading of those words with the " +
        `zone, and names the time zone of “${FIELD}”, which the library holds no reading of ` +
        'until it knows it; the form opens when' +
        TAIL,
    );
  });
  it('after a call ran on a written window → a conclusion about the results, no account of the call', () => {
    const text = halves({ now: NOW, windows: [], pending: ['yesterday'], ranUnconfirmed: true })!;
    expect(text).toBe(
      "The results for “yesterday” cover the window written into the call — the assistant's own " +
        'reading of those words. So the answer gives those results and names that window as the ' +
        "assistant's reading of “yesterday”.",
    );
    // The two phrasings a paid run read as the person's complaint (37/37, then 7/10).
    expect(text).not.toMatch(
      /the person has not|not confirmed|not one the person|the call that ran|you should|apolog/i,
    );
  });
  it('the halves carry no opening — the line composer owns it', () => {
    expect(halves({ now: NOW, windows: [], pending: ['yesterday'] })).not.toContain(
      'A note from the library',
    );
  });
});

describe('property — the opening is said exactly once, first', () => {
  it('over 500 seeded combinations of present, absent and empty halves', () => {
    const rand = seeded(20260930);
    const pick = (): string | undefined => {
      const r = rand();
      return r < 0.3 ? undefined : r < 0.4 ? '' : `Half ${Math.floor(rand() * 1e6)}.`;
    };
    for (let i = 0; i < 500; i++) {
      const parts = Array.from({ length: 1 + Math.floor(rand() * 3) }, pick);
      const present = parts.filter((p): p is string => p !== undefined && p.length > 0);
      const line = timeLine(parts);
      if (present.length === 0) {
        expect(line).toBeUndefined();
        continue;
      }
      expect(line).toBe([TIME_LINE_SOURCE, ...present].join(' '));
      expect(line!.split(TIME_LINE_SOURCE)).toHaveLength(2);
      expect(line!.startsWith(TIME_LINE_SOURCE)).toBe(true);
    }
  });
});

// ─── the shifted read ───────────────────────────────────────────────

const presentation = bindPresentation({ zone: LA });
const iso = (ms: number) => new Date(ms).toISOString();
const NOW_MS = Date.parse(NOW);
function shiftedRow(byMin: number, lengthMin: number) {
  const asked = { from: iso(NOW_MS - lengthMin * 60_000), to: NOW };
  const read = {
    from: iso(NOW_MS - (lengthMin - byMin) * 60_000),
    to: iso(NOW_MS + byMin * 60_000),
  };
  const missingTo = byMin >= lengthMin ? asked.to : read.from;
  const extraFrom = byMin >= lengthMin ? read.from : asked.to;
  return {
    kind: 'period',
    turn: 1,
    toolCallId: 'c1',
    toolName: 'search_logs',
    iteration: 1,
    verdict: 'covered',
    shifted: { byMs: byMin * 60_000 },
    differs: {
      against: 'person',
      asked,
      read: [read],
      source: 'shifted',
      missing: [{ from: asked.from, to: missingTo }],
      extra: [{ from: extraFrom, to: read.to }],
    },
  } as const;
}

describe('the shifted read — the model gets the conclusion, the person keeps the two ranges', () => {
  it('part of the window uncovered → that part, of the person’s window, and what the answer says', () => {
    const line = periodCheckLine(shiftedRow(30, 60) as never, presentation, 'model')!;
    expect(line).toBe(
      "search_logs's look-back ran after the clock moved on, so its result does not cover " +
        "2026-10-09 07:40:00–08:09:59 America/Los_Angeles (UTC-07:00) of the person's window " +
        '(2026-10-09 07:40:00–08:39:59 America/Los_Angeles (UTC-07:00)), and covers 2026-10-09 ' +
        "08:40:00–09:09:59 America/Los_Angeles (UTC-07:00), outside it. So the answer says that search_logs's " +
        'result does not cover 2026-10-09 07:40:00–08:09:59 America/Los_Angeles (UTC-07:00), and ' +
        'claims nothing about that time from it',
    );
  });
  it('none of the window covered → "any of" it, said once', () => {
    const line = periodCheckLine(shiftedRow(90, 60) as never, presentation, 'model')!;
    expect(line).toContain(
      "so its result does not cover any of the person's window, 2026-10-09 07:40:00–08:39:59 " +
        'America/Los_Angeles (UTC-07:00), and covers',
    );
  });
  it('byte identity — the PERSON’s line keeps its two ranges and "a shifted window"', () => {
    expect(periodCheckLine(shiftedRow(30, 60) as never, presentation)).toBe(
      'search_logs read a shifted window — your window: 2026-10-09 07:40:00–08:39:59 ' +
        'America/Los_Angeles (UTC-07:00); read: 2026-10-09 08:10:00–09:09:59 America/Los_Angeles ' +
        '(UTC-07:00)',
    );
  });
  it('property — over 300 seeded shifts the conclusion names exactly the missing range, twice', () => {
    const rand = seeded(9);
    for (let i = 0; i < 300; i++) {
      const length = 5 + Math.floor(rand() * 600);
      const by = 1 + Math.floor(rand() * (length - 1));
      const row = shiftedRow(by, length);
      const line = periodCheckLine(row as never, presentation, 'model')!;
      const missing = presentation.range(row.differs.missing[0], 'second');
      expect(line.split(missing).length - 1).toBe(2);
      expect(line).toContain('So the answer says that search_logs');
      expect(line).not.toContain('a shifted window');
    }
  });
});
