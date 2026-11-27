import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/provider-contract/types.js';

export const request: LLMRequest = {
  model: 'fixture-model',
  systemPrompt: 'Read the fixture.',
  messages: [{ role: 'user', content: 'What happened?' }],
  temperature: 0.2,
  maxTokens: 40,
  stop: ['[end]'],
};

export function answer(content: string): LLMResponse {
  return { content, toolCalls: [], usage: { input: 4, output: 2 }, stopReason: 'end_turn' };
}

export function failure(message: string, status = 503, retryAfterMs?: number): Error {
  return Object.assign(new Error(message), { status, retryAfterMs });
}

export function chunk(content: string, tokenIndex = 0): LLMChunk {
  return { content, tokenIndex, done: false };
}

export function terminal(response: LLMResponse, tokenIndex = 0): LLMChunk {
  return { content: '', tokenIndex, done: true, response };
}

export function traceCall() {
  const start = Date.now();
  const steps: { at: number; action: string }[] = [];
  const requests: Array<{ provider: string; operation: 'complete' | 'stream'; bytes: string }> = [];
  const mark = (action: string) => steps.push({ at: Date.now() - start, action });
  function enter(provider: string, operation: 'complete' | 'stream', input: LLMRequest) {
    const { signal: _signal, ...wire } = input;
    requests.push({ provider, operation, bytes: JSON.stringify(wire) });
    mark(`${provider}.${operation}`);
  }
  return { mark, enter, steps, requests };
}

type Trace = ReturnType<typeof traceCall>;
type Completion = LLMResponse | Error | ((input: LLMRequest) => Promise<LLMResponse>);
type Stream = Error | readonly (LLMChunk | Error)[];

export function scriptedProvider(
  name: string,
  trace: Trace,
  completions: readonly Completion[],
  streams?: readonly Stream[],
): LLMProvider {
  let nextCompletion = 0;
  let nextStream = 0;
  const provider: LLMProvider = {
    name,
    async complete(input) {
      trace.enter(name, 'complete', input);
      const result = completions[nextCompletion++];
      if (typeof result === 'function') return result(input);
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error(`Unexpected ${name}.complete`);
      return result;
    },
  };
  if (!streams) return provider;
  return {
    ...provider,
    stream(input) {
      trace.enter(name, 'stream', input);
      const script = streams[nextStream++];
      if (script instanceof Error) throw script;
      if (script === undefined) throw new Error(`Unexpected ${name}.stream`);
      return (async function* () {
        try {
          for (const step of script) {
            if (step instanceof Error) throw step;
            yield step;
          }
        } finally {
          trace.mark(`${name}.close`);
        }
      })();
    },
  };
}

export async function drain(
  stream: AsyncIterable<LLMChunk>,
  observe?: (chunk: LLMChunk) => void,
): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = [];
  for await (const chunk of stream) {
    observe?.(chunk);
    chunks.push(chunk);
  }
  return chunks;
}
