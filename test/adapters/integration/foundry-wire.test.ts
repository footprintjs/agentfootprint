/**
 * foundry() against a FAKE Foundry wire — the real `openai` SDK, no cloud.
 *
 * The ONE design fact under test: `foundry()` really speaks the v1 dialect
 * on the wire. The unit file proves our translation through a `_client`
 * double; only a real SDK against a real socket can prove the four things
 * the double cannot see:
 *
 *   • the request lands on `/openai/v1/chat/completions` UNDER the project
 *     path (the doc-verified suffixing, byte for byte);
 *   • auth arrives as `Authorization: Bearer <the token the credential
 *     minted>` — the v1 route's header, not classic Azure's `api-key`;
 *   • the body carries `max_completion_tokens` and NEVER `max_tokens`, and a
 *     stream asks for `stream_options.include_usage` — the `legacyEndpoint:
 *     false` proof: a custom baseURL that is NOT demoted to the legacy
 *     dialect;
 *   • a token that ROTATES between calls reaches the second request — the
 *     per-request credential seam survives the SDK-client rebuild.
 *
 * Template: azure-openai-wire.test.ts. Needs no network and no credentials —
 * the endpoint is loopback, which is exactly the one place
 * `foundryInferenceUrl` accepts cleartext.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { foundry } from '../../../src/adapters/llm/FoundryProvider.js';
import type { AccessTokenLike, TokenCredentialLike } from '../../../src/adapters/identity/azure.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

// ─── The fake Foundry wire ──────────────────────────────────────────

interface RecordedRequest {
  readonly method: string;
  /** Path + query exactly as it arrived. */
  readonly url: string;
  readonly apiKeyHeader: string | undefined;
  readonly authorizationHeader: string | undefined;
  readonly body: Record<string, unknown>;
}

/** The token pieces the fake server streams — asserted verbatim downstream. */
const STREAM_PIECES = ['Hel', 'lo', ' Fo', 'undry'] as const;
const STREAM_TEXT = STREAM_PIECES.join('');
const PROMPT_TOKENS = 37;
const COMPLETION_TOKENS = 9;

/** The v1 route: /openai/v1 hangs directly off the PROJECT path — no
 *  deployment segment, no api-version query. */
const ROUTE = /^\/api\/projects\/([^/]+)\/openai\/v1\/chat\/completions$/;

class FakeFoundry {
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
        const [path] = url.split('?');
        const match = ROUTE.exec(path ?? '');
        if (!match) {
          // A wrong URL shape must LOOK wrong, not degrade into a mystery.
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `fake-foundry: no route for ${url}` } }));
          return;
        }
        const model = typeof body.model === 'string' ? body.model : 'unknown';
        if (body.stream === true) {
          this.writeStream(res, model);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-fake-foundry',
            model,
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

  private writeStream(res: import('node:http').ServerResponse, model: string): void {
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
        id: 'chatcmpl-fake-foundry',
        model,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      });
    }
    send({
      id: 'chatcmpl-fake-foundry',
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });
    // The v1 route sends usage on a FINAL chunk whose `choices` is empty, and
    // only when `stream_options.include_usage` asked for it.
    send({
      id: 'chatcmpl-fake-foundry',
      model,
      choices: [],
      usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** The PROJECT endpoint a consumer puts in FOUNDRY_PROJECT_ENDPOINT. */
  get projectEndpoint(): string {
    return `http://127.0.0.1:${this.port}/api/projects/proj-1`;
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
  'FOUNDRY_PROJECT_ENDPOINT',
  'AZURE_AI_MODEL_DEPLOYMENT_NAME',
  'MODEL_NAME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

const DEPLOYMENT = 'gpt-4o-foundry';

const server = new FakeFoundry();
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

/** A credential that mints `tok-1`, `tok-2`, … — one per getToken call. */
function rotatingCredential(): TokenCredentialLike & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    getToken: async (): Promise<AccessTokenLike> => {
      calls += 1;
      return { token: `tok-${calls}`, expiresOnTimestamp: Date.now() + 3600_000 };
    },
  };
}

const ask = (model: string): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'say hello' }],
});

// ─── The wire proofs ────────────────────────────────────────────────

describe('foundry() — the v1 route, driven by the real SDK', () => {
  it('lands on /openai/v1/chat/completions under the project path, Bearer-authed, model = deployment', async () => {
    const provider = foundry({
      projectEndpoint: server.projectEndpoint,
      deployment: DEPLOYMENT,
      credential: rotatingCredential(),
      defaultMaxTokens: 64,
    });
    const res = await provider.complete(ask('foundry'));
    expect(res.content).toBe(STREAM_TEXT);
    const rec = server.requests.at(-1)!;
    // The doc-verified derivation: project path + /openai/v1, nothing else —
    // no deployment segment, no api-version query.
    expect(rec.url).toBe('/api/projects/proj-1/openai/v1/chat/completions');
    // The v1 route's auth header — the token the fake credential minted, and
    // never classic Azure's api-key.
    expect(rec.authorizationHeader).toBe('Bearer tok-1');
    expect(rec.apiKeyHeader).toBeUndefined();
    // Foundry's "model" is the DEPLOYMENT name.
    expect(rec.body.model).toBe(DEPLOYMENT);
  });

  it('sends max_completion_tokens and NOT max_tokens — the legacyEndpoint:false proof', async () => {
    const provider = foundry({
      projectEndpoint: server.projectEndpoint,
      deployment: DEPLOYMENT,
      credential: rotatingCredential(),
      defaultMaxTokens: 64,
    });
    await provider.complete(ask('foundry'));
    const rec = server.requests.at(-1)!;
    // A bare `baseURL` would have implied the LEGACY dialect and sent
    // `max_tokens`; `foundry()` declares the current one.
    expect(rec.body.max_completion_tokens).toBe(64);
    expect(rec.body).not.toHaveProperty('max_tokens');
  });

  it('a streamed turn asks for stream_options.include_usage and reports the usage the wire sent', async () => {
    const provider = foundry({
      projectEndpoint: server.projectEndpoint,
      deployment: DEPLOYMENT,
      credential: rotatingCredential(),
    });
    const seen: string[] = [];
    let terminal: { content: string; usage: { input: number; output: number } } | undefined;
    for await (const chunk of provider.stream!(ask('foundry'))) {
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
    const rec = server.requests.at(-1)!;
    // The other half of the legacyEndpoint:false proof: a legacy baseURL
    // withholds stream_options; the v1 route is asked for its usage chunk.
    expect(rec.body.stream).toBe(true);
    expect(rec.body.stream_options).toEqual({ include_usage: true });
  });

  it('a token that rotates between calls reaches the second request', async () => {
    const credential = rotatingCredential();
    const provider = foundry({
      projectEndpoint: server.projectEndpoint,
      deployment: DEPLOYMENT,
      credential,
    });
    await provider.complete(ask('foundry'));
    await provider.complete(ask('foundry'));
    // One mint per request, and the SECOND request carries the SECOND token —
    // the SDK client was rebuilt around the changed string, not left holding
    // the stale one until a 401.
    expect(credential.calls()).toBe(2);
    expect(server.requests[0]!.authorizationHeader).toBe('Bearer tok-1');
    expect(server.requests[1]!.authorizationHeader).toBe('Bearer tok-2');
  });
});
