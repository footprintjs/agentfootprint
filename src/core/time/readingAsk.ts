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
 * settled (`only`, `policy`) or cannot be asked about (`none`, a refused
 * mention). `messages` is the whole catalog (the caller composes the app's
 * overrides over `defaultTimeAskMessages`); `id` names the field.
 */
export function timeAskOf(
  row: TimeReadingRow,
  messages: TimeAskMessages,
  id = 'time',
): TimeAsk | undefined {
  const choice = row.choice;
  if (choice?.by !== 'open' || row.quote === undefined) return undefined;
  const quote = quoted(row.quote);
  if (choice.open.includes('zone')) {
    return {
      question: fillMessage(messages['ask.zone'], { quote, token: quoted(saidZoneToken(row)) }),
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
    const window = presentRange(
      candidate.range,
      { zone: candidate.zone, locale: row.reader.locale },
      candidate.grain,
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
