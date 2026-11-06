/** Lens: project and narrow the next existing time question. */
import { timeAskOf } from '../../../../../time/readingAsk.js';
import { spellRange } from '../../../../../time/range.js';
import type { TimeReadingRow } from '../../../../../time/rows.js';
import type { ToolOf } from '../../resolve.js';
import { WINDOW_ZONE_EXPECTATION } from '../constants.js';
import { allowedChoices, narrowed, readingsOutside } from '../fields.js';
import type { AskField, AskTime } from '../types.js';
import type { WindowBinding } from './types.js';

/** One question projection, shared by native zone answers and the correction facade. */
export function windowQuestion(
  field: AskField,
  row: TimeReadingRow,
  toolOf: ToolOf,
  time: AskTime,
): WindowBinding {
  const window = field.window!;
  const ask = time.reading === undefined ? undefined : timeAskOf(row, time.reading.messages);
  if (ask === undefined || (ask.field.format !== 'time-range' && ask.field.format !== 'zone'))
    return { expected: WINDOW_ZONE_EXPECTATION };
  const choices = ask.field.enum;
  const zones = choices?.map(
    (value) => row.candidates?.find((c) => spellRange(c.range) === value)?.zone ?? time.zone!,
  );
  const { choices: _choices, ...base } = field;
  void _choices;
  const { labels: _labels, zones: _zones, reading: _reading, ...windowBase } = window;
  void [_labels, _zones, _reading];
  const followUp: AskField = {
    ...base,
    question: ask.question,
    ...(choices !== undefined && { choices }),
    window: {
      ...windowBase,
      format: ask.field.format,
      ...(ask.field.labels !== undefined && { labels: ask.field.labels }),
      ...(zones !== undefined && { zones }),
      ...(window.reply !== undefined && { reading: row }),
    },
  };
  if (window.role === 'confirm-meaning' || ask.field.format === 'zone') return { followUp };
  const kept = allowedChoices(choices ?? [], zones, field.members, toolOf, time);
  if (kept === undefined && field.members.length > 0) {
    const outside = readingsOutside(choices ?? [], zones ?? [], field.members, toolOf, time);
    if (outside !== undefined) return { outside };
  }
  return { followUp: narrowed(followUp, kept) };
}
