/**
 * Replay evidence and reports. JSON data only: no second copy of conversation
 * text, tool arguments, signatures or credentials. The concrete wire owns
 * capture and comparison; the run owns persistence and observation.
 */
import type { LLMRequest } from '../adapters/types.js';

/** The order of already-stored content and its supported inert wire metadata. */
export type ReplayPart =
  | { readonly type: 'text'; readonly length: number; readonly citations?: null | readonly [] }
  | { readonly type: 'thinking'; readonly index: number }
  | {
      readonly type: 'tool';
      readonly index: number;
      readonly caller?: { readonly type: 'direct' };
      readonly toolset_name?: null;
    };

/** Versioned, serializable evidence for an assistant message's wire replay. */
export interface MessageReplay {
  readonly version: 1;
  readonly protocol: 'anthropic-messages';
  /** Provider response identity; not a cryptographic authenticity claim. */
  readonly id: string;
  readonly layout: readonly ReplayPart[];
  readonly stopReason: string;
  readonly contentDigest: string;
  /** The adapter observed content it could not preserve; never a fidelity proof. */
  readonly lossy?: true;
  readonly binding?: {
    readonly model: string;
    readonly salt: string;
    readonly system: string;
    readonly tools: string;
    readonly messages: string;
    readonly priorThinking: readonly string[];
  };
  /** A permitted omission is durable, not a request-local hiding flag. */
  readonly thinkingRetired?: true;
}

/** A library-known replay inconsistency, never a decoded signature verdict. */
export type ThinkingReplayReason =
  | 'prefix-changed'
  | 'content-changed'
  | 'sequence-changed'
  | 'thinking-retired'
  | 'missing-signature';

/** One removed block. Deliberately contains no reasoning or signed material. */
export interface ThinkingReplayOmission {
  readonly messageIndex: number;
  readonly blockIndex: number;
  readonly reason: ThinkingReplayReason;
  readonly replayId?: string;
  /** Matches an unstamped caller-owned message without retaining its values. */
  readonly messageFingerprint: string;
}

/** A leaf adapter's actual request adjustment, reported before transport. */
export interface ReplayPreparation {
  readonly provider: string;
  readonly model: string;
  readonly request: LLMRequest;
  readonly omissions: readonly ThinkingReplayOmission[];
}

/** Required active-turn thinking cannot be replayed safely. Not retryable. */
export class UnsafeThinkingReplayError extends Error {
  readonly code = 'UNSAFE_THINKING_REPLAY';
  readonly retryable = false;
  constructor(
    readonly provider: string,
    readonly model: string,
    readonly messageIndex: number,
    readonly reason: ThinkingReplayReason,
  ) {
    super(
      `Cannot replay thinking in an unfinished tool turn (${reason}, message ${messageIndex}). ` +
        'Keep the system prompt, tool definitions and earlier messages stable within the turn, ' +
        'and preserve the original assistant content and signatures. Finish that turn before editing its context.',
    );
    this.name = 'UnsafeThinkingReplayError';
  }
}
