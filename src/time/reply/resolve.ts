/** L0 leaf: resolve a correction at the saved clock; every new reading is a proposal. */
import { englishTimeReader } from '../readers/english.js';
import type { TimeParts } from '../reader.js';
import { chooseReading, resolveMention } from '../resolve.js';
import type { TimeReadingRow } from '../rows.js';
import {
  holdReply,
  type ClassifiedText,
  type TimeReplyDecision,
  type TimeReplyInput,
} from './types.js';

/** A correction replaces known zones too; withZoneAnswered only repairs unknown ones. */
function replaceZone(parts: TimeParts, token: string): TimeParts {
  const { zoneToken: _oldZone, rangeOf, ...rest } = parts;
  void _oldZone;
  if (rangeOf === undefined) return { ...rest, zoneToken: token };
  const withoutZone = (side: TimeParts): TimeParts => {
    const { zoneToken: _old, ...kept } = side;
    void _old;
    return kept;
  };
  return {
    ...rest,
    zoneToken: token,
    rangeOf: [withoutZone(rangeOf[0]), withoutZone(rangeOf[1])],
  };
}

/** A new word changes the time; an unstated zone retains this pending question's context. */
function contextualParses(row: TimeReadingRow, parses: readonly TimeParts[]): readonly TimeParts[] {
  const tokens = [
    ...new Set(
      (row.parses ?? []).flatMap((parts) =>
        [parts.zoneToken, parts.rangeOf?.[0].zoneToken, parts.rangeOf?.[1].zoneToken].filter(
          (token): token is string => token !== undefined,
        ),
      ),
    ),
  ];
  return parses.flatMap((parts) => {
    const hasZone =
      parts.zoneToken !== undefined ||
      parts.rangeOf?.some((side) => side.zoneToken !== undefined) === true;
    return hasZone || tokens.length === 0
      ? [parts]
      : tokens.map((token) => replaceZone(parts, token));
  });
}

export function resolveReply(
  input: TimeReplyInput,
  correction: Extract<ClassifiedText, { kind: 'zone' | 'words' }>,
): TimeReplyDecision {
  const zoneOnly = correction.kind === 'zone';
  const parses = zoneOnly
    ? (input.row.parses ?? []).map((parts) => replaceZone(parts, correction.token))
    : contextualParses(input.row, correction.mention.parses);
  if (parses.length === 0) return holdReply('unresolved-correction');
  const reader = zoneOnly
    ? input.row.reader
    : englishTimeReader({ locale: input.row.reader.locale });
  const resolution = resolveMention(parses, input.clock, reader, true, input.policy);
  const choice = chooseReading(resolution, input.policy, reader.kind, undefined, true);
  if (choice.by === 'none') return holdReply('unresolved-correction');

  const {
    quote: _quote,
    parses: _parses,
    problem: _problem,
    refused: _refused,
    candidates: _candidates,
    choice: _choice,
    ...base
  } = input.row;
  void [_quote, _parses, _problem, _refused, _candidates, _choice];
  const row: TimeReadingRow = {
    ...base,
    reader: { id: reader.id, version: reader.version, kind: reader.kind, locale: reader.locale },
    ...(zoneOnly
      ? input.row.quote !== undefined && { quote: input.row.quote }
      : { quote: correction.mention.quote }),
    parses,
    candidates: resolution.candidates,
    choice,
  };
  return { kind: 'reask', row, rule: zoneOnly ? 'zone-corrected' : 'time-words-corrected' };
}
