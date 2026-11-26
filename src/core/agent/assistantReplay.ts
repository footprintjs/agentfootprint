/** Durable metadata for a provider-authored assistant turn, copied at its writer. */
import type { LLMMessage } from '../../provider-contract/types.js';
import type { AgentState } from './types.js';

/**
 * The adapter owns the evidence; core only carries it alongside the text it
 * actually delivered. Presence is checked without a tracked read, so a run on
 * a provider with no replay evidence gains no phantom context source. Thinking
 * joins this carrier only when the provider supplied replay evidence; legacy
 * message writers retain their existing thinking behaviour otherwise.
 */
export function assistantReplayFields(
  state: Pick<Partial<AgentState>, 'llmLatestReplay' | 'thinkingBlocks'> & {
    readonly $getValue?: (key: 'llmLatestReplay' | 'thinkingBlocks') => unknown;
  },
): Pick<LLMMessage, 'replay' | 'thinkingBlocks'> {
  if (!('llmLatestReplay' in state)) return {};
  // Footprint's grouped mapper replaces top-level arrays, but deep-merges
  // object members. The tuple carries one indivisible provider proof, so an
  // earlier layout or binding can never be merged into the next response.
  // The native value port returns owned data; ordinary nested scope reads
  // return reactive proxies that structuredClone cannot carry into history.
  const read = state.$getValue;
  const tuple =
    typeof read === 'function'
      ? (read.call(state, 'llmLatestReplay') as AgentState['llmLatestReplay'])
      : state.llmLatestReplay;
  const replay = tuple?.[0];
  if (replay === undefined) return {};
  const blocks =
    typeof read === 'function'
      ? (read.call(state, 'thinkingBlocks') as AgentState['thinkingBlocks'])
      : state.thinkingBlocks;
  return structuredClone({
    replay,
    ...(blocks !== undefined && blocks.length > 0 && { thinkingBlocks: blocks }),
  });
}

/** Capture the settled text with its own provider evidence. Legacy and local
 * replies carry no origin. A memory writer also keeps its unsigned thinking.
 * `asksOrigin` is the caller's answer to "may `modelReplyRunId` be asked for?":
 * on a stage's scope asking is a recorded read even of an unset key, so only
 * an agent built with `hostEndedTurns: true` (the one writer of the key) asks. */
export function settledModelReply(
  state: Parameters<typeof assistantReplayFields>[0] & Pick<Partial<AgentState>, 'modelReplyRunId'>,
  content: string,
  asksOrigin: boolean,
  thinkingBlocks?: LLMMessage['thinkingBlocks'],
): LLMMessage {
  const runId = asksOrigin && 'modelReplyRunId' in state ? state.modelReplyRunId : undefined;
  return {
    role: 'assistant',
    content,
    ...(runId !== undefined && { replyOrigin: { kind: 'model', runId } }),
    ...(thinkingBlocks !== undefined && { thinkingBlocks }),
    ...assistantReplayFields(state),
  };
}

/** Atomic tuple + Replace in the grouped mapper: never merge a former layout or
 * binding into a new provider proof. Present undefined clears it. */
export function acceptedResponseFields(state: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(Object.hasOwn(state, 'modelReplyRunId') && { modelReplyRunId: state.modelReplyRunId }),
    ...(Object.hasOwn(state, 'llmLatestReplay') && { llmLatestReplay: state.llmLatestReplay }),
    ...(Object.hasOwn(state, 'requestReplay') && { requestReplay: state.requestReplay }),
  };
}

/** The episodic writer receives the actual inbound message, when there was one,
 * paired with the already admitted assistant entry. */
export function acceptedTurnMessages(input: string | undefined, reply: LLMMessage): LLMMessage[] {
  return input === undefined ? [reply] : [{ role: 'user', content: input }, reply];
}

/** Collect the settled model turn in native recording order for memory writers;
 * `asksOrigin` as `settledModelReply` takes it, from the final stage's arms. */
export function modelTurnMessages(scope: AgentState, asksOrigin: boolean): LLMMessage[] {
  // v2.14 — attach thinking blocks to the assistant final message
  // (if any). For non-Anthropic providers this is informational; for
  // Anthropic + extended-thinking-with-tool-use, signature round-trip
  // requires the blocks to persist on the assistant turn even when
  // it's the FINAL turn (continuation in the next user message).
  // The turn payload memory writes persist: the user's message
  // paired with the agent's final answer.
  // These reads and their order are part of the recorded turn.
  const thinkingBlocks = scope.thinkingBlocks;
  const memoryThinking = thinkingBlocks?.length ? thinkingBlocks : undefined;
  return acceptedTurnMessages(
    scope.userMessage,
    settledModelReply(scope, scope.finalContent, asksOrigin, memoryThinking),
  );
}
