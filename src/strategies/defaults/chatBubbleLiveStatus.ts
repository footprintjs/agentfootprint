/**
 * `chatBubbleLiveStatus()` — default LiveStatusStrategy.
 *
 * Pattern: Strategy. Adapter for a consumer-supplied callback.
 * Role:    The "every chat UI" sink. Wraps a `(line: string) => void`
 *          callback so the consumer just hands us the function their
 *          chat-bubble component needs and we drive it on every
 *          rendered status update.
 *
 * Use when:
 *   - Building a chat UI (Neo, Lens, embedded widget) where the
 *     consumer owns rendering but not state derivation
 *   - Tier-1 of compose chains (`compose([chatBubble(setLine), stdout()])`
 *     so dev console mirrors what the user sees)
 *
 * The callback runs on EVERY status transition. Consumer can debounce
 * / coalesce per their needs (we don't impose UI policy).
 */

import type { LiveStatusStrategy, StatusUpdate } from '../types.js';

export interface ChatBubbleLiveStatusOptions {
  /**
   * Required — called per status update with the rendered line.
   * Pass `setStatus` from your React component, or any function
   * whose job is "show this line in the chat bubble."
   *
   * NOTE: this is INTENTIONALLY the only callback. If you need access
   * to the underlying `ThinkingState` (for color-per-state, animation
   * triggers, etc.), build your own `LiveStatusStrategy` directly OR
   * use `compose([chatBubbleLiveStatus({onLine}), customStrategy])`.
   * We don't surface `ThinkingState` here because it's an INTERNAL
   * shape — exposing it would couple consumer UIs to changes in the
   * state machine.
   */
  readonly onLine: (line: string) => void;
}

export function chatBubbleLiveStatus(opts: ChatBubbleLiveStatusOptions): LiveStatusStrategy {
  return {
    name: 'chat-bubble',
    capabilities: { streaming: true },
    renderStatus(update: StatusUpdate): void {
      opts.onLine(update.line);
    },
    validate(): void {
      if (typeof opts.onLine !== 'function') {
        throw new Error(
          'chatBubbleLiveStatus: required `onLine` callback is missing or not a function. ' +
            'Pass the function that should receive each rendered status line.',
        );
      }
    },
  };
}
