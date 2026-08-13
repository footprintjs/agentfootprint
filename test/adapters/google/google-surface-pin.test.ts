/**
 * THE GOOGLE SURFACE PIN — every Google adapter in this package, in one place.
 *
 * Read `./googlePin.ts` first: it holds the registry, why Google needs a
 * different pin shape from AWS, and why these packages ARE devDependencies.
 *
 * Five assertions:
 *   1. DISPATCH      — each adapter really reaches for the pinned methods,
 *                      driven through a `_client` double exposing only those.
 *   2. METHOD-NAME   — every pinned method is a real, callable member of the
 *      REALITY         real installed package (instance fields included).
 *   3. API-VERSION   — the version each surface actually resolves to is the one
 *      REALITY         the registry records. The new assertion, and the one that
 *                      catches "we said GA v1, the SDK dialled v1beta1".
 *   4. ID-GRAMMAR    — the id rules this column composes names under are the
 *      REALITY         ones the installed `.d.ts` documents, quoted, not a
 *                      Google-wide habit remembered from somewhere else.
 *   5. COMPLETENESS  — every `src/**` file that loads a Google package has a row.
 *
 * Nothing here reaches Google or needs a credential.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  GOOGLE_PACKAGES,
  GOOGLE_SURFACE_PINS,
  chainMethodExists,
  fakeGoogleClient,
  fakeGoogleRestClient,
  findGoogleLoadSites,
  installedVersion,
  reachableMethods,
  realPackage,
  restMethodExists,
  type GoogleAdapterPin,
} from './googlePin.js';

import {
  AI_PLATFORM_API_VERSION,
  LEGAL_RESOURCE_ID,
  MAX_RESOURCE_ID_LENGTH,
  regionalRootUrl,
  safeResourceId,
} from '../../../src/adapters/google/aiPlatform.js';
import { agentEngineSessions } from '../../../src/adapters/hosting/googleAgentEngine.js';
import { memoryBankStore } from '../../../src/adapters/memory/memoryBank.js';
import { googleIdentity } from '../../../src/adapters/identity/google.js';
import { toEnvelope } from '../../../src/hosting/index.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';

import { gemini } from '../../../src/adapters/llm/GeminiProvider.js';
import { geminiEmbedder } from '../../../src/embedders/index.js';
import type { GeminiClientLike } from '../../../src/adapters/llm/GeminiProvider.js';
import type { GeminiEmbedClientLike } from '../../../src/embedders/index.js';

const pin = (adapter: string): GoogleAdapterPin => {
  const row = GOOGLE_SURFACE_PINS.find((p) => p.adapter === adapter);
  if (!row) throw new Error(`no pin registered for '${adapter}'`);
  return row;
};

const REQUEST = { model: 'gemini', messages: [{ role: 'user' as const, content: 'hi' }] };

// ─── 1. DISPATCH ─────────────────────────────────────────────────────

describe('Google adapters call exactly the methods they are pinned to', () => {
  it('gemini — generateContent, then generateContentStream', async () => {
    const row = pin('gemini');
    const fake = fakeGoogleClient<GeminiClientLike>(row, {
      generateContent: {
        candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      },
      generateContentStream: () =>
        (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] };
        })(),
    });
    const provider = gemini({ _client: fake.client });
    await provider.complete(REQUEST);
    for await (const _chunk of provider.stream!(REQUEST)) {
      /* drain */
    }
    expect(fake.names()).toEqual(['generateContent', 'generateContentStream']);
  });

  it('geminiEmbedder — embedContent, once per text', async () => {
    const row = pin('geminiEmbedder');
    const fake = fakeGoogleClient<GeminiEmbedClientLike>(row, {
      embedContent: { embeddings: [{ values: [1, 2, 3] }] },
    });
    const embedder = geminiEmbedder({ _client: fake.client, dimensions: 3 });
    await embedder.embed({ text: 'a' });
    await embedder.embedBatch!({ texts: ['b', 'c'] });
    expect(fake.names()).toEqual(['embedContent', 'embedContent', 'embedContent']);
  });

  it('agentEngineSessions — patch first, then create on a 404, then wait on the operation', async () => {
    const row = pin('agentEngineSessions');
    // The steady state (patch succeeds) costs ONE call; a first write falls
    // through to create + wait. Both are exercised in that order.
    let sessionExists = false;
    const fake = fakeGoogleRestClient<never>([row], {
      patch: () => {
        if (!sessionExists) throw { code: 404 };
        return { data: { name: 'x' } };
      },
      create: () => {
        sessionExists = true;
        return { data: { name: 'op/1', done: true } };
      },
    });
    const sessions = agentEngineSessions({
      project: 'p',
      location: 'us-central1',
      reasoningEngine: '1',
      _client: fake.client,
    });
    const envelope = toEnvelope({
      version: 1,
      runId: 'run-1',
      history: [{ role: 'user', content: 'hi' }],
      lastCompletedIteration: 1,
      originalInput: { message: 'hi' },
      checkpointedAt: Date.now(),
    } as AgentRunCheckpoint);
    await sessions.persist('s1', envelope);
    await sessions.persist('s1', envelope);

    expect(fake.names()).toEqual(['patch', 'create', 'patch']);
    // `operations.wait` is pinned and NOT called here, because the service
    // answered an already-done operation. That is the cheap path and it is
    // supposed to skip the round trip — the wait path has its own test.
  });

  it('memoryBankStore — one retrieve for a search, one for a list, and never memories.list', async () => {
    const row = pin('memoryBankStore');
    const fake = fakeGoogleRestClient<never>([row], {
      retrieve: { data: { retrievedMemories: [] } },
    });
    const store = memoryBankStore({
      project: 'p',
      location: 'us-central1',
      reasoningEngine: '1',
      _client: fake.client,
    });
    await store.search({ conversationId: 'c' }, [], { text: 'q' });
    await store.list({ conversationId: 'c' });
    expect(fake.names()).toEqual(['retrieve', 'retrieve']);
    // The registry does not carry `list` or `purge`, and the reasons are in
    // the row's note. This is the assertion that keeps them out.
    expect(row.methods).not.toContain('list');
    expect(row.methods).not.toContain('purge');
    expect(row.note).toMatch(/force/);
  });

  it('googleIdentity — getClient on the GoogleAuth, and nothing else on it', async () => {
    const row = pin('googleIdentity');
    const fake = fakeGoogleClient<{ getClient(): Promise<unknown> }>(row, {
      getClient: () => ({ getAccessToken: () => ({ token: 't' }), credentials: {} }),
    });
    const provider = googleIdentity({
      _sdk: {
        GoogleAuth: class {
          getClient = fake.client.getClient;
        } as never,
      },
    });
    const result = await provider.getCredential({ service: 'sheets' });
    expect(result.status).toBe('issued');
    expect(fake.names()).toEqual(['getClient']);
  });

  it('the docs-recipe row dispatches NOTHING — the pin records a documented claim too', () => {
    const row = pin('Google Cloud OTLP recipe (docs)');
    expect(row.documentedOnly).toBe(true);
    expect(row.sources).toEqual([]);
    // Its names are still checked for real, below. A claim in prose is not a
    // weaker claim than one in code.
    expect(row.methods.length).toBeGreaterThan(0);
  });

  it('countTokens is a method this package may not quietly start calling', () => {
    // It exists on the namespace and it is not pinned, because reporting a
    // token count we asked for SEPARATELY as the count a call was billed for
    // would be an invented number wearing a real one's clothes.
    const pinned = GOOGLE_SURFACE_PINS.flatMap((p) => p.methods);
    expect(pinned).not.toContain('countTokens');
    expect(pin('gemini').note).toMatch(/countTokens/);
  });
});

