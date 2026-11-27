/**
 * BedrockProvider — wraps AWS Bedrock's Converse API as an `LLMProvider`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from
 *          AWS Bedrock's model-agnostic Converse / ConverseStream APIs.
 *          Works with ANY Bedrock-hosted model (Claude, Llama, Mistral,
 *          Titan, Mixtral, ...) without format-specific code.
 * Emits:   N/A.
 *
 * Requires: `npm install @aws-sdk/client-bedrock-runtime`
 *
 * The Converse API is model-agnostic — one adapter covers every
 * Bedrock-hosted model (Claude, Llama, Mistral, Titan, Mixtral, ...).
 *
 * Tool calling works on BOTH paths: `complete()` reads `toolUse` blocks
 * off the Converse response, and `stream()` accumulates ConverseStream
 * `contentBlockStart` / `contentBlockDelta` / `contentBlockStop` events
 * (keyed by `contentBlockIndex`, so parallel tool calls that interleave
 * are parsed correctly) and delivers them on the terminal chunk's
 * `response.toolCalls`. A parity test pins the two paths together.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported  (text content only).
 * • Guardrail configuration is explicit; raw assessment trace stays private.
 *   Configured streams hold content through post-stop metadata and natural end.
 * • Thinking is NOT implemented: Converse reasoning blocks and their signed
 *   replay are not carried by this adapter. A request to think is refused
 *   before sending, never silently dropped.
 */

import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WireRole,
} from '../../provider-contract/types.js';
import { throwIfAborted, untilAborted } from '../../lib/abort.js';
import { forcedToolChoiceFor } from '../../provider-contract/forcedToolChoice.js';
import { forbidAutomaticReplay } from '../../provider-contract/replaySafety.js';
import { anthropicTakesForcedToolChoice } from './anthropicModels.js';
import { bedrockPromptCaching } from './bedrockCacheWire.js';
import { resolveClient, sendUnder, wrapError } from './BedrockProvider/client.js';
import { buildInput } from './BedrockProvider/request.js';
import {
  prepareCacheCommand,
  type CacheCommandTicket,
} from '../../provider-contract/requestObserver.js';
import { bedrockCacheFactResolver } from './bedrockModels.js';
import { guardedCompleteResponse } from './BedrockProvider/guardrailResponse.js';
import { guardrailConfiguration, guardrailWire } from './BedrockProvider/guardrailConfig.js';
import { missingGuardedStream, streamGuardedBedrock } from './BedrockProvider/guardedStream.js';
import { ownData } from './BedrockProvider/guardrailRead.js';
import { streamBedrock } from './BedrockProvider/stream.js';
import type {
  BedrockConverseResponse,
  BedrockStreamResponse,
  BedrockProviderOptions,
} from './BedrockProvider/types.js';
export type {
  BedrockStreamEvent,
  BedrockProviderOptions,
  BedrockConverseSdkModule,
} from './BedrockProvider/types.js';
export type {
  BedrockGuardrailOptions,
  BedrockGuardrailTrace,
} from './BedrockProvider/guardrailConfig.js';

