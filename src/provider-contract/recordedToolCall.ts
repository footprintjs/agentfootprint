import type { CallOccurrenceKey } from '../lib/callOccurrence.js';

export interface RecordedToolCall<ArgumentsFailure> {
  readonly id: string;
  /** Recording-only address, carried with the proposal through native pause and resume. */
  readonly callOccurrenceKey?: CallOccurrenceKey;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** Stream integrity evidence retained with the attempted call; never tool input. */
  readonly argumentsFailure?: ArgumentsFailure;
  readonly providerMeta?: Readonly<Record<string, unknown>>;
}
