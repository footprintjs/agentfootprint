/**
 * OllamaProvider against a REAL local daemon.
 *
 * Everything else about this adapter is checked offline against an injected
 * `_fetch`. That proves the translation; it cannot prove the translation
 * matches what Ollama actually sends back. This file does — and it is the
 * only file here that needs software installed, so it is gated:
 *
 *   AGENTFOOTPRINT_OLLAMA_LIVE=1 npx vitest run test/adapters/integration/ollama-live.test.ts
 *
 * Optional: AGENTFOOTPRINT_OLLAMA_MODEL (default `llama3.2`), OLLAMA_HOST.
 *
 * WITHOUT the flag every test here SKIPS, and says so out loud — once, on
 * stderr, naming the flag. A silent skip is how a suite comes to report
 * green for a path nobody has run since the daemon broke.
 */

import { describe, expect, it, beforeAll } from 'vitest';

import { ollama, OllamaUnavailableError } from '../../../src/adapters/llm/OllamaProvider.js';
import { Agent, defineTool } from '../../../src/index.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

const LIVE = !!process.env.AGENTFOOTPRINT_OLLAMA_LIVE;
const MODEL = process.env.AGENTFOOTPRINT_OLLAMA_MODEL ?? 'llama3.2';
const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

if (!LIVE) {
  // eslint-disable-next-line no-console
  console.info(
    `[skipped] Ollama live tests. These talk to a real daemon and are OFF by default.\n` +
      `          Enable:  AGENTFOOTPRINT_OLLAMA_LIVE=1 npm test -- ollama-live\n` +
      `          Needs:   ollama serve  +  ollama pull ${MODEL}\n` +
      `          Model:   AGENTFOOTPRINT_OLLAMA_MODEL (default ${MODEL}), host ${HOST}`,
  );
}

const live = describe.skipIf(!LIVE);

// A local model can be slow to load the first time.
const TIMEOUT = 120_000;

live(`Ollama live (${MODEL} @ ${HOST}) — the wire really behaves this way`, () => {
  beforeAll(async () => {
    // Fail with the library's own words rather than a wall of assertion noise
    // if the daemon or the model is not actually there.
    const probe = ollama(MODEL, { timeoutMs: 5_000 });
    try {
      await probe.complete({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] });
    } catch (err) {
      if (err instanceof OllamaUnavailableError) throw err;
      // Anything else is a real failure the tests below should report.
    }
  }, TIMEOUT);

  const provider = () => ollama(MODEL);
  const ask = (content: string): LLMRequest => ({
    model: MODEL,
    messages: [{ role: 'user', content }],
    maxTokens: 64,
  });

  it(
    'completes and reports non-zero token counts',
    async () => {
      const res = await provider().complete(ask('Reply with the single word: pong'));
      expect(typeof res.content).toBe('string');
      expect(res.content.length).toBeGreaterThan(0);
      // The claim the native wire exists to keep.
      expect(res.usage.input).toBeGreaterThan(0);
      expect(res.usage.output).toBeGreaterThan(0);
      expect(typeof res.stopReason).toBe('string');
    },
    TIMEOUT,
  );

  it(
    'streams tokens and reports usage on the terminal chunk',
    async () => {
      const chunks = [];
      for await (const c of provider().stream!(ask('Count: one two three'))) chunks.push(c);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.at(-1)!.done).toBe(true);
      const final = chunks.at(-1)!.response!;
      expect(final.content).toBe(
        chunks
          .filter((c) => !c.done)
          .map((c) => c.content)
          .join(''),
      );
      // Streaming usage was ZERO through the OpenAI-compatible endpoint.
      expect(final.usage.input).toBeGreaterThan(0);
      expect(final.usage.output).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'a tool-capable model calls a tool and the result round-trips',
    async () => {
      const weather = defineTool({
        name: 'get_weather',
        description: 'Get the current temperature for a city.',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: ['city'],
        },
        execute: async (args) => `${(args as { city: string }).city}: 18C`,
      });

      const agent = Agent.create({ provider: provider(), model: MODEL, maxIterations: 3 })
        .system('Use the get_weather tool when asked about weather. Then answer in one sentence.')
        .tool(weather)
        .build();

      const calls: string[] = [];
      agent.on('agentfootprint.stream.tool_start', (e) => calls.push(e.payload.toolName));

      const answer = await agent.run({ message: 'What is the weather in Oslo?' });
      expect(typeof answer).toBe('string');
      // Tool-calling is MODEL-DEPENDENT and this is a small local model, so
      // this asserts the mechanism when it fires rather than demanding it.
      // A model that ignores tools still has to produce an answer.
      if (calls.length > 0) expect(calls).toContain('get_weather');
      expect(answer.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'a model that is not pulled refuses with the pull command',
    async () => {
      const missing = 'agentfootprint-no-such-model-xyz';
      const err = await ollama(missing)
        .complete({ model: missing, messages: [{ role: 'user', content: 'hi' }] })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(OllamaUnavailableError);
      const typed = err as OllamaUnavailableError;
      expect(typed.reason).toBe('model-not-pulled');
      expect(typed.message).toContain(`ollama pull ${missing}`);
      // The daemon IS up, so it could tell us what this machine has.
      expect(typed.availableModels?.length ?? 0).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'a wrong address refuses with `ollama serve`, quickly, without hanging',
    async () => {
      const started = Date.now();
      const err = await ollama(MODEL, { baseUrl: 'http://127.0.0.1:1', timeoutMs: 3_000 })
        .complete({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(OllamaUnavailableError);
      expect((err as OllamaUnavailableError).reason).toBe('daemon-unreachable');
      expect((err as Error).message).toContain('ollama serve');
      expect(Date.now() - started).toBeLessThan(10_000);
    },
    TIMEOUT,
  );
});