// ─── 2. METHOD-NAME REALITY ──────────────────────────────────────────
//
// The half that makes the registry a claim about Google rather than about
// ourselves. Unlike the AWS pin, this is NOT skippable: both packages are
// devDependencies precisely so this runs in CI.

describe('the pinned methods against the real installed packages', () => {
  it('every pinned package is actually installed — an unrunnable check is not a check', () => {
    const missing = [...new Set(GOOGLE_SURFACE_PINS.map((p) => p.sdkPackage))].filter(
      (pkg) => realPackage(pkg) === undefined,
    );
    expect(
      missing,
      'these are devDependencies on purpose: the reality and API-version assertions must RUN',
    ).toEqual([]);
  });

  it('reports the versions this run checked, so drift is visible in the log', () => {
    const versions = Object.fromEntries(
      [...new Set(GOOGLE_SURFACE_PINS.map((p) => p.sdkPackage))].map((pkg) => [
        pkg,
        installedVersion(pkg),
      ]),
    );
    expect(versions['@google/genai']).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions['google-auth-library']).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions['@googleapis/aiplatform']).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('the SPLIT per-API package is what is installed, not the 209 MB mega-package', () => {
    // `googleapis` carries every Google API at once for the same generated
    // code. Reaching for it instead would be an eightfold install for nothing,
    // and it is an easy mistake because every search result names it.
    expect(realPackage('@googleapis/aiplatform')).toBeDefined();
    expect(
      realPackage('googleapis'),
      'the mega-package must not creep back in as a dependency',
    ).toBeUndefined();
  });

  it('@google/genai 2.x is what these adapters are built against', () => {
    // A major bump is a redesign, not an upgrade. It should fail here rather
    // than in somebody's account.
    expect(installedVersion('@google/genai')?.split('.')[0]).toBe('2');
  });

  for (const row of GOOGLE_SURFACE_PINS) {
    it(`${row.adapter} → ${row.sdkPackage}: every pinned method really exists`, () => {
      const mod = realPackage(row.sdkPackage) as Record<string, unknown>;
      const Ctor = mod[row.ctor];
      expect(typeof Ctor, `${row.sdkPackage} must export ${row.ctor}`).toBe('function');

      // Constructed with placeholder configuration: this reads a surface, it
      // never makes a call, and no credential is involved on any door.
      //
      // A REST row's `ctor` is a FACTORY (`aiplatform({ version })`), not a
      // class — `new`-ing it would build the wrong thing, and the version has
      // to be named because it is the whole point of assertion (3).
      const instance =
        row.kind === 'rest'
          ? (Ctor as (opts: unknown) => Record<string, unknown>)({
              version: row.apiVersions?.['rest'] ?? 'v1',
            })
          : new (Ctor as new (opts: unknown) => Record<string, unknown>)({
              apiKey: 'surface-pin-not-a-real-key',
              projectId: 'surface-pin',
            });

      // A CHAIN row's methods live at several levels of a factory chain
      // (`storage.bucket(b).file(k).save`), so each dotted path is WALKED.
      // Enumerating one namespace would report every one of them missing.
      if (row.kind === 'chain') {
        const missing = row.methods.filter((path) => !chainMethodExists(instance, path));
        expect(missing, `${row.adapter} calls methods that do not exist`).toEqual([]);
        return;
      }

      // A REST row's methods hang off a RESOURCE TREE that is read, never
      // called — see restMethodExists for why the chain walker cannot stand in.
      if (row.kind === 'rest') {
        const missing = row.methods.filter(
          (path) => !restMethodExists(instance, `${row.namespace ?? ''}.${path}`),
        );
        expect(missing, `${row.adapter} calls methods that do not exist`).toEqual([]);
        return;
      }

      const surface = (row.namespace ? instance[row.namespace] : instance) as unknown as object;
      expect(surface, `${row.ctor} must expose ${row.namespace ?? 'its methods'}`).toBeTruthy();

      const reachable = reachableMethods(surface);
      const missing = row.methods.filter((name) => !reachable.has(name));
      expect(missing, `${row.adapter} calls methods that do not exist`).toEqual([]);
    });
  }

  it('the two streaming/one-shot methods are INSTANCE fields, which is why the check is not prototype-only', () => {
    const { GoogleGenAI } = realPackage('@google/genai') as {
      GoogleGenAI: new (opts: unknown) => { models: object };
    };
    const models = new GoogleGenAI({ apiKey: 'surface-pin-not-a-real-key' }).models;
    const prototype = Object.getPrototypeOf(models) as object;
    // If this ever flips, the pin still passes (reachableMethods covers both) —
    // but the REASON in googlePin.ts would be stale, and a stale reason is how
    // a check quietly loses its point.
    for (const name of ['generateContent', 'generateContentStream', 'embedContent']) {
      expect(Object.prototype.hasOwnProperty.call(models, name), `${name} own`).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(prototype, name), `${name} proto`).toBe(false);
    }
    // And the counter-example that proves the enumeration is not just "true for
    // everything": countTokens IS an ordinary prototype method.
    expect(Object.prototype.hasOwnProperty.call(prototype, 'countTokens')).toBe(true);
  });
});

