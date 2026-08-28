/**
 * Azure OpenAI against a FAKE Azure wire — the real `openai` SDK, no cloud.
 *
 * Every other Azure test in this repo injects a `_client` double. That proves
 * our translation of requests and responses; it cannot prove that the real
 * `AzureOpenAI` client can even be CONSTRUCTED from the environment we
 * document, nor that what its `create()` hands back is the shape our streaming
 * loop iterates. Both of those broke in the field, and both were invisible to a
 * double: a double is constructed by `new Object()` and returns an async
 * generator directly.
 *
 * So this file stands up a local HTTP server that speaks the Azure OpenAI wire
 * (deployment-scoped path, `api-key` header, `api-version` query, JSON and SSE
 * bodies), points the REAL SDK at it through `providerFromEnv()`, and drives a
 * real agent turn. It needs no network and no credentials.
 *
 * The two field failures it pins:
 *
 *   BUG 1  `OPENAI_BASE_URL` (the alias our own docs advertise) could not boot:
 *          the SDK reads that same variable as its `baseURL` default while we
 *          passed the value again as `endpoint`, and the SDK refuses both at
 *          once — "baseURL and endpoint are mutually exclusive".
 *   BUG 2  With the other spelling it booted, then the first streamed turn died
 *          on "[openai] stream is not async iterable": `create({stream:true})`
 *          returns an `APIPromise`, and the streaming loop iterated it without
 *          awaiting it.
 *
 * And the part a reader cannot check by eye: BOTH spellings must produce the
 * SAME final URL. The SDK appends `/openai` to an `endpoint` and uses a
 * `baseURL` verbatim, so "just move the value to the other slot" is a URL bug
 * waiting to happen. The equality is asserted byte for byte below.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { providerFromEnv } from '../../../src/adapters/llm/createProvider.js';
import { azureOpenai } from '../../../src/adapters/llm/OpenAIProvider.js';
import { Agent } from '../../../src/index.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

// ─── The fake Azure wire ────────────────────────────────────────────

interface RecordedRequest {
  readonly method: string;
  /** Path + query exactly as it arrived. */
  readonly url: string;
  readonly apiKeyHeader: string | undefined;
  readonly authorizationHeader: string | undefined;
  readonly body: Record<string, unknown>;
}

/** The token pieces the fake server streams — asserted verbatim downstream. */
const STREAM_PIECES = ['Hel', 'lo', ' Az', 'ure'] as const;
const STREAM_TEXT = STREAM_PIECES.join('');
const PROMPT_TOKENS = 41;
const COMPLETION_TOKENS = 7;

const ROUTE = /^\/openai\/deployments\/([^/]+)\/chat\/completions$/;

