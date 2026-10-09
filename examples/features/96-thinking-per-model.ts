/**
 * 96 — Thinking in the shape each model takes: `.thinking({ budget })`.
 *
 * Claude models disagree about a request to think. Claude 4.7 and later think
 * ADAPTIVELY and reject a token budget with HTTP 400; 4.5 and earlier take only
 * a budget; the 4.6 models take both; Claude 3 before 3.7 cannot think at all.
 * `.thinking({ budget })` names the intent, and the Anthropic adapters send
 * what the model takes — from one table they declare per model
 * (`provider.thinkingMode(model)`), so a wrapper (`withRetry`, `withFallback`)
 * keeps it and the agent can refuse a model that cannot think at build.
 *
 * Nothing leaves the process: the SDK client is replaced by a stand-in that
 * records each request body.
 *
 * Run:  npm run example examples/features/96-thinking-per-model.ts
 */
import assert from 'node:assert/strict';
import { Agent } from '../../src/index.js';
import { anthropic, UnsupportedThinkingError } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/96-thinking-per-model',
  title: 'Thinking per model',
  group: 'features',
  description:
    'One .thinking({ budget }) on three Claude models: adaptive thinking on Opus 5.5 (no budget on the wire), budget_tokens on Haiku 4.5, and a build-time refusal for Claude 3 Haiku, which cannot think.',
  defaultInput: 'Is 2^61 - 1 prime?',
  providerSlots: [],
  tags: ['features', 'provider', 'anthropic', 'thinking'],
};

type Body = Record<string, unknown>;

/** A stand-in for `@anthropic-ai/sdk`: records each request body, answers "ok". */
function recordingClient(bodies: Body[]) {
  const reply = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'stand-in',
    content: [{ type: 'text', text: 'Yes — it is a Mersenne prime.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 12, output_tokens: 9 },
  };
  const record = (params: unknown) => bodies.push(params as Body);
  return {
    messages: {
      create: async (params: unknown) => (record(params), reply),
      stream: (params: unknown) => {
        record(params);
        return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => reply };
      },
    },
  } as never;
}

export async function run(input: string): Promise<unknown> {
  const bodies: Body[] = [];

  // #region per-model
  const provider = anthropic({
    _client: recordingClient(bodies), // ← drop this line to talk to the real API
  });
  provider.thinkingMode?.('claude-opus-5-5'); // 'adaptive'
  provider.thinkingMode?.('claude-haiku-4-5'); // 'budget'

  for (const model of ['claude-opus-5-5', 'claude-haiku-4-5']) {
    const agent = Agent.create({ provider, model })
      .system('Think it through, then answer in one line.')
      .thinking({ budget: 4000 })
      .build();
    await agent.run({ message: input });
  }
  // Opus 5.5:  thinking: { type: 'adaptive', display: 'summarized' } — no budget sent
  // Haiku 4.5: thinking: { type: 'enabled', budget_tokens: 4000 }
  // #endregion per-model

  assert.deepEqual(bodies[0]!.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(bodies[1]!.thinking, { type: 'enabled', budget_tokens: 4000 });

  // #region refused
  let refusal: UnsupportedThinkingError | undefined;
  try {
    Agent.create({ provider, model: 'claude-3-haiku-20240307' })
      .system('Think it through.')
      .thinking({ budget: 4000 })
      .build();
  } catch (err) {
    if (!(err instanceof UnsupportedThinkingError)) throw err;
    refusal = err; // at build, by name: err.model, err.reason === 'no-thinking'
  }
  // #endregion refused

  assert.equal(refusal?.reason, 'no-thinking');
  assert.equal(bodies.length, 2); // the refused agent sent nothing

  return {
    'claude-opus-5-5': bodies[0]!.thinking,
    'claude-haiku-4-5': bodies[1]!.thinking,
    'claude-3-haiku-20240307': refusal?.message,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
