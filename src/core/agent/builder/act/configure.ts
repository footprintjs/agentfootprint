import { resolveAct, type ActOptions } from '../../act.js';
import type { MessageMiddleware, ToolMiddleware } from '../../middleware/types.js';
import type { WindowStrategy } from '../../window/strategy.js';

export interface ActPort {
  actCalled: boolean;
  assertNoWindowStrategy(door: 'window' | 'compaction' | 'act'): void;
  noteWindowStrategyDoor(door: '.window()' | '.compaction()' | '.act({ window })'): void;
  window(strategy: WindowStrategy): unknown;
  messageMiddleware(...middleware: MessageMiddleware[]): unknown;
  toolMiddleware(...middleware: ToolMiddleware[]): unknown;
}

export function configureAct<TReceiver extends ActPort>(
  self: TReceiver,
  options: ActOptions,
  original: object,
): object {
  if (self.actCalled) {
    throw new Error(
      'AgentBuilder.act: already called. One posture block per agent — a second would put ' +
        'the answer to "what does this agent do at each moment of its loop?" in two places, ' +
        'with the later one silently winning. To ADD one rule to an agent that already has ' +
        'a posture, use the individual door for that moment (.toolMiddleware(), ' +
        '.messageMiddleware(), .window()); they compose incrementally by design.',
    );
  }
  // Resolved BEFORE anything is attached: a bundle with a bad key must
  // leave the builder exactly as it found it, not half-configured. Every
  // entry is validated inside `resolveAct`, and the window — the one key
  // whose validation lives on its own door — goes first for the same
  // reason.
  const resolved = resolveAct(options);
  if (resolved.window !== undefined) {
    self.assertNoWindowStrategy('act');
    // Noted BEFORE delegating: `.window()` is the setter both doors share,
    // and the refusal a later call meets should name the door this caller
    // actually wrote.
    self.noteWindowStrategyDoor('.act({ window })');
    self.window(resolved.window);
  }
  self.actCalled = true;
  if (resolved.message.length > 0) self.messageMiddleware(...resolved.message);
  if (resolved.tool.length > 0) self.toolMiddleware(...resolved.tool);
  return original;
}
