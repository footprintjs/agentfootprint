/**
 * bench/cache/verify-haiku.mjs — ONE paid check that the cache really hits on the wire.
 *
 * A real agent on `claude-haiku-4-5`, through the package's own adapter wrapped in the library's
 * own `withRetry` (the renamed provider that used to send no cache markers at all): two turns,
 * a tool call in each, so four model calls. The system prompt is a ~6,000-token reference table,
 * above Haiku 4.5's 4,096-token caching minimum. From the second call on, every call should READ
 * the prefix the call before it wrote — the stable head (tools + system) and the moving
 * conversation breakpoint. The script prints the API's own `usage` numbers for each call and a
 * verdict; nothing is inferred.
 *
 *   npm run build
 *   node bench/cache/verify-haiku.mjs --rehearse        # $0: a stub client, no key, no network
 *   node --env-file=<a file holding ANTHROPIC_API_KEY> bench/cache/verify-haiku.mjs
 *
 * Spend guards, all enforced in code: Haiku 4.5 only; at most 6 calls (the SDK's own retries are
 * off and `withRetry` gets one attempt, so a refused call is never paid twice); `max_tokens` 300;
 * the run refuses to start if its worst-case estimate exceeds $0.50. Expect about $0.02.
 * The key is read by the SDK from the environment and never printed.
 */
import { lookupTable } from './verify-fixture.mjs';

const MODEL = 'claude-haiku-4-5';
const MAX_CALLS = 6;
const MAX_TOKENS = 300;
const MAX_USD = 0.5;
// USD per million tokens, Haiku 4.5: input $1, output $5, a 5-minute cache write 1.25×, a read 0.1×.
const PRICE = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };

const REHEARSE = process.argv.includes('--rehearse');
if (!REHEARSE && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set — run with node --env-file=<file>, or --rehearse.');
  process.exit(2);
}

const [{ Agent, defineTool }, { anthropic }, { withRetry }] = await Promise.all([
  import('agentfootprint'),
  import('agentfootprint/providers'),
  import('agentfootprint/resilience'),
]);

/**
 * `--rehearse`: a stub with the SDK's two methods — tool call, answer, tool call, answer — that
 * reports the usage a working cache would (everything before the last breakpoint read back after
 * the first call). It proves the script and the agent wiring for $0; it proves nothing about the
 * API, which is what the paid run is for.
 */
function rehearsalClient() {
  let n = 0;
  const reply = (params) => {
    n += 1;
    const tool = n % 2 === 1;
    const prompt = JSON.stringify(params).length / 3;
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: tool
        ? [
            {
              type: 'tool_use',
              id: `toolu_${n}`,
              name: 'lookup',
              input: { key: n < 2 ? 'k017' : 'k142' },
            },
          ]
        : [{ type: 'text', text: 'k017 is owned by team-19 and is live green.' }],
      stop_reason: tool ? 'tool_use' : 'end_turn',
      usage: {
        input_tokens: 40,
        output_tokens: 20,
        cache_creation_input_tokens: n === 1 ? Math.round(prompt) : 60,
        cache_read_input_tokens: n === 1 ? 0 : Math.round(prompt) - 100,
      },
    };
  };
  return {
    messages: {
      create: async (params) => reply(params),
      stream: (params) => {
        const message = reply(params);
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => message,
        };
      },
    },
  };
}

async function realClient() {
  const sdk = await import('@anthropic-ai/sdk');
  const Anthropic = sdk.default ?? sdk.Anthropic;
  return new Anthropic({ maxRetries: 0, timeout: 60_000 });
}

const SYSTEM = [
  'You are the operations desk for a fleet of relays. Answer only from the reference table',
  'below or from the lookup tool. Keep every answer to one sentence.',
  '',
  lookupTable(),
].join('\n');