/**
 * Which roles this wire carries inside `messages`.
 *
 * `'system'` is ABSENT and that is the wire's own rule, not a policy choice:
 * `toAnthropicMessages` drops a `role: 'system'` message because Anthropic
 * takes the system prompt as a separate top-level field. Declaring the truth
 * here is what lets a `slot: 'messages'` injection be refused at run start
 * rather than silently vanish between the recording and the request.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['user', 'assistant']);

async function* observeBedrockResponse(
  stream: AsyncIterable<LLMChunk>,
  command: CacheCommandTicket | undefined,
): AsyncIterable<LLMChunk> {
  for await (const chunk of stream) {
    if (chunk.done && chunk.response !== undefined) command?.response(chunk.response);
    yield chunk;
  }
}

export function bedrock(options: BedrockProviderOptions = {}): LLMProvider {
  const guardrail = guardrailConfiguration(options);
  const { client, Commands } = resolveClient(options);
  const defaultModel = options.defaultModel ?? 'anthropic.claude-sonnet-4-5-20250929-v1:0';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  const modelOf = (model: string): string => (model === 'bedrock' ? defaultModel : model);
  const cacheFacts = bedrockCacheFactResolver(options.inferenceProfileModels);

  async function completeCommand(
    req: LLMRequest,
    hooks: LLMCallHooks | undefined,
    fallbackFrom?: symbol,
  ): Promise<LLMResponse> {
    throwIfAborted(req.signal);
    const model = modelOf(req.model);
    const { input, cache } = buildInput(req, model, defaultMaxTokens, cacheFacts(model));
    if (guardrail !== undefined) input.guardrailConfig = guardrailWire(guardrail, false);
    const command = prepareCacheCommand(hooks, {
      operation: 'Converse',
      ...cache,
      ...(fallbackFrom !== undefined && { fallbackFrom }),
    });
    try {
      const cmd = new Commands.Converse(input);
      // Forward the abort signal to the SDK and refuse a response after cancellation.
      const response = (await untilAborted(
        sendUnder(client, cmd, req.signal),
        req.signal,
      )) as BedrockConverseResponse;
      const accepted = guardedCompleteResponse(response, guardrail);
      command?.response(accepted);
      return accepted;
    } catch (err) {
      throw wrapError(err, req.signal);
    }
  }

  const provider: LLMProvider = {
    name: 'bedrock',
    promptCaching: (model) => bedrockPromptCaching(cacheFacts(modelOf(model))),
    carriesInMessages: CARRIES_IN_MESSAGES,
    // The existing boolean describes the wire. The optional model predicate
    // narrows it where the shared Claude table knows a model rejects it.
    carriesForcedToolChoice: true,
    supportsForcedToolChoice: (model) => anthropicTakesForcedToolChoice(modelOf(model)),
    thinkingMode: () => 'none',
    complete(req, hooks) {
      return completeCommand(req, hooks);
    },
    async *stream(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
      throwIfAborted(req.signal);
      const model = modelOf(req.model);
      const { input, cache } = buildInput(req, model, defaultMaxTokens, cacheFacts(model));
      if (guardrail !== undefined) input.guardrailConfig = guardrailWire(guardrail, true);
      const command = prepareCacheCommand(hooks, { operation: 'ConverseStream', ...cache });
      let response: BedrockStreamResponse;
      try {
        const cmd = new Commands.ConverseStream(input);
        response = (await untilAborted(
          sendUnder(client, cmd, req.signal),
          req.signal,
        )) as BedrockStreamResponse;
      } catch (err) {
        const wrapped = wrapError(err, req.signal);
        throw guardrail === undefined ? wrapped : forbidAutomaticReplay(wrapped);
      }
      if (guardrail !== undefined) {
        try {
          const stream = ownData(response, 'stream').value as BedrockStreamResponse['stream'];
          if (!stream) {
            const response = missingGuardedStream(guardrail);
            command?.response(response);
            yield { tokenIndex: 0, content: '', done: true, response };
            return;
          }
          yield* observeBedrockResponse(streamGuardedBedrock(stream, req, guardrail), command);
        } catch (error) {
          // A sent guarded request is not replayed after a stream failure,
          // even before content release. Keep its existing error identity,
          // transport category and cause separate from intervention evidence.
          throw forbidAutomaticReplay(wrapError(error, req.signal));
        }
        return;
      }
      const stream = response.stream;
      if (!stream) {
        // Some Bedrock models / regions don't support streaming —
        // fall back to a synthesized terminal chunk via complete().
        const final = await completeCommand(req, hooks, command?.id);
        yield { tokenIndex: 0, content: '', done: true, response: final };
        return;
      }

      yield* observeBedrockResponse(streamBedrock(stream, req), command);
    },
  };

  return provider;
}

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = true;
  readonly thinkingMode: (model: string) => 'none' = () => 'none';
  readonly supportsForcedToolChoice: (model: string) => boolean;
  readonly promptCaching: LLMProvider['promptCaching'];
  private readonly inner: LLMProvider;

  constructor(options: BedrockProviderOptions = {}) {
    this.inner = bedrock(options);
    this.promptCaching = this.inner.promptCaching;
    this.supportsForcedToolChoice = (model) => forcedToolChoiceFor(this.inner, model);
  }

  // `hooks` is FORWARDED, not dropped — see LLMCallHooks in provider-contract/types.ts.
  complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
    return this.inner.complete(req, hooks);
  }

  stream(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) throw new Error('stream() unavailable');
    return this.inner.stream(req, hooks);
  }
}
