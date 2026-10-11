/** Request-contract refusals are terminal, not provider availability failures. */
import { UnsupportedToolChoiceError } from './forcedToolChoice.js';
import { UnsupportedThinkingError } from '../thinking/errors.js';
import { UnsafeThinkingReplayError } from '../thinking/replay.js';

/** Deliberately narrow: unrelated application errors keep their existing policy. */
export function isRequestRefusal(error: unknown): boolean {
  return (
    error instanceof UnsupportedToolChoiceError ||
    error instanceof UnsupportedThinkingError ||
    error instanceof UnsafeThinkingReplayError
  );
}
