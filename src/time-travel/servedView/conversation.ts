import type { LLMMessage } from '../../provider-contract/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { messagesFromInjections, stripFrameworkFields } from '../../core/agent/composeRequest.js';
import type { EpochLocation } from '../epochs.js';
import { readAtCall } from './recordReads.js';

/** Select the recorded conversation and its first framework-stripped view. */
export function conversationAt(
  location: EpochLocation,
  served: boolean,
): readonly [
  conversation: LLMMessage[] | undefined,
  committed: readonly LLMMessage[],
  history: readonly LLMMessage[],
] {
  // ── the conversation ───────────────────────────────────────────────────
  // Read BEFORE the call's own bundle: the call appends the assistant turn to
  // `history`, so the committed value at the call already includes the answer.
  //
  // TWO committed sources, because there are two kinds of chart and they do
  // not agree on where the conversation lives. The agent charts keep it in
  // `history` and treat `messagesInjections` as an observability projection.
  // `LLMCall` and the message-API charts have NO history at all: the messages
  // slot IS the conversation, composed by `messagesFromInjections` — the same
  // function called here. Reading only `history` on those charts found nothing
  // and reported an empty conversation the provider never sent.
  //
  // Neither present ⇒ the turns are UNKNOWN, and the gap below says so rather
  // than letting `[]` pass for a proof.
  const committedHistory = readAtCall(location, 'history', served);
  const committedInjections = readAtCall(location, 'messagesInjections', served);
  const conversation: LLMMessage[] | undefined = Array.isArray(committedHistory)
    ? (committedHistory as LLMMessage[])
    : Array.isArray(committedInjections)
    ? [...messagesFromInjections(committedInjections as InjectionRecord[])]
    : undefined;
  const committed: readonly LLMMessage[] = conversation ?? [];
  const history = stripFrameworkFields(committed);
  return [conversation, committed, history];
}