// ─── 3. API-VERSION REALITY ──────────────────────────────────────────

describe('the API version each surface actually resolves to', () => {
  /** Ask the built client which version it will dial. */
  const versionOf = (opts: Record<string, unknown>): string => {
    const { GoogleGenAI } = realPackage('@google/genai') as {
      GoogleGenAI: new (o: unknown) => { apiClient: { getApiVersion(): string } };
    };
    return new GoogleGenAI(opts).apiClient.getApiVersion();
  };

  const MODES: Readonly<Record<string, Record<string, unknown>>> = {
    vertex: { vertexai: true, project: 'pin-project', location: 'us-central1' },
    'gemini-api': { apiKey: 'surface-pin-not-a-real-key' },
  };

  for (const row of GOOGLE_SURFACE_PINS) {
    if (!row.apiVersions) continue;
    for (const [mode, expected] of Object.entries(row.apiVersions)) {
      if (mode === 'rest') {
        // The discovery client takes its version as an ARGUMENT, so "which
        // version do we dial" is not a default to be discovered — it is a
        // constant in `aiPlatform.ts`, and this asserts that the constant and
        // the registry agree AND that the version really carries the surface
        // the adapters were built against.
        it(`${row.adapter} dials ${expected}, and ${expected} is a version this package has`, () => {
          const mod = realPackage(row.sdkPackage) as {
            aiplatform: (o: unknown) => Record<string, unknown>;
            VERSIONS: Record<string, unknown>;
          };
          expect(Object.keys(mod.VERSIONS)).toContain(expected);
          expect(AI_PLATFORM_API_VERSION).toBe(expected);
          // And the surface really is reachable at that version, which is the
          // half a version string alone cannot promise.
          expect(
            restMethodExists(mod.aiplatform({ version: expected }), `${row.namespace ?? ''}.get`),
          ).toBe(true);
        });
        continue;
      }
      if (mode === 'json') {
        // The storage client dials a JSON API version nobody configures; it
        // states it on its own `baseUrl`. Same assertion, different door —
        // "which version does this really call?" has to be answerable per
        // surface, not per SDK family.
        it(`${row.adapter} dials the ${expected} JSON API`, () => {
          const mod = realPackage(row.sdkPackage) as Record<string, unknown>;
          const client = new (mod[row.ctor] as new (o: unknown) => { baseUrl?: string })({
            projectId: 'surface-pin',
          });
          expect(client.baseUrl).toContain(`/storage/${expected}`);
        });
        continue;
      }
      it(`${row.adapter} on ${mode} resolves to ${expected}`, () => {
        expect(versionOf(MODES[mode]!)).toBe(expected);
      });
    }
  }

  it('the default is NOT v1 — which is the whole reason this assertion exists', () => {
    // Stated as its own test because it is the sentence the docs page has to
    // carry, and a docs claim with no test behind it is how "GA" gets written
    // above a beta endpoint.
    expect(versionOf(MODES['vertex']!)).not.toBe('v1');
    expect(versionOf(MODES['gemini-api']!)).not.toBe('v1');
  });

  it('a caller who pins a version gets it — so the fact above is a default, not a ceiling', () => {
    expect(versionOf({ ...MODES['vertex']!, apiVersion: 'v1' })).toBe('v1');
    expect(versionOf({ ...MODES['gemini-api']!, apiVersion: 'v1' })).toBe('v1');
  });

  it("and the adapters' own connection options really reach the constructor", async () => {
    // The versions above are the SDK's answer to ITS options. This is the other
    // half: that our options arrive there at all rather than being accepted and
    // dropped. The SDK is swapped for a constructor that records what it was
    // given — the only way to see a client the factories close over.
    const built: Record<string, unknown>[] = [];
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => ({
        GoogleGenAI: class {
          readonly models = {};
          constructor(opts: Record<string, unknown>) {
            built.push(opts);
          }
        },
      }),
    }));
    try {
      const { gemini: isolatedProvider } = await import(
        '../../../src/adapters/llm/GeminiProvider.js'
      );
      const { geminiEmbedder: isolatedEmbedder } = await import('../../../src/embedders/index.js');

      isolatedProvider({
        project: 'pin-project',
        location: 'europe-west4',
        apiVersion: 'v1',
        googleAuthOptions: { scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
      });
      // The embedder connects LAZILY, so a call is what builds its client.
      await isolatedEmbedder({ apiKey: 'k', apiVersion: 'v1' })
        .embed({ text: 'a' })
        .catch(() => undefined);

      expect(built[0]).toEqual({
        vertexai: true,
        project: 'pin-project',
        location: 'europe-west4',
        apiVersion: 'v1',
        googleAuthOptions: { scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
      });
      // The Gemini-API door sends no `vertexai` and no project at all.
      expect(built[1]).toEqual({ apiKey: 'k', apiVersion: 'v1' });
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});

// ─── 4. ID-GRAMMAR REALITY ───────────────────────────────────────────

describe('the resource-id grammar is the SDK’s own, quoted rather than remembered', () => {
  // Read out of the installed package, the same way the regional-host
  // assertion reads `build/v1.js`. The grammar lives in a docstring and
  // nowhere else, so the docstring is what gets held to.
  const declarations = readFileSync(
    new URL('../../../node_modules/@googleapis/aiplatform/build/v1.d.ts', import.meta.url),
    'utf8',
  );

  const MEMORY_ID_RULE =
    'The user defined ID to use for memory, which will become the final component of the ' +
    'memory resource name. If not provided, Vertex AI will generate a value for this ID. This ' +
    'value may be up to 63 characters, and valid characters are `[a-z0-9-]`. The first ' +
    'character must be a letter, and the last character must be a letter or number.';

  const SESSION_ID_RULE =
    'The user defined ID to use for session, which will become the final component of the ' +
    'session resource name. If not provided, Vertex AI will generate a value for this ID. This ' +
    'value may be up to 63 characters, and valid characters are `[a-z0-9-]`. The first and ' +
    'last characters must be a letter or number.';

  it('the installed package really says [a-z0-9-] for both ids this column mints', () => {
    // If either sentence changes, this fails and safeResourceId gets re-read
    // against the new one — which is the only way a grammar written into code
    // stays true to the service enforcing it.
    expect(declarations).toContain(MEMORY_ID_RULE);
    expect(declarations).toContain(SESSION_ID_RULE);
    // And the guessed grammar this replaced is NOT what either one says.
    expect(MEMORY_ID_RULE).not.toContain('[A-Za-z0-9_-]');
    expect(SESSION_ID_RULE).not.toContain('[A-Za-z0-9_-]');
  });

  it('our own rule is the intersection of those two sentences', () => {
    expect(MAX_RESOURCE_ID_LENGTH).toBe(63);
    // Legal for both.
    for (const id of ['a', 'ab', 'pref-tone', 'a-1', 'm2f0k1-abc-pref-tone']) {
      expect(LEGAL_RESOURCE_ID.test(id), id).toBe(true);
    }
    // Illegal for at least one, and therefore illegal here.
    for (const id of ['A', 'a_b', 'Alice', '4f3c', '-a', 'a-', '']) {
      expect(LEGAL_RESOURCE_ID.test(id), id).toBe(false);
    }
  });

  it('safeResourceId never produces an id that grammar would refuse', () => {
    // The shapes that used to go to the wire and come back as a censored 400:
    // a UUID (leading digit), a ULID (uppercase Crockford base32), an
    // underscored key, and this library's own `fact:<key>` entry ids.
    const corpus = [
      'Pref_Tone',
      '4f3c9a2e-1111-2222-3333-444455556666',
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      'fact:tone',
      'msg-3-0',
      'snap-12',
      'user@example.com',
      'ünïcödé',
      '',
      '-',
      '---',
      '9',
      'a'.repeat(500),
      'conversation id with spaces',
    ];
    for (const raw of corpus) {
      const id = safeResourceId(raw);
      expect(LEGAL_RESOURCE_ID.test(id), `${JSON.stringify(raw)} → ${id}`).toBe(true);
      expect(id.length, `${JSON.stringify(raw)} → ${id}`).toBeLessThanOrEqual(
        MAX_RESOURCE_ID_LENGTH,
      );
    }
  });

  it('an id that is already legal is passed through unchanged, and stays readable', () => {
    for (const id of ['pref-tone', 'msg-3-0', 'snap-12', 'a']) {
      expect(safeResourceId(id)).toBe(id);
    }
  });

  it('the fold is lossy, so two ids it would merge get different names', () => {
    // Lowercasing and substituting map `Alice`→`alice` and `a_b`→`a-b`. Two
    // callers' ids that folded together would be ONE row — the same silent
    // overwrite the addressing law exists to prevent, arriving by a different
    // door.
    const pairs: readonly [string, string][] = [
      ['Alice', 'alice'],
      ['a_b', 'a-b'],
      ['FACT:tone', 'fact:tone'],
      ['x'.repeat(80) + 'a', 'x'.repeat(80) + 'b'],
    ];
    for (const [left, right] of pairs) {
      expect(safeResourceId(left), `${left} vs ${right}`).not.toBe(safeResourceId(right));
    }
  });

  it('the same id always composes the same name — these are long-lived addresses', () => {
    for (const raw of ['Pref_Tone', 'fact:tone', 'a'.repeat(500)]) {
      expect(safeResourceId(raw)).toBe(safeResourceId(raw));
    }
  });

  it('running it over its own output changes nothing — listByUser round-trips through it', () => {
    // `listByUser` reads the last segment of a resource name and hands it back
    // as a session id, and callers feed those to `hydrate`. If the composer
    // were not idempotent, a listed conversation would not be openable.
    for (const raw of ['MySession', '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'a'.repeat(500), 'plain-one']) {
      const once = safeResourceId(raw);
      expect(safeResourceId(once), raw).toBe(once);
    }
  });

  it('a bound too small to be satisfiable is refused, not silently overrun', () => {
    // An id that needs the fingerprint (uppercase folds, so it is lossy) with
    // no room to carry one. An already-legal short id still passes through.
    expect(() => safeResourceId('Anything', 8)).toThrow(RangeError);
    expect(safeResourceId('anything', 8)).toBe('anything');
  });
});

// ─── 5. COMPLETENESS ─────────────────────────────────────────────────

describe('the registry covers every Google adapter in the source tree', () => {
  const loadSites = findGoogleLoadSites();
  const covered = new Set(GOOGLE_SURFACE_PINS.flatMap((row) => row.sources));

  it('every file that loads a Google package has a pin', () => {
    const unpinned = [...loadSites.keys()].filter((file) => !covered.has(file));
    expect(
      unpinned,
      'a new Google adapter must add a row to GOOGLE_SURFACE_PINS naming the methods it calls',
    ).toEqual([]);
  });

  it('every pin points at a file that exists, and at the package that file loads', () => {
    for (const row of GOOGLE_SURFACE_PINS) {
      if (row.documentedOnly) continue;
      // At least ONE of a row's sources must be the file that does the loading;
      // the others are the translation code the row also covers.
      const loaders = row.sources.filter((src) => loadSites.get(src)?.has(row.sdkPackage));
      expect(loaders.length, `${row.adapter} names no file that loads ${row.sdkPackage}`).toBe(1);
    }
  });

  it('the load-site scan finds prose-only mentions of NOTHING', () => {
    // The scan matches real load expressions, so a package merely named in a
    // comment must not create a phantom row requirement.
    expect(GOOGLE_PACKAGES).toContain('@google/genai');
    expect([...loadSites.keys()].sort()).toEqual([
      'src/adapters/google/aiPlatform.ts',
      'src/adapters/identity/google.ts',
      'src/adapters/llm/googleGenAI.ts',
      'src/artifacts/gcsArtifacts.ts',
    ]);
  });

  it('the regional host is the one thing a REST adapter must not accept a default for', () => {
    // The generated client defaults to the GLOBAL host and these resources are
    // regional, so a default accepted is a call to the wrong place answered
    // with a 404 that reads like a missing resource. Both halves are asserted:
    // that we compose the regional host, and that the package's default really
    // is the global one (so the comment explaining why cannot go stale quietly).
    expect(regionalRootUrl('europe-west4')).toBe('https://europe-west4-aiplatform.googleapis.com/');
    const generated = readFileSync(
      new URL('../../../node_modules/@googleapis/aiplatform/build/v1.js', import.meta.url),
      'utf8',
    );
    expect(generated).toContain("options.rootUrl || 'https://aiplatform.googleapis.com/'");
  });

  it('pinned rows are shaped like the surfaces they claim to be', () => {
    for (const row of GOOGLE_SURFACE_PINS) {
      expect(GOOGLE_PACKAGES, `${row.adapter}: unknown package`).toContain(row.sdkPackage);
      expect(new Set(row.methods).size, `${row.adapter}: duplicate method`).toBe(
        row.methods.length,
      );
      for (const method of row.methods) {
        // A Google client is METHOD-based. A name ending in `Command` would be
        // an AWS habit applied to a package that has no such thing.
        expect(method, `${row.adapter}: ${method} looks like an AWS command`).not.toMatch(
          /Command$/,
        );
      }
      if (row.methods.length === 0) {
        expect(row.note, `${row.adapter}: an empty row must say why`).toBeDefined();
      }
    }
  });
});
