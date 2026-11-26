/**
 * Error-local replay veto for a transport that may already have progressed.
 * This is separate from intervention classification: an interrupted transport
 * has no admitted completed response and keeps its original category and cause.
 * No side table, retry timer or synthetic yielded chunk is involved.
 */
const NO_AUTOMATIC_REPLAY = Symbol('agentfootprint.no-automatic-provider-replay');

/** The adapter owns this newly projected Error; its identity and cause stay intact. */
export function forbidAutomaticReplay<T extends Error>(error: T): T {
  Object.defineProperty(error, NO_AUTOMATIC_REPLAY, { value: true });
  return error;
}

/** Only the explicit own marker counts; foreign getters are never invoked. */
export function automaticReplayForbidden(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  try {
    const field = Object.getOwnPropertyDescriptor(error, NO_AUTOMATIC_REPLAY);
    return field !== undefined && 'value' in field && field.value === true;
  } catch {
    return false;
  }
}
