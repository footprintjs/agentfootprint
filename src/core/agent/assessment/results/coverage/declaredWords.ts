import { readOwnList } from '../../../../../lib/boundedJson.js';
import { isPlaceholder } from '../../../../../redaction/marker.js';
import {
  coverageWordFragment,
  MAX_SHORT_CHARS,
  shortProblem,
} from '../../../../../semantics/coverage/items.js';
import { isRecord } from '../../recordValues.js';

/** One declaration is read only as far as the warning can use it. */
const MAX_WORD_ITEMS = 8;

interface DeclaredWordList {
  readonly words: readonly string[];
  readonly omitted: number;
}

export interface DeclaredWords {
  readonly notChecked: DeclaredWordList;
  readonly cannotCover: DeclaredWordList;
  readonly tryInstead?: string;
  readonly adviceOmitted: boolean;
}

function ownData(value: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field?.enumerable && 'value' in field ? field.value : undefined;
}

function word(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const words = coverageWordFragment(value);
  return isPlaceholder(words) ? undefined : words;
}

function itemWord(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const what = ownData(item, 'what');
  const long = word(what);
  if (long === undefined || typeof what !== 'string') return undefined;
  const short = Object.getOwnPropertyDescriptor(item, 'short');
  if (short === undefined) return long;
  if (!short.enumerable || !('value' in short)) return undefined;
  const value: unknown = short.value;
  if (value == null) return long;
  if (typeof value !== 'string' || value.length > MAX_SHORT_CHARS || shortProblem(value, what)) {
    return undefined;
  }
  const words = value.trim();
  // If either version was selected, don't put the other in the warning.
  return isPlaceholder(words) ? undefined : words;
}

function wordList(value: unknown): DeclaredWordList {
  const list = readOwnList(value, MAX_WORD_ITEMS);
  if (list === undefined) return { words: [], omitted: 0 };
  const words: string[] = [];
  for (const item of list.entries) {
    const text = itemWord(item);
    if (text !== undefined) words.push(text);
  }
  return { words, omitted: list.unread };
}

/** Read just the words of one retained, admitted declaration. */
export function readDeclaredWords(row: unknown): DeclaredWords | undefined {
  try {
    if (!isRecord(row)) return undefined;
    const kind = ownData(row, 'kind');
    if (kind !== 'absence' && kind !== 'ledger') return undefined;
    const advice = kind === 'absence' ? ownData(row, 'tryInstead') : undefined;
    const tryInstead = word(advice);
    return {
      notChecked: wordList(ownData(row, 'notChecked')),
      cannotCover: wordList(ownData(row, 'cannotCover')),
      ...(tryInstead !== undefined && { tryInstead }),
      adviceOmitted: isRecord(advice) && ownData(advice, 'omitted') === true,
    };
  } catch {
    // A host-built row can have throwing own-property traps. It carries no words.
    return undefined;
  }
}
