/**
 * 79 — Claude through your gateway's InvokeModel wire.
 *
 * Many organisations reach Anthropic models through their own gateway: plain
 * HTTPS, an API-key header, and the Bedrock InvokeModel operation. `bedrock()`
 * signs with AWS credentials against Converse, so it cannot reach it;
 * `invokeModelGateway()` can.
 *
 * Nothing here leaves the process: `fetch` is replaced by a scripted gateway
 * that answers the way a real one does — SSE `data:` lines on the stream
 * endpoint, a tool call whose arguments arrive in fragments, and a 403 when a
 * key is used for a model it is not scoped to.
 *
 *  1. **One agent, one tool loop, streamed.** The tool arguments reassemble
 *     from `input_json_delta`, the result goes back as a `tool_result`.
 *  2. **A key per model.** The gateway scopes keys to models; a map picks the
 *     right one by model id before every request.
 *  3. **Retries are composed.** A 429 arrives, `withRetry` waits and asks
 *     again. A 403 is not retried — the error names the model instead.
 *     (`withRetry` retries `complete()`; retrying a stream that fails before
 *     its first chunk is a separate change to `withRetry`, not this adapter.)
 *
 * Run it:
 *   npm run example examples/features/80-invoke-model-gateway.ts
 */

import { Agent, defineTool } from '../../src/index.js';
import {
  invokeModelGateway,
  InvokeModelGatewayError,
  type InvokeModelGatewayFetch,
} from '../../src/providers.js';
import { withRetry } from '../../src/resilience/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/80-invoke-model-gateway',
  title: 'Claude through your gateway',
  group: 'features',
  description:
    "Reach Anthropic models through an organisation's gateway that forwards the Bedrock InvokeModel operation with an API-key header: a streamed tool loop, a key per model, and retries composed with withRetry.",
  defaultInput: 'is record r-7 active?',
  providerSlots: [],
  tags: ['feature', 'provider', 'gateway', 'bedrock', 'anthropic', 'streaming', 'resilience'],
};

const HAIKU = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET = 'us.anthropic.claude-sonnet-4-6';

/** Bare SSE `data:` lines — what the gateway sends once it has decoded AWS's framing. */
const sse = (events: readonly unknown[]): Response =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

/**
 * A stand-in gateway. It checks the key against the model in the path (as a
 * real gateway scopes keys), optionally throttles the first request, then
 * answers: turn one calls the tool, turn two answers from its result.
 */
function scriptedGateway(log: string[], throttleFirst = false): InvokeModelGatewayFetch {
  const scopes: Record<string, string> = { 'haiku-key': HAIKU, 'sonnet-key': SONNET };
  let throttled = !throttleFirst;
  let turn = 0;
  return async (input, init) => {
    const url = String(input);
    const model = decodeURIComponent(url.split('/model/')[1]!.split('/')[0]!);
    const key = (init?.headers as Record<string, string>)['api-key']!;
    log.push(`POST …/model/${model}/${url.split('/').pop()}`);
    if (scopes[key] !== model) {
      return new Response(
        JSON.stringify({ message: `You do not currently have access to model <${model}>` }),
        { status: 403 },
      );
    }
    if (!throttled) {
      throttled = true;
      return new Response('Rate limit is exceeded.', {
        status: 429,
        headers: { 'retry-after': '1' },
      });
    }
    if (url.endsWith('/invoke')) {
      // complete(): one Messages JSON body, not a stream.
      return new Response(
        JSON.stringify({
          id: 'msg_0',
          model,
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 8, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    turn += 1;
    if (turn === 1) {
      return sse([
        {
          type: 'message_start',
          message: { id: 'msg_1', usage: { input_tokens: 42, output_tokens: 1 } },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
        },
        // The arguments arrive in fragments; the adapter reassembles them.
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"id":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"r-7"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
      ]);
    }
    return sse([
      {
        type: 'message_start',
        message: { id: 'msg_2', usage: { input_tokens: 70, output_tokens: 1 } },
      },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Record r-7 ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'is active.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } },
    ]);
  };
}

const lookup = defineTool<{ id: string }, string>({
  name: 'lookup',
  description: 'Look a record up by id',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  execute: ({ id }) => `${id}: active since 2026-03-01`,
});

export async function run(input: string): Promise<unknown> {
  const log: string[] = [];

  // #region provider
  const provider = withRetry(
    invokeModelGateway({
      baseUrl: 'https://llm-gateway.example.com/bedrock',
      apiKeyHeader: 'api-key',
      // One key per model: this gateway scopes keys, and the wrong one is a 403.
      apiKey: { [HAIKU]: 'haiku-key', [SONNET]: 'sonnet-key' },
      model: HAIKU,
      fetch: scriptedGateway(log), // ← drop this line to talk to the real gateway
    }),
  ); // a 429, a 5xx or a network failure is retried by withRetry, never inside the adapter
  // #endregion provider

  const agent = Agent.create({ provider, model: 'invoke-model-gateway' })
    .system('You look records up before answering.')
    .tool(lookup)
    .build();

  const answer = await agent.run({ message: input });
  for (const line of log) console.log(`  ${line}`);
  return answer;
}

/** A 429, absorbed by withRetry: two requests, one answer. */
export async function throttledOnce(): Promise<string> {
  // #region retry
  const log: string[] = [];
  const provider = withRetry(
    invokeModelGateway({
      baseUrl: 'https://llm-gateway.example.com/bedrock',
      apiKeyHeader: 'api-key',
      apiKey: 'sonnet-key',
      model: SONNET,
      fetch: scriptedGateway(log, true),
    }),
    { initialDelayMs: 10 },
  );
  await provider.complete({
    model: 'invoke-model-gateway',
    messages: [{ role: 'user', content: 'hi' }],
  });
  // #endregion retry
  return `${log.length} requests, answered after the 429`;
}

/** The refusal a key scoped to another model gets — named, and not retried. */
export async function scopedKeyRefusal(): Promise<string> {
  // #region refusal
  const provider = withRetry(
    invokeModelGateway({
      baseUrl: 'https://llm-gateway.example.com/bedrock',
      apiKeyHeader: 'api-key',
      apiKey: 'haiku-key', // one key for every model — wrong for Sonnet
      fetch: scriptedGateway([]),
    }),
  );
  try {
    await provider.complete({ model: SONNET, messages: [{ role: 'user', content: 'hi' }] });
    return '(no refusal — unexpected)';
  } catch (err) {
    if (err instanceof InvokeModelGatewayError && err.status === 403) {
      return `${err.reason} ${err.status} for ${err.modelId}`;
    }
    throw err;
  }
  // #endregion refusal
}

if (isCliEntry(import.meta.url)) {
  (async () => {
    console.log('— a streamed tool loop through the gateway —');
    const answer = await run(meta.defaultInput ?? '');
    console.log('\n— a 429, retried by withRetry —');
    console.log(`  ${await throttledOnce()}`);
    console.log('\n— the wrong key for a model —');
    console.log(`  ${await scopedKeyRefusal()}`);
    printResult(answer);
  })().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