class FakeAzure {
  readonly requests: RecordedRequest[] = [];
  private server!: Server;
  private port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: Record<string, unknown> = {};
        try {
          body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          body = {};
        }
        const url = req.url ?? '';
        this.requests.push({
          method: req.method ?? '',
          url,
          apiKeyHeader: header(req.headers['api-key']),
          authorizationHeader: header(req.headers.authorization),
          body,
        });
        const [path, query = ''] = url.split('?');
        const match = ROUTE.exec(path ?? '');
        if (!match) {
          // A wrong URL shape must LOOK wrong, not degrade into a mystery.
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `fake-azure: no route for ${url}` } }));
          return;
        }
        if (!new URLSearchParams(query).get('api-version')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'fake-azure: missing api-version' } }));
          return;
        }
        const deployment = match[1]!;
        if (body.stream === true) {
          this.writeStream(res, deployment);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-fake',
            model: deployment,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: STREAM_TEXT },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  private writeStream(res: import('node:http').ServerResponse, deployment: string): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (payload: unknown): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    for (const piece of STREAM_PIECES) {
      send({
        id: 'chatcmpl-fake',
        model: deployment,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      });
    }
    send({
      id: 'chatcmpl-fake',
      model: deployment,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });
    // Azure sends usage on a FINAL chunk whose `choices` is empty, and only
    // when `stream_options.include_usage` asked for it.
    send({
      id: 'chatcmpl-fake',
      model: deployment,
      choices: [],
      usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** The resource root a consumer puts in `OPENAI_BASE_URL` / `AZURE_OPENAI_ENDPOINT`. */
  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  reset(): void {
    this.requests.length = 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// ─── Env harness ────────────────────────────────────────────────────

const VARS = [
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'OPENAI_BASE_URL',
  'OPENAI_API_VERSION',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_DEPLOYMENT',
  'MODEL_NAME',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'LLM_MODEL',
  'OLLAMA_MODEL',
  'OLLAMA_HOST',
  'FOUNDRY_PROJECT_ENDPOINT',
  'AZURE_AI_MODEL_DEPLOYMENT_NAME',
  'FOUNDRY_LOCAL_MODEL',
  'FOUNDRY_LOCAL_ENDPOINT',
  'FOUNDRY_LOCAL_BASE_URL',
] as const;

const DEPLOYMENT = 'gpt-4o-128k';
const API_VERSION = '2024-12-01-preview';

const server = new FakeAzure();
let saved: Record<string, string | undefined>;

beforeAll(async () => {
  await server.start();
});
afterAll(async () => {
  await server.stop();
});
beforeEach(() => {
  saved = {};
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
  server.reset();
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

/** The consumer's env, minus which spelling names the endpoint. */
function setConsumerEnv(spelling: 'OPENAI_BASE_URL' | 'AZURE_OPENAI_ENDPOINT' | 'both'): void {
  process.env.AZURE_OPENAI_API_KEY = 'sek-ret-not-a-real-key';
  process.env.AZURE_OPENAI_API_VERSION = API_VERSION;
  process.env.MODEL_NAME = DEPLOYMENT;
  if (spelling === 'OPENAI_BASE_URL' || spelling === 'both') {
    process.env.OPENAI_BASE_URL = server.endpoint;
  }
  if (spelling === 'AZURE_OPENAI_ENDPOINT' || spelling === 'both') {
    process.env.AZURE_OPENAI_ENDPOINT = server.endpoint;
  }
}

const ask = (model: string): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'say hello' }],
});

// ─── BUG 1: the documented spelling must boot ───────────────────────

describe('Azure door — BUG 1: OPENAI_BASE_URL is the endpoint alias we document', () => {
  it('boots from OPENAI_BASE_URL alone (the field config)', () => {
    setConsumerEnv('OPENAI_BASE_URL');
    // Before the fix this threw `baseURL and endpoint are mutually exclusive`:
    // the SDK picked OPENAI_BASE_URL up from the environment as `baseURL`
    // while we handed the same value in as `endpoint`.
    const resolved = providerFromEnv();
    expect(resolved.kind).toBe('azure-openai');
    expect(resolved.provider.name).toBe('azure-openai');
  });

  it('boots from AZURE_OPENAI_ENDPOINT alone', () => {
    setConsumerEnv('AZURE_OPENAI_ENDPOINT');
    expect(providerFromEnv().kind).toBe('azure-openai');
  });

  it('boots with BOTH spellings set to the same value', () => {
    setConsumerEnv('both');
    expect(providerFromEnv().kind).toBe('azure-openai');
  });

  it('reports the DEPLOYMENT as the model, never the kind label "azure"', () => {
    // `model` is handed straight to `Agent.create({ provider, model })` and
    // then quoted in traces, budgets and logs. A kind label there is a lie a
    // reader cannot catch: it looks like a model id and names no deployment.
    setConsumerEnv('OPENAI_BASE_URL');
    expect(providerFromEnv().model).toBe(DEPLOYMENT);
  });
});

// ─── The URL-equality proof ─────────────────────────────────────────

describe('Azure door — both spellings produce the SAME final URL', () => {
  async function urlFor(
    spelling: 'OPENAI_BASE_URL' | 'AZURE_OPENAI_ENDPOINT' | 'both',
    endpointOverride?: string,
  ): Promise<string> {
    setConsumerEnv(spelling);
    if (endpointOverride) {
      if (process.env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = endpointOverride;
      if (process.env.AZURE_OPENAI_ENDPOINT) process.env.AZURE_OPENAI_ENDPOINT = endpointOverride;
    }
    const before = server.requests.length;
    await providerFromEnv().provider.complete(ask('azure'));
    return server.requests[before]!.url;
  }

  it('OPENAI_BASE_URL, AZURE_OPENAI_ENDPOINT and both-at-once hit one identical URL', async () => {
    const viaBaseUrl = await urlFor('OPENAI_BASE_URL');
    const viaEndpoint = await urlFor('AZURE_OPENAI_ENDPOINT');
    const viaBoth = await urlFor('both');
    expect(viaBaseUrl).toBe(
      `/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`,
    );
    expect(viaEndpoint).toBe(viaBaseUrl);
    expect(viaBoth).toBe(viaBaseUrl);
  });

  it('a trailing slash on the endpoint changes nothing', async () => {
    const plain = await urlFor('OPENAI_BASE_URL');
    const slashed = await urlFor('OPENAI_BASE_URL', `${server.endpoint}/`);
    expect(slashed).toBe(plain);
  });

  it('an endpoint already ending in /openai is not doubled', async () => {
    // Someone who read `OPENAI_BASE_URL` as the SDK's baseURL rather than as
    // the resource root writes the `/openai` themselves. Appending a second one
    // would 404 — accepted and silently wrong.
    const plain = await urlFor('OPENAI_BASE_URL');
    const explicit = await urlFor('OPENAI_BASE_URL', `${server.endpoint}/openai`);
    expect(explicit).toBe(plain);
  });

  it('authenticates with the api-key header, never Authorization: Bearer', async () => {
    setConsumerEnv('OPENAI_BASE_URL');
    await providerFromEnv().provider.complete(ask('azure'));
    const rec = server.requests.at(-1)!;
    expect(rec.apiKeyHeader).toBe('sek-ret-not-a-real-key');
    expect(rec.authorizationHeader).toBeUndefined();
  });
});

// ─── BUG 2: the streamed turn ───────────────────────────────────────

describe('Azure door — BUG 2: a streamed turn against the real SDK', () => {
  it('streams token by token and reports the usage the wire sent', async () => {
    setConsumerEnv('AZURE_OPENAI_ENDPOINT');
    const { provider } = providerFromEnv();
    const seen: string[] = [];
    let terminal: { content: string; usage: { input: number; output: number } } | undefined;
    // Before the fix this threw `[openai] stream is not async iterable`:
    // `create({ stream: true })` hands back an APIPromise, which is a Promise
    // and not an async iterable, and it was iterated without being awaited.
    for await (const chunk of provider.stream!(ask('azure'))) {
      if (chunk.done) {
        terminal = {
          content: chunk.response!.content,
          usage: chunk.response!.usage as { input: number; output: number },
        };
        break;
      }
      seen.push(chunk.content);
    }
    expect(seen).toEqual([...STREAM_PIECES]);
    expect(terminal?.content).toBe(STREAM_TEXT);
    expect(terminal?.usage).toEqual({ input: PROMPT_TOKENS, output: COMPLETION_TOKENS });
  });

  it('drives a whole agent turn — tokens arrive one at a time, answer is the wire text', async () => {
    setConsumerEnv('OPENAI_BASE_URL');
    const { provider, model } = providerFromEnv();
    const agent = Agent.create({ provider, model }).system('be brief').build();
    const tokens: string[] = [];
    agent.on('agentfootprint.stream.token', (e) => {
      tokens.push((e.payload as { content: string }).content);
    });
    const answer = await agent.run({ message: 'say hello' });
    // One event per wire chunk — not one blob at the end.
    expect(tokens).toEqual([...STREAM_PIECES]);
    expect(answer).toBe(STREAM_TEXT);
    // And the deployment, not a kind label, is what went on the wire.
    const posted = server.requests.at(-1)!;
    expect(posted.body.model).toBe(DEPLOYMENT);
    expect(posted.body.stream).toBe(true);
  });

  it('asks Azure for the usage chunk (stream_options.include_usage)', async () => {
    setConsumerEnv('AZURE_OPENAI_ENDPOINT');
    const { provider } = providerFromEnv();
    for await (const chunk of provider.stream!(ask('azure'))) {
      if (chunk.done) break;
    }
    expect(server.requests.at(-1)!.body.stream_options).toEqual({ include_usage: true });
  });
});

// ─── Zero delta for the arms that are not Azure ─────────────────────

describe('Azure door — the other arms are untouched', () => {
  it('OPENAI_BASE_URL WITHOUT an Azure key is not an Azure config', () => {
    // The alias only means "Azure endpoint" alongside AZURE_OPENAI_API_KEY.
    // On its own it is what it has always been: the OpenAI SDK's base URL,
    // read by the SDK itself, on the plain OpenAI arm.
    process.env.OPENAI_BASE_URL = server.endpoint;
    process.env.OPENAI_API_KEY = 'sek-ret-not-a-real-key';
    const r = providerFromEnv();
    expect(r.kind).toBe('openai');
    expect(r.model).toBe('openai');
  });

  it('OLLAMA_MODEL still wins over a full Azure config', () => {
    setConsumerEnv('OPENAI_BASE_URL');
    process.env.OLLAMA_MODEL = 'qwen3';
    const r = providerFromEnv();
    expect(r.kind).toBe('ollama');
    expect(r.model).toBe('qwen3');
  });

  it('FOUNDRY_LOCAL_MODEL also outranks this full, bootable Azure config — a typed model NAME is a declaration', () => {
    // Same law as the Ollama case above, proven against an Azure config the
    // fake server would genuinely serve: the local-model arms trigger on a
    // NAME someone typed, and a name beats a credential every time.
    setConsumerEnv('both');
    process.env.FOUNDRY_LOCAL_MODEL = 'qwen2.5-0.5b';
    const r = providerFromEnv();
    expect(r.kind).toBe('foundry-local');
    expect(r.provider.name).toBe('foundry-local');
    expect(r.model).toBe('qwen2.5-0.5b');
  });

  it('no creds at all still falls to the mock and still refuses by name', () => {
    expect(providerFromEnv({ fallbackToMock: true }).kind).toBe('mock');
    expect(() => providerFromEnv()).toThrow(/no provider declared/i);
  });
});

// ─── The direct factory takes the same two spellings ────────────────

describe('azureOpenai() built by hand takes either spelling', () => {
  it('accepts a resource root as `endpoint` while OPENAI_BASE_URL is also set', async () => {
    // The ambient variable is the SDK's own `baseURL` default. An explicit
    // option must win over it rather than collide with it.
    process.env.OPENAI_BASE_URL = 'https://ambient.example.invalid';
    const provider = azureOpenai({
      endpoint: server.endpoint,
      apiKey: 'sek-ret-not-a-real-key',
      apiVersion: API_VERSION,
      deployment: DEPLOYMENT,
    });
    await provider.complete(ask('azure'));
    expect(server.requests.at(-1)!.url).toBe(
      `/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`,
    );
  });
});

// ─── Keyless: the Entra credential path (9.74.0) ────────────────────

describe('Azure door — keyless: a credential authenticates as Authorization: Bearer', () => {
  it('sends the token the credential minted, and no api-key header', async () => {
    // The SDK's azureADTokenProvider door: with a `credential` (and NO apiKey)
    // the real AzureOpenAI client asks the provider before the request and
    // sends the answer as `Authorization: Bearer` — classic key auth's
    // `api-key` header must NOT appear.
    const provider = azureOpenai({
      endpoint: server.endpoint,
      credential: {
        getToken: async () => ({
          token: 'entra-tok-wire-1',
          expiresOnTimestamp: Date.now() + 3600_000,
        }),
      },
      apiVersion: API_VERSION,
      deployment: DEPLOYMENT,
    });
    await provider.complete(ask('azure'));
    const rec = server.requests.at(-1)!;
    // Same deployment-scoped URL as the keyed path — auth changes, routing
    // does not.
    expect(rec.url).toBe(
      `/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`,
    );
    expect(rec.authorizationHeader).toBe('Bearer entra-tok-wire-1');
    expect(rec.apiKeyHeader).toBeUndefined();
  });

  it('an ambient AZURE_OPENAI_API_KEY does not collide with an explicit credential', async () => {
    // The SDK defaults a MISSING `apiKey` from this env var and refuses a key
    // beside a token provider ("mutually exclusive"). An explicit `credential`
    // must beat the ambient read — the same stance BUG 1 settled for
    // OPENAI_BASE_URL — and the env key must never reach the wire.
    process.env.AZURE_OPENAI_API_KEY = 'sk-azure-DO-NOT-LEAK-9f4c';
    const provider = azureOpenai({
      endpoint: server.endpoint,
      credential: {
        getToken: async () => ({
          token: 'entra-tok-wire-2',
          expiresOnTimestamp: Date.now() + 3600_000,
        }),
      },
      apiVersion: API_VERSION,
      deployment: DEPLOYMENT,
    });
    await provider.complete(ask('azure'));
    const rec = server.requests.at(-1)!;
    expect(rec.authorizationHeader).toBe('Bearer entra-tok-wire-2');
    expect(rec.apiKeyHeader).toBeUndefined();
  });
});
