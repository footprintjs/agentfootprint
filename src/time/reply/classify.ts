/** L0 leaf: classify a complete correction using the existing grammars only. */
import { checkReading } from '../reader.js';
import {
  ENGLISH_TIME_READER_ID,
  readEnglishTime,
  readEnglishZoneCorrection,
} from '../readers/english.js';
import { parseRange } from '../range.js';
import { isZoneName } from '../zone.js';
import { holdReply, type ClassifiedText } from './types.js';

export function classifyReply(text: string): ClassifiedText {
  const range = parseRange(text);
  if (range !== undefined) return { kind: 'interval', range };
  const zone = isZoneName(text) ? text : readEnglishZoneCorrection(text);
  if (zone !== undefined) return { kind: 'zone', token: zone };

  const mentions = checkReading(text, readEnglishTime(text), ENGLISH_TIME_READER_ID);
  if (mentions.length > 1) return holdReply('ambiguous-correction');
  const mention = mentions[0];
  if (
    mention === undefined ||
    'refused' in mention ||
    mention.problem !== undefined ||
    mention.quote !== text
  ) {
    // Complete consumption matters: extracting “yesterday” from “not yesterday”
    // must not turn an unreadable correction into an affirmative replacement.
    return holdReply('unreadable-correction');
  }
  return { kind: 'words', mention };
}
