import type { LLMChunk } from '../../../../provider-contract/types.js';
import { typedEmit, type EmitableScope } from '../../../../recorders/core/typedEmit.js';
import type { ReservedMemberFilter } from '../../findings/answerText.js';

interface LiveChunkOptions {
  readonly providerName: string;
  readonly iteration: number;
  readonly suppressDraftTokens: boolean;
  readonly textFilter: ReservedMemberFilter | undefined;
  readonly onFirstChunk: (() => void) | undefined;
}

/** One attempt's live output. The call stage owns the terminal response and cancellation. */
export function liveChunkEmitter(scope: EmitableScope, options: LiveChunkOptions) {
  const { providerName, iteration, suppressDraftTokens, textFilter, onFirstChunk } = options;
  let firstChunkFired = false;
  let lastTokenIndex = -1;
  return {
    push(chunk: LLMChunk): void {
      // A provider is a port anyone can implement, and a non-terminal
      // chunk that carries no `content` used to die when checking its length,
      // naming neither the provider nor the contract it missed. A provider
      // that uses its own terminal marker instead of `done: true` hits this
      // path, so the refusal names the terminal contract as well.
      const visible = chunk.content;
      if (typeof (visible as unknown) !== 'string') {
        throw new TypeError(
          `provider '${providerName}' yielded a stream chunk whose \`content\` is ` +
            `${visible === undefined ? 'missing' : `a ${typeof visible}`}. ` +
            `Every chunk from LLMProvider.stream() is ` +
            `{ tokenIndex: number, content: string, done: boolean }, and the LAST one is ` +
            `{ content: '', done: true, response } — the response payload rides the ` +
            `terminal chunk. A chunk that ends the stream any other way is not seen as ` +
            `terminal, and its missing content stops the run here.`,
        );
      }
      const tokenIndex = chunk.tokenIndex;
      const thinking = suppressDraftTokens ? undefined : chunk.thinkingDelta;
      const hasThinking = typeof thinking === 'string' && thinking.length > 0;
      const hasText = visible.length > 0;
      const kind = chunk.thinkingKind;
      const thinkingKind =
        kind === 'provider-summary' || kind === 'raw-reasoning' ? kind : 'unclassified';
      if (!firstChunkFired && (hasThinking || hasText)) {
        firstChunkFired = true;
        onFirstChunk?.();
      }
      if (hasThinking) {
        lastTokenIndex = tokenIndex;
        typedEmit(scope, 'agentfootprint.stream.thinking_delta', {
          iteration,
          tokenIndex,
          kind: thinkingKind,
          content: thinking,
        });
      }
      if (hasText && !suppressDraftTokens) {
        const content = textFilter === undefined ? visible : textFilter.push(visible);
        lastTokenIndex = tokenIndex;
        if (content.length > 0) {
          typedEmit(scope, 'agentfootprint.stream.token', { iteration, tokenIndex, content });
        }
      }
    },
    finish(): void {
      // The scanner can hold a trailing newline or partial key through EOF.
      const content = textFilter?.end() ?? '';
      if (content.length > 0) {
        typedEmit(scope, 'agentfootprint.stream.token', {
          iteration,
          tokenIndex: lastTokenIndex + 1,
          content,
        });
      }
    },
  };
}
