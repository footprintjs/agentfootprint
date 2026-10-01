/**
 * core/time/readingAsk — the choices an OPEN reading offers (time design
 * § 6.1, § 6.3): the one field a `time-reading` row whose choice is `open`
 * needs.
 *
 * Pattern: a pure builder over the row — the candidates as labelled choices,
 *          a zone asked as `format: 'zone'`, a `model` reading offered to
 *          confirm. The judge of the answer stays `ask.ts` ·
 *          `checkTimeAnswer`.
 * Role:    core/ leaf (the time layer). Split from `ask.ts` because its
 *          labels render through `present.ts` (`presentRange`), and `ask.ts`
 *          is on the resume door's SYNCHRONOUS path (`core/inputRequest.ts`)
 *          while the renderer loads only under `.time()` — the
 *          optional-family law of docs-next's site budget.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * const ask = timeAskOf(row, defaultTimeAskMessages);
 * ask?.field.format; // 'time-range' — its `enum` the candidates left
 * ```
 */

import { fillMessage, quoted, type TimeAskMessages, type TimeFormat } from './ask.js';
import { spellRange } from './range.js';
import { presentRange } from './present.js';
import type { TimeReadingRow } from './rows.js';
import type { TimeCandidate } from './resolve.js';
import { shownGrain } from './resolveRecord.js';

// ─── The choices a reading offers ─────────────────────────────────────────

/** A time field built from a reading — the fields of `core/inputRequest.ts` · `InputField` it sets. */
export interface TimeAskField {
  readonly id: string;
  readonly type: 'string';
  readonly required: true;
  readonly format: TimeFormat;
  readonly enum?: readonly string[];
  readonly labels?: readonly string[];
}

/** One question about one mention: the question and its field. */
export interface TimeAsk {
  readonly question: string;
  readonly field: TimeAskField;
}

/** The zone token the person wrote in the mention's first parse that has one. */
function saidZoneToken(row: TimeReadingRow): string {
  for (const parts of row.parses ?? []) {
    const token = parts.zoneToken ?? parts.rangeOf?.[0].zoneToken ?? parts.rangeOf?.[1].zoneToken;
    if (token !== undefined) return token;
  }
  return '';
}

/**
 * The ask a `time-reading` row needs, or `undefined` when its reading is
 * settled (`only`, `policy`) or is no person's words (a refused mention).
 * Words the library holds NO reading of (`none`: unreadable, no candidate)
 * are asked too — which time the person meant, free entry, nothing
 * pre-filled (`ask.which`, `format: 'time-range'`): the person wrote a time,
 * and a tool's default never stands in for it. `messages` is the whole
 * catalog (the caller composes the app's overrides over
 * `defaultTimeAskMessages`); `id` names the field.
 */
export function timeAskOf(
  row: TimeReadingRow,
  messages: TimeAskMessages,
  id = 'time',
): TimeAsk | undefined {
  const choice = row.choice;
  if (row.quote === undefined || row.refused !== undefined) return undefined;
  if (choice?.by === 'none') {
    return {
      question: fillMessage(messages['ask.which'], { quote: quoted(row.quote) }),
      field: { id, type: 'string', required: true, format: 'time-range' },
    };
  }
  if (choice?.by !== 'open') return undefined;
  const quote = quoted(row.quote);
  if (choice.open.includes('zone')) {
    // A mention that names no zone waits on the PERSON's zone (the clock's is unknown, G15).
    const token = saidZoneToken(row);
    return {
      question:
        token === ''
          ? fillMessage(messages['ask.zone-unknown'], { quote })
          : fillMessage(messages['ask.zone'], { quote, token: quoted(token) }),
      field: { id, type: 'string', required: true, format: 'zone' },
    };
  }
  const candidates = row.candidates ?? [];
  const seen = new Set<string>();
  const offered: { value: string; candidate: TimeCandidate }[] = [];
  for (const index of choice.remaining) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const value = spellRange(candidate.range);
    if (seen.has(value)) continue;
    seen.add(value);
    offered.push({ value, candidate });
  }
  if (offered.length === 0) return undefined;
  // The row owns "a reading needs confirming" (`rowsBuild.ts` · `timeReadingRows` puts 'confirm'
  // on every reading's open choice); this only reads it.
  const confirm = choice.open.includes('confirm');
  const labels = offered.map(({ candidate }) => {
    // The end as said when it was widened, a look-back's at now: "8 AM to 9 AM" is shown
    // 8:00 – 9:00, not 8:59; "last 40 minutes" 8:00 – 8:40, not 8:40:00.001.
    const window = presentRange(
      candidate.range,
      { zone: candidate.zone, locale: row.reader.locale },
      shownGrain(candidate),
    );
    if (!confirm) return window;
    // The zone is named: the reading leaned on it, and the person may have meant another.
    return fillMessage(messages['choice.confirm'], { quote, window, zone: candidate.zone });
  });
  const question = fillMessage(messages[confirm ? 'ask.confirm' : 'ask.which'], { quote });
  return {
    question,
    field: {
      id,
      type: 'string',
      required: true,
      format: 'time-range',
      enum: offered.map((o) => o.value),
      labels,
    },
  };
}
