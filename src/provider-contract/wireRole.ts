/**
 * The roles a provider can carry INSIDE the `messages` array.
 *
 * `'tool'` is deliberately absent: a tool message is an answer to a specific
 * `tool_use` id, so it cannot be authored by an injection — there is no call
 * for it to answer. See `LLMProvider.carriesInMessages`.
 */
export type WireRole = 'system' | 'user' | 'assistant';

/**
 * The floor every known wire supports. Used for any provider that does not
 * declare `carriesInMessages` — a third-party adapter is assumed to carry
 * only what all of them do, never more.
 */
export const DEFAULT_CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze([
  'user',
  'assistant',
]);
