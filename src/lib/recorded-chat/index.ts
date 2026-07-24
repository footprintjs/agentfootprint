/**
 * recorded-chat — the session-scoped turn recorder over the context-bisect
 * product loop. Absorbs the three correctness traps every chat host re-writes
 * (per-turn artifact freezing, byte-exact history threading, same-factory
 * runner derivation) while COMPOSING with the 7.5 surface, not duplicating it.
 *
 * Exported from `agentfootprint/debug` (every symbol it composes with lives
 * there). Named exports — `export *` is not the house style.
 */

export { recordedChat } from './recordedChat.js';
export type {
  ChatFormat,
  ChatMessage,
  ChatTurn,
  ForkOptions,
  ForkOrigin,
  MakeChatAgent,
  ReasonOptions,
  RecordedChat,
  RecordedChatOptions,
  RerunTurnOptions,
  SendOptions,
} from './types.js';
