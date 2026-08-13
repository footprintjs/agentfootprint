/**
 * THE GOOGLE SURFACE PIN — every Google adapter in this package, in one place.
 *
 * Read `./googlePin.ts` first: it holds the registry, why Google needs a
 * different pin shape from AWS, and why these packages ARE devDependencies.
 *
 * Four assertions:
 *   1. DISPATCH      — each adapter really reaches for the pinned methods,
 *                      driven through a `_client` double exposing only those.
 *   2. METHOD-NAME   — every pinned method is a real, callable member of the
 *      REALITY         real installed package (instance fields included).
 *   3. API-VERSION   — the version each surface actually resolves to is the one
 *      REALITY         the registry records. The new assertion, and the one that
 *                      catches "we said GA v1, the SDK dialled v1beta1".
 *   4. COMPLETENESS  — every `src/**` file that loads a Google package has a row.
 *
 * Nothing here reaches Google or needs a credential.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_PACKAGES,
  GOOGLE_SURFACE_PINS,
  chainMethodExists,
  fakeGoogleClient,
  findGoogleLoadSites,
  installedVersion,
  reachableMethods,
  realPackage,
  type GoogleAdapterPin,
} from './googlePin.js';

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
      const instance = new (Ctor as new (opts: unknown) => Record<string, unknown>)({
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

// ─── 4. COMPLETENESS ─────────────────────────────────────────────────

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
      'src/adapters/llm/googleGenAI.ts',
      'src/artifacts/gcsArtifacts.ts',
    ]);
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
