/**
 * The `answer-account` op over a REAL socket (explain-answer af-3): the door
 * guard in front of it, the grammar that reads it, and the real recording —
 * put into an artifact store and explained over HTTP.
 *
 * The laws being pinned:
 *   • The 9.115.0 door guard runs before the op: a cross-site Origin (403), a
 *     non-JSON content type (415), a foreign Host (421) and a bad session id
 *     (400) never reach the store.
 *   • `{ op: 'answer-account', ref }` reads `op`, `ref` and the session only;
 *     any other body key is refused by name — the declarations are the HOST's.
 *   • The field recording, served: the response equals `accountForAnswer` over
 *     the same bytes, stays within its caps, and carries none of the record's
 *     denied content (skill bodies, tool arguments, the app's instructions,
 *     raw tool results, a decision's `why`).
 *   • Measured, not claimed: parse + fold + show-me on the field recording.
 */

import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, inMemoryArtifacts, recordingPutInput } from '../../src/index.js';
import type { ArtifactStore } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer } from '../../src/lib/answer-account/index.js';
import { showLeaves } from '../../src/lib/answer-account/shown.js';
import { agentCoreRuntimeHost } from '../../src/hosting-providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/hosting/index.js';
import type { CrossSiteOptions, HostHandle } from '../../src/hosting/index.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import {
  deniedLeaves,
  fixtureA,
  FLAGSHIP_RUN_ID,
  NEO_DECLARATIONS,
} from '../lib/answer-account/helpers.js';

/** The archived field recording (4–5 MB). Outside the repo, so its cases skip where it is absent. */
const FIELD_RECORDING =
  '/Users/sanjay/github/footprintjs/session-archive/2026-09-25-multiuser-eval/turn-account/recording-turn2.json';
const haveField = existsSync(FIELD_RECORDING);

const open: HostHandle[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((handle) => handle.close()));
});

/** A store that counts every read. */
function countingStore() {
  const inner = inMemoryArtifacts();
  let reads = 0;
  const store: ArtifactStore = {
    ...inner,
    put: (scope, input) => inner.put(scope, input),
    head: (scope, ref) => {
      reads += 1;
      return inner.head(scope, ref);
    },
    get: (scope, ref) => {
      reads += 1;
      return inner.get(scope, ref);
    },
    delete: (scope, ref) => inner.delete(scope, ref),
    list: (scope, options) => inner.list(scope, options),
  };
  return { store, reads: () => reads };
}

/** A standing agent on a real socket, opted in, serving `store`. */
async function door(store: ArtifactStore, guard: CrossSiteOptions = {}) {
  const handle = await standingAgent({
    agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm', artifacts: store }).build(),
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: '127.0.0.1', ...guard }),
    answerAccounts: { declarations: NEO_DECLARATIONS },
  });
  open.push(handle);
  return handle;
}

/** One raw request — every header, `Host` included, under the test's control. */
function send(
  port: number,
  init: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: string;
    readonly path?: string;
  },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: init.path ?? '/invoke',
        headers: { ...init.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.write(init.body);
    req.end();
  });
}

/**
 * Every string value in a JSON value — keys excluded, and so are template ids
 * (`{ template: { id } }`): both are the library's own vocabulary, never
 * content from the record (the field record's state holds the word "standing";
 * the template `howSure.standing.none` is not a leak of it).
 */
function stringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringValues(v, out));
  else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'template') continue;
      stringValues(child, out);
    }
  }
  return out;
}

const opBody = (ref: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ op: 'answer-account', ref, ...extra });

async function putRecording(store: ArtifactStore, sessionId: string, recording: unknown) {
  const minted = await store.put(
    { conversationId: sessionId },
    recordingPutInput(recording, { runId: FLAGSHIP_RUN_ID }),
  );
  return minted.meta.ref;
}

// ─── The door guard, in front of the op ─────────────────────────────

