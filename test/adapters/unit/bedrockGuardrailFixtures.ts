import { vi } from 'vitest';
import {
  bedrock,
  BedrockProvider,
  type BedrockProviderOptions,
} from '../../../src/adapters/llm/BedrockProvider.js';
import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/provider-contract/types.js';

// Test-side structural types keep the proposed public feature executable on
// the exact old source: a missing implementation fails behavior, not import.
export interface GuardrailOptions {
  id: string;
  version: string;
  trace?: string;
  maxBufferedBytes?: number;
}

export interface Intervention {
  outcome: 'blocked' | 'masked' | 'unknown';
  code: string;
  filters: readonly { family: string; type?: string }[];
}

export type GuardedResponse = LLMResponse & { intervention?: Intervention };
export type Mode = 'complete' | 'stream';
export const modes: readonly Mode[] = ['complete', 'stream'];
export const request: LLMRequest = {
  model: 'bedrock',
  messages: [{ role: 'user', content: 'Return the public answer.' }],
};
export const publicText = 'Reach [EMAIL] for support.';
export const usage = { inputTokens: 17, outputTokens: 7 };
export const guardrail: GuardrailOptions = {
  id: 'abc123',
  version: '1',
  trace: 'enabled',
};

export function pii(action: unknown, extra: Record<string, unknown> = {}): unknown {
  return { type: 'EMAIL', action, ...extra };
}

export function assessment(...entities: unknown[]): unknown {
  return { sensitiveInformationPolicy: { piiEntities: entities } };
}

export function trace(input: unknown, output?: unknown): unknown {
  return {
    guardrail: {
      ...(input === undefined ? {} : { inputAssessment: { abc123: input } }),
      ...(output === undefined ? {} : { outputAssessments: { abc123: [output] } }),
    },
  };
}

export function response(
  evidence?: unknown,
  stopReason = 'guardrail_intervened',
  content: unknown[] = [{ text: publicText }],
): Record<string, unknown> {
  return {
    output: { message: { role: 'assistant', content } },
    stopReason,
    usage,
    ...(evidence === undefined ? {} : { trace: evidence }),
  };
}

export function textDelta(text = publicText): Record<string, unknown> {
  return { contentBlockDelta: { contentBlockIndex: 0, delta: { text } } };
}

export function eventsFor(
  evidence?: unknown,
  stopReason = 'guardrail_intervened',
  contentEvents: readonly unknown[] = [textDelta()],
): unknown[] {
  return [
    ...contentEvents,
    { messageStop: { stopReason } },
    { metadata: { usage, ...(evidence === undefined ? {} : { trace: evidence }) } },
  ];
}

export interface FixtureOptions {
  complete?: unknown;
  events?: readonly unknown[];
  stream?: () => AsyncIterable<unknown>;
  guardrail?: GuardrailOptions | null;
  classDoor?: boolean;
  sendError?: Error;
  missingStream?: boolean;
}

export function fixture(options: FixtureOptions = {}) {
  class Converse {
    constructor(readonly input: unknown) {}
  }
  class ConverseStream {
    constructor(readonly input: unknown) {}
  }
  const send = vi.fn(async (command: unknown) => {
    if (options.sendError) throw options.sendError;
    if (command instanceof ConverseStream) {
      if (options.missingStream) return {};
      return {
        stream:
          options.stream?.() ??
          (async function* () {
            for (const event of options.events ?? eventsFor()) yield event;
          })(),
      };
    }
    return options.complete ?? response();
  });
  const selected = options.guardrail === undefined ? guardrail : options.guardrail;
  const widened = {
    _client: { send },
    _commands: { Converse, ConverseStream },
    ...(selected === null ? {} : { guardrail: selected }),
  };
  const provider = options.classDoor
    ? new BedrockProvider(widened as BedrockProviderOptions)
    : bedrock(widened as BedrockProviderOptions);
  return { provider, send };
}

export async function read(
  provider: LLMProvider,
  mode: Mode,
  req: LLMRequest = request,
): Promise<{ result: GuardedResponse; chunks: LLMChunk[] }> {
  if (mode === 'complete') {
    return { result: (await provider.complete(req)) as GuardedResponse, chunks: [] };
  }
  const chunks: LLMChunk[] = [];
  for await (const chunk of provider.stream!(req)) chunks.push(chunk);
  const result = chunks.at(-1)?.response;
  if (!result) throw new Error('Expected one terminal Bedrock response');
  return { result: result as GuardedResponse, chunks };
}

export function pair(evidence?: unknown, stopReason = 'guardrail_intervened') {
  return fixture({
    complete: response(evidence, stopReason),
    events: eventsFor(evidence, stopReason),
  });
}