// Worst case before anything is sent: every call writes the whole prompt, then answers in full.
const promptTokens = Math.ceil(SYSTEM.length / 3) + 1_000;
const worstUsd =
  (MAX_CALLS * (promptTokens * PRICE.cacheWrite + MAX_TOKENS * PRICE.output)) / 1_000_000;
if (worstUsd > MAX_USD) {
  console.error(`refused: worst-case estimate $${worstUsd.toFixed(3)} exceeds $${MAX_USD}.`);
  process.exit(3);
}

// The SDK client, wrapped only to cap the calls and keep each call's raw usage.
const real = REHEARSE ? rehearsalClient() : await realClient();
const calls = [];
function admit(params) {
  if (calls.length >= MAX_CALLS) throw new Error(`call cap: ${MAX_CALLS} calls already made`);
  if (params.model !== MODEL) throw new Error(`refused: model ${params.model} is not ${MODEL}`);
  const marks = JSON.stringify(params).split('"cache_control"').length - 1;
  const call = { n: calls.length + 1, breakpoints: marks, usage: undefined };
  calls.push(call);
  return call;
}
const client = {
  messages: {
    create: async (params) => {
      const call = admit(params);
      const message = await real.messages.create(params);
      call.usage = message.usage;
      return message;
    },
    stream: (params) => {
      const call = admit(params);
      const stream = real.messages.stream(params);
      return {
        [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
        finalMessage: async () => {
          const message = await stream.finalMessage();
          call.usage = message.usage;
          return message;
        },
      };
    },
  },
};

const lookup = defineTool({
  name: 'lookup',
  description: 'Read one relay row from the live table by its key, e.g. "k017".',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string', description: 'The relay key, k001–k250.' } },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async ({ key }) => `${key}: live status green, last heartbeat 12 seconds ago.`,
});

const provider = withRetry(anthropic({ _client: client, defaultModel: MODEL }), {
  maxAttempts: 1,
});
const agent = Agent.create({
  provider,
  model: MODEL,
  maxIterations: 3,
  maxTokens: MAX_TOKENS,
  // The table is deliberately large (see verify-fixture.mjs); say so, so the slot does not warn.
  contextBudget: { systemPrompt: 40_000 },
})
  .system(SYSTEM)
  .tool(lookup)
  .build();

console.log(`provider: ${provider.name} (declares ${JSON.stringify(provider.promptCaching)})`);
console.log(`system prompt: ${SYSTEM.length} chars\n`);
await agent.run({
  message: 'Use the lookup tool on k017, then tell me its owner and live status.',
});
await agent.followUp('Now use the lookup tool on k142 and tell me its live status.');

const cost = (u) =>
  ((u.input_tokens ?? 0) * PRICE.input +
    (u.output_tokens ?? 0) * PRICE.output +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
  1_000_000;
let total = 0;
console.log(
  '| call | breakpoints | input | cache_creation_input_tokens | cache_read_input_tokens | output | USD |',
);
console.log('|---:|---:|---:|---:|---:|---:|---:|');
for (const c of calls) {
  const u = c.usage ?? {};
  total += cost(u);
  console.log(
    `| ${c.n} | ${c.breakpoints} | ${u.input_tokens} | ${u.cache_creation_input_tokens} | ` +
      `${u.cache_read_input_tokens} | ${u.output_tokens} | ${cost(u).toFixed(5)} |`,
  );
}
const later = calls.slice(1);
const read = later.every((c) => (c.usage?.cache_read_input_tokens ?? 0) > 0);
console.log(
  `\n${calls.length} calls, $${total.toFixed(4)} total${
    REHEARSE ? ' (rehearsal — stub usage, nothing spent)' : ''
  }.`,
);
console.log(
  read
    ? `PASS — every call from the second on read the cache (${later
        .map((c) => c.usage.cache_read_input_tokens)
        .join(', ')} tokens).`
    : 'FAIL — a call after the first read nothing from the cache.',
);
process.exit(read ? 0 : 1);
