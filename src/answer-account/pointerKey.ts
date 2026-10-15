/**
 * The ONE key format for a record pointer — the key of the `shown` map the
 * `answer-account` wire op returns beside the account.
 *
 * A leaf on purpose (it imports one type): the server writes `shown` under
 * this key (`shown.ts · showLeaves`), and a reader drawing "show me" — the
 * lens — must look a sentence's pointer up by the SAME key. One owner of the
 * format, published from `agentfootprint/observe`: a reader that re-derived it
 * would drift the day a pointer kind is added. (Stamping the key on every
 * pointer instead was measured and refused: +3.1 KB on the flagship's 34 KB
 * account, and a pointer-heavy account would cross its 128 KB cap.)
 *
 * @example
 * ```ts
 * import { answerAccountPointerKey } from 'agentfootprint/observe';
 *
 * const { account, shown } = await res.json(); // the answer-account reply
 * const leaf = shown[answerAccountPointerKey(account.summary.sentence.pointers[0])];
 * ```
 */

import type { RecordPointer } from './types.js';

export function answerAccountPointerKey(p: RecordPointer): string {
  switch (p.kind) {
    case 'event':
      return `event:${p.index}:${p.path}`;
    case 'state':
      return `state:${p.key}:${p.path}`;
    case 'history':
      return `history:${p.index}:${p.path}`;
    case 'declaration':
      return `declaration:${p.field}${p.id !== undefined ? `:${p.id}` : ''}`;
  }
}
