/**
 * What differs between a model request and the request the newest signed
 * reasoning in its history was written under — by NAME, never by value.
 *
 * Carried on `agentfootprint.stream.llm_start` (`contextChange`) and on
 * `ContextChangedError`. Present only on a model whose provider answers
 * `thinkingBinding` with `bound` or `unknown`, and only when signed reasoning
 * is in the history.
 */
import type { ContextSource } from '../types.js';
import type { ToolNameChannel } from './toolCatalog.js';

/** One named difference. Which fields are set depends on `slot`. */
export interface ContextChange {
  /** The part of the request that differs. */
  readonly slot: 'system-prompt' | 'tools' | 'messages';
  /**
   * `added` / `removed` / `changed`. For `messages`, `removed` means a message
   * the reasoning was written after is no longer in the request, and `changed`
   * that it differs.
   */
  readonly change: 'added' | 'removed' | 'changed';
  /** `system-prompt`: the piece's source (`skill`, `instructions`, …). */
  readonly source?: ContextSource;
  /** `system-prompt`: the piece's own id (a skill id, an injection id), when it has one. */
  readonly id?: string;
  /** `tools`: the tool's name. */
  readonly tool?: string;
  /** `tools`: who put the tool forward, when the run recorded it. */
  readonly party?: { readonly channel: ToolNameChannel; readonly id?: string };
  /** `messages`: the message's position in the conversation. */
  readonly position?: number;
  /** `messages`: the message's role. */
  readonly role?: string;
}

/** The comparison one request received. */
export interface ContextChangeCheck {
  /**
   * `compared`: this request was compared with the request the newest signed
   * reasoning was written under. `unchecked`: that request is not on this
   * run's record (a conversation continued or restored from storage), so
   * nothing was compared.
   */
  readonly check: 'compared' | 'unchecked';
  /**
   * True when the reasoning belongs to an unfinished tool turn on a `bound`
   * model: the request is not sent. Never true on an `unknown` one.
   */
  readonly refused: boolean;
  /**
   * The model's binding as the provider (or the app, through the adapter's
   * `thinkingBinding` option) answered it. `unknown`: an id the adapter cannot
   * place — the change is recorded and the request is sent; the provider
   * decides.
   */
  readonly binding: 'bound' | 'unknown';
  /** Who stated the binding: the provider's own knowledge, or the app. */
  readonly by: 'provider' | 'app';
  /** The named differences, at most 16. Empty when unchecked. */
  readonly changes: readonly ContextChange[];
  /** Differences beyond the cap, counted. Absent when none were left out. */
  readonly omittedChanges?: number;
}