describe('answer-account over HTTP — the door guard runs first (security)', () => {
  it('403 / 415 / 421 / 400 before the handler: the store is never read', async () => {
    const { store, reads } = countingStore();
    const handle = await door(store, { allowedHosts: ['127.0.0.1'] });
    const ref = await putRecording(store, 's-1', fixtureA());
    const json = { 'content-type': 'application/json', 'x-session-id': 's-1' };

    const crossSite = await send(handle.port, {
      headers: { ...json, origin: 'https://evil.example' },
      body: opBody(ref),
    });
    const notJson = await send(handle.port, {
      headers: { 'content-type': 'text/plain', 'x-session-id': 's-1' },
      body: opBody(ref),
    });
    const rebinding = await send(handle.port, {
      headers: { ...json, host: 'evil.example' },
      body: opBody(ref),
    });
    const badSession = await send(handle.port, {
      headers: { 'content-type': 'application/json' },
      body: opBody(ref, { sessionId: 's\u0007bell' }),
    });
    expect(crossSite.status).toBe(403);
    expect(notJson.status).toBe(415);
    expect(rebinding.status).toBe(421);
    expect(badSession.status).toBe(400);
    expect(JSON.parse(badSession.body).code).toBe('ERR_INVALID_SESSION_ID');
    expect(reads()).toBe(0);

    // The same request, from the page's own origin, is served.
    const own = await send(handle.port, {
      headers: { ...json, origin: `http://127.0.0.1:${handle.port}` },
      body: opBody(ref),
    });
    expect(own.status).toBe(200);
  });
});

// ─── The per-session in-flight bound, over HTTP ─────────────────────

describe('artifact ops over HTTP — the per-session bound answers 429', () => {
  it('a session over its bound gets 429 ERR_ARTIFACT_OPS_BUSY; another session gets 200', async () => {
    const inner = inMemoryArtifacts();
    let release: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => (release = resolve));
    let waiting = 0;
    const store: ArtifactStore = {
      ...inner,
      put: (scope, input) => inner.put(scope, input),
      head: (scope, ref) => inner.head(scope, ref),
      get: async (scope, ref) => {
        if (scope.conversationId === 's-busy') {
          waiting += 1;
          await opened;
        }
        return inner.get(scope, ref);
      },
      delete: (scope, ref) => inner.delete(scope, ref),
      list: (scope, options) => inner.list(scope, options),
    };
    const handle = await standingAgent({
      agent: Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: store,
      }).build(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
      answerAccounts: true,
      artifactOpsPerSession: 1,
    });
    open.push(handle);
    const busyRef = await putRecording(store, 's-busy', fixtureA());
    const calmRef = await putRecording(store, 's-calm', fixtureA());
    const json = (session: string) => ({
      'content-type': 'application/json',
      'x-session-id': session,
    });

    const held = send(handle.port, { headers: json('s-busy'), body: opBody(busyRef) });
    for (let i = 0; i < 200 && waiting === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(waiting).toBe(1);
    const over = await send(handle.port, {
      headers: json('s-busy'),
      body: JSON.stringify({ op: 'artifact-head', ref: busyRef }),
    });
    expect(over.status).toBe(429);
    expect(JSON.parse(over.body).code).toBe('ERR_ARTIFACT_OPS_BUSY');
    const calm = await send(handle.port, { headers: json('s-calm'), body: opBody(calmRef) });
    expect(calm.status).toBe(200);
    release();
    expect((await held).status).toBe(200);
  });
});

// ─── The grammar ─────────────────────────────────────────────────────

describe('answer-account over HTTP — the grammar', () => {
  it('any body key but op, ref and sessionId is refused by name (400); nothing is read', async () => {
    const { store, reads } = countingStore();
    const handle = await door(store);
    const ref = await putRecording(store, 's-1', fixtureA());
    const got = await send(handle.port, {
      headers: { 'content-type': 'application/json', 'x-session-id': 's-1' },
      body: opBody(ref, { declarations: { skills: {} } }),
    });
    expect(got.status).toBe(400);
    const body = JSON.parse(got.body) as { code: string; error: string };
    expect(body.code).toBe('ERR_INVALID_WIRE_OP');
    expect(body.error).toContain(`'declarations'`);
    expect(body.error).toContain(`'answer-account'`);
    expect(reads()).toBe(0);
  });

  it('a missing ref is refused naming the wire spelling, never artifact-account', async () => {
    const { store } = countingStore();
    const handle = await door(store);
    const got = await send(handle.port, {
      headers: { 'content-type': 'application/json', 'x-session-id': 's-1' },
      body: JSON.stringify({ op: 'answer-account' }),
    });
    expect(got.status).toBe(400);
    expect(got.body).toContain(`'answer-account' needs 'ref'`);
    expect(got.body).not.toContain('artifact-account');
  });

  it('the body carries the session as every other request does', async () => {
    const { store } = countingStore();
    const handle = await door(store);
    const ref = await putRecording(store, 's-body', fixtureA());
    const got = await send(handle.port, {
      headers: { 'content-type': 'application/json' },
      body: opBody(ref, { sessionId: 's-body' }),
    });
    expect(got.status).toBe(200);
    expect(Object.keys(JSON.parse(got.body)).sort()).toEqual(['account', 'shown']);
  });

  it('the managed-runtime dialect answers the same body, plus its own status', async () => {
    const { store } = countingStore();
    const handle = await standingAgent({
      agent: Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: store,
      }).build(),
      sessions: memorySessions(),
      host: agentCoreRuntimeHost({ port: 0, hostname: '127.0.0.1' }),
      answerAccounts: {},
    });
    open.push(handle);
    const ref = await putRecording(store, 'runtime-session-000000000000000000001', fixtureA());
    const got = await send((handle as unknown as { port: number }).port, {
      path: '/invocations',
      headers: {
        'content-type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'runtime-session-000000000000000000001',
      },
      body: opBody(ref),
    });
    const body = JSON.parse(got.body) as Record<string, unknown>;
    expect(got.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['account', 'shown', 'status']);
    expect(body.status).toBe('success');
  });
});

// ─── The reduced flagship (checked in) and the field recording ──────

describe('answer-account over HTTP — the recording from the field', () => {
  it('the reduced flagship answers over HTTP, equal to accountForAnswer over the same bytes', async () => {
    const { store } = countingStore();
    const handle = await door(store);
    const recording = fixtureA();
    const ref = await putRecording(store, 's-flag', recording);
    const got = await send(handle.port, {
      headers: { 'content-type': 'application/json', 'x-session-id': 's-flag' },
      body: opBody(ref),
    });
    expect(got.status).toBe(200);
    const body = JSON.parse(got.body) as { account: unknown; shown: unknown };
    const expected = accountForAnswer(recording as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(body.account).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(got.body.length).toBeLessThanOrEqual(192 * 1024);
  });

  it.skipIf(!haveField)(
    'the FIELD recording, put into a store, is explained over HTTP with none of its denied content',
    async () => {
      const text = readFileSync(FIELD_RECORDING, 'utf8');
      const recording = JSON.parse(text) as Recording;
      const { store } = countingStore();
      const handle = await door(store);
      const ref = await putRecording(store, 's-field', recording);
      const got = await send(handle.port, {
        headers: { 'content-type': 'application/json', 'x-session-id': 's-field' },
        body: opBody(ref),
      });
      expect(got.status).toBe(200);
      const body = JSON.parse(got.body) as { account: { summary: { tone: string } } };
      const expected = accountForAnswer(recording, NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });
      expect(body.account).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(body.account.summary.tone).toBe('warn');
      expect(JSON.stringify(body.account).length).toBeLessThanOrEqual(128 * 1024);
      expect(got.body.length).toBeLessThanOrEqual(192 * 1024);

      // The named strings (design §7.4) ARE in the record — and never in the response.
      for (const secret of [
        '# Array Inventory',
        '"group_by"',
        'Application-decided entry',
        '\\"scope\\":\\"volumes\\"',
      ]) {
        expect(text.includes(secret), `the record should hold ${secret}`).toBe(true);
        expect(got.body.includes(secret), `the response leaked ${secret}`).toBe(false);
      }
      // Against every string VALUE of the response (a key such as `toolCallId`
      // is the account's own vocabulary, not content from the record).
      const values = stringValues(JSON.parse(got.body)).join('\u0000');
      for (const leaf of deniedLeaves(recording, NEO_DECLARATIONS)) {
        expect(values.includes(leaf), leaf.slice(0, 80)).toBe(false);
      }
    },
    30_000,
  );

  it.skipIf(!haveField)(
    'measured: the fold’s event-loop cost on the field recording (parse + account + show-me)',
    () => {
      const text = readFileSync(FIELD_RECORDING, 'utf8');
      const runs: { parse: number; fold: number; shown: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        const recording = JSON.parse(text) as Recording;
        const t1 = performance.now();
        const account = accountForAnswer(recording, NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });
        const t2 = performance.now();
        showLeaves(account, recording, NEO_DECLARATIONS);
        const t3 = performance.now();
        runs.push({ parse: t1 - t0, fold: t2 - t1, shown: t3 - t2 });
      }
      const median = (xs: number[]) =>
        [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
      const report = {
        characters: text.length,
        parseMs: median(runs.map((r) => r.parse)),
        foldMs: median(runs.map((r) => r.fold)),
        shownMs: median(runs.map((r) => r.shown)),
      };
      // Recorded in the af-3 worklog; the bound here is a regression tripwire,
      // generous enough for a loaded CI box, not the claim.
      console.info(`[answer-account] field recording cost: ${JSON.stringify(report)}`);
      expect(report.foldMs + report.shownMs).toBeLessThan(1_000);
    },
    60_000,
  );
});
