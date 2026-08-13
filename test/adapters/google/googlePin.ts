/**
 * THE GOOGLE SURFACE PIN — one registry, one helper, every Google adapter.
 *
 * ── Why this is not just a copy of the AWS pin ────────────────────────────────
 * The AWS pin (`test/adapters/aws/awsCommandPin.ts`) asserts that each adapter
 * dispatches real COMMAND CLASSES. Google's clients have no command objects at
 * all: you call a METHOD on a namespace. So the same three assertions have to be
 * re-aimed, and one of them is genuinely new.
 *
 *   1. **Dispatch** — driven through a `_client` double whose namespace exposes
 *      ONLY the pinned method names, each adapter reaches for exactly those.
 *      Reach for a name that is not in the registry and the call lands on
 *      `undefined`. Runs everywhere, offline, always.
 *
 *   2. **Method-name reality** — every pinned method really exists on the real
 *      installed package. This is the check that catches the bug class 9.4.0
 *      shipped on the AWS side (`client.getResourceOauth2Token(...)` called as a
 *      method that was never there). It has to enumerate the INSTANCE and not
 *      only the prototype: `@google/genai` defines `generateContent`,
 *      `generateContentStream` and `embedContent` as instance FIELDS (arrow
 *      properties assigned in the constructor), while `countTokens` is an
 *      ordinary prototype method. A prototype-only check would report three of
 *      our four pinned methods as missing and one competing implementation as
 *      fine.
 *
 *   3. **API-VERSION reality** — the new one, and the load-bearing one. A Google
 *      SDK can carry the same method name at two different API versions with
 *      different behaviour, and the version is usually a DEFAULT nobody states.
 *      `@google/genai` 2.16.0 defaults to **`v1beta1`** on Vertex and
 *      **`v1beta`** on the Gemini API — *not* `v1`. An adapter (or a docs page)
 *      that says "GA, v1" while the SDK dials `v1beta1` is the 9.4.0 bug class
 *      in a new costume: everything compiles, everything passes, and the calls
 *      go somewhere else. So the pin records the version each surface actually
 *      resolves to and fails when the installed package changes it.
 *
 *   4. **Completeness** — every source file that LOADS a Google package has a
 *      row. A new Google adapter cannot ship unpinned.
 *
 * ── Why the packages ARE devDependencies here ────────────────────────────────
 * The AWS SDKs are deliberately NOT installed, so six adapters can prove their
 * missing-peer-dep refusals by real absence — which makes the AWS reality check
 * vacuous in CI. That trade is wrong for Google: version drift across a
 * mid-rebrand SDK is exactly where these bugs live, so assertions (2) and (3)
 * must RUN in CI, and `@google/genai` and `google-auth-library` are real
 * devDependencies. The missing-peer-dep refusals are proved instead by stubbing
 * module resolution (`vi.doMock` on `lazyRequire`), in each adapter's own suite.
 *
 * Nothing in this file, or in any file that imports it, reaches Google.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const require_ = createRequire(import.meta.url);

/** Repo root, from `test/adapters/google/`. */
export const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

/** Every Google package family an adapter here may load. */
export const GOOGLE_PACKAGES: readonly string[] = [
  '@google/genai',
  '@google-cloud/storage',
  'google-auth-library',
  'googleapis',
  '@google-cloud/aiplatform',
  '@google-cloud/discoveryengine',
];

/**
 * How a pinned surface is reached.
 *
 * `'object'` is the only kind Phase A ships — a constructed client with a
 * namespace of methods. `'gax'` (a `*ServiceClient` from
 * `@google-cloud/aiplatform`) and `'rest'` (a `googleapis` discovery resource
 * path) are named here because the recon established that Sessions and Memory
 * Bank arrive through them, and because a registry that cannot express the
 * surface a future row needs gets bypassed instead of extended.
 */
export type GoogleSurfaceKind = 'object' | 'chain' | 'gax' | 'rest';

/** One Google adapter's contract with its SDK. */
export interface GoogleAdapterPin {
  /** The public name a consumer types, or the claim a docs page makes. */
  readonly adapter: string;
  /** Source files this row covers, repo-relative. Drives the completeness check. */
  readonly sources: readonly string[];
  /** The peer-dep package the adapter loads. */
  readonly sdkPackage: string;
  /** How the surface is reached. */
  readonly kind: GoogleSurfaceKind;
  /** The constructor built from the package. */
  readonly ctor: string;
  /**
   * The namespace the methods hang off — `'models'` on a `GoogleGenAI`. Absent
   * when the methods are on the client itself.
   */
  readonly namespace?: string;
  /**
   * Every method the adapter CALLS. Empty is a claim too — see `note`.
   *
   * On a `'chain'` row these are DOTTED PATHS through the factory chain
   * (`'bucket.file.save'` = `storage.bucket(b).file(k).save(...)`), because
   * that client has no command objects AND no single namespace: the methods
   * live at three levels. A registry that could not express the surface a row
   * needs gets bypassed instead of extended, so it was extended.
   */
  readonly methods: readonly string[];
  /**
   * The API version this surface RESOLVES TO, per mode, when the adapter asks
   * for none. `undefined` means the surface has no version to assert (a plain
   * auth library). Asserted against the installed package by assertion (3).
   */
  readonly apiVersions?: Readonly<Record<string, string>>;
  /**
   * A row that no adapter dispatches through: the surface a DOCS page tells
   * readers to call. Dispatch is skipped; reality is not. Our docs are a claim
   * about somebody else's package too.
   */
  readonly documentedOnly?: boolean;
  /** Anything a reader of this row needs that the fields cannot say. */
  readonly note?: string;
}

/**
 * THE REGISTRY. Verified against the installed packages on 2026-08-12:
 * `@google/genai` 2.16.0 and `google-auth-library` 11.0.1. Assertions (2) and
 * (3) below re-verify this on every run — both packages are devDependencies —
 * so the date is provenance rather than the guarantee.
 */
export const GOOGLE_SURFACE_PINS: readonly GoogleAdapterPin[] = [
  {
    adapter: 'gemini',
    sources: ['src/adapters/llm/GeminiProvider.ts', 'src/adapters/llm/googleGenAI.ts'],
    sdkPackage: '@google/genai',
    kind: 'object',
    ctor: 'GoogleGenAI',
    namespace: 'models',
    methods: ['generateContent', 'generateContentStream'],
    apiVersions: { vertex: 'v1beta1', 'gemini-api': 'v1beta' },
    note:
      '`countTokens` is on this namespace and is deliberately NOT dispatched. It would be the ' +
      'easy way to fill in a usage number a stream did not report, which is exactly why it is ' +
      'absent: it answers what a request TOKENISES TO, not what the call was BILLED for, and a ' +
      'plausible number in the right range is worse than a zero somebody can see. The pin lists ' +
      'what is called, so re-adding it here has to be a decision somebody records. ' +
      'The two pinned methods are instance FIELDS on `Models`, not prototype methods — see ' +
      'assertion (2).',
  },
  {
    adapter: 'geminiEmbedder',
    sources: ['src/embedders/index.ts', 'src/adapters/llm/googleGenAI.ts'],
    sdkPackage: '@google/genai',
    kind: 'object',
    ctor: 'GoogleGenAI',
    namespace: 'models',
    methods: ['embedContent'],
    apiVersions: { vertex: 'v1beta1', 'gemini-api': 'v1beta' },
  },
  {
    adapter: 'gcsArtifacts',
    sources: ['src/artifacts/gcsArtifacts.ts'],
    sdkPackage: '@google-cloud/storage',
    kind: 'chain',
    ctor: 'Storage',
    methods: [
      'bucket',
      'bucket.getFiles',
      'bucket.file',
      'bucket.file.save',
      'bucket.file.download',
      'bucket.file.getMetadata',
      'bucket.file.delete',
      'bucket.file.createReadStream',
      'bucket.file.createWriteStream',
    ],
    // The JSON API version this client resolves to with no configuration. It is
    // a DEFAULT nobody states, which is exactly the class assertion (3) exists
    // for — read off the constructed client's own `baseUrl`.
    apiVersions: { json: 'v1' },
    note:
      'Read out of a real install of @google-cloud/storage 7.22.0 before the adapter was ' +
      'written (9.25.0) — the chain, and four SHAPES a design could only have guessed at: ' +
      'custom metadata is NESTED (`{ metadata: { metadata: { … } } }`, an 8 KiB cap) and ' +
      "`options.contentType` is the client's own alias for `metadata.contentType`; " +
      '`getFiles({ autoPaginate: false })` answers `[File[], nextQuery, apiResponse]` with each ' +
      "File's `.metadata` ALREADY POPULATED (custom entries included) and `nextQuery` null on " +
      'the last page — which is why this adapter lists in one call where the other column ' +
      'needs a read per row; `download()` answers `[Buffer]` while `createReadStream()` is a ' +
      'Node Readable (bridged to a web stream at the adapter edge, never in the port); and a ' +
      'missing object throws `{ code: 404 }`, the only failure this adapter may answer null ' +
      'for. `exists()` and `setMetadata()` are on the surface and deliberately NOT called: ' +
      'an exists-then-read is a race, and a ticket is written once at put.',
  },
  {
    adapter: 'Google Cloud OTLP recipe (docs)',
    sources: [],
    sdkPackage: 'google-auth-library',
    kind: 'object',
    ctor: 'GoogleAuth',
    methods: ['getClient', 'getAccessToken', 'getRequestHeaders'],
    documentedOnly: true,
    note:
      'No adapter dispatches these — `otelObservability()` takes a tracer the host built, and ' +
      'the Google column ships a DOCS recipe rather than a factory (a factory would only ' +
      'restate `npm install`). But the recipe on infrastructure/google-cloud.mdx tells readers ' +
      'to call exactly these three, so the names are a claim this package makes about somebody ' +
      "else's library, and a claim in prose is not a weaker claim than one in code. " +
      'Reality-checked, never dispatched.',
  },
];

/** One method call as the double saw it: the operation, and what it carried. */
export interface SentCall {
  /** The namespace method the adapter reached for, e.g. `'generateContent'`. */
  readonly method: string;
  readonly params: unknown;
}

/** How a fake namespace answers one method: a value, or a function of the params. */
export type MethodAnswer = unknown | ((params: unknown) => unknown);

export interface FakeGoogleClient<T> {
  /** Pass as the adapter's `_client`. */
  readonly client: T;
  /** Every method that was called, in order. */
  readonly sent: SentCall[];
  /** Just the method names, for a one-line assertion. */
  names(): string[];
}

/**
 * Build a `_client` double for one pinned adapter.
 *
 * The namespace exposes EXACTLY the pinned method names and nothing else. That
 * is the whole trick: an adapter reaching for an unpinned method finds
 * `undefined` and fails on the dispatch rather than on a mystery downstream.
 *
 * @param pin      the registry row
 * @param answers  per-method replies, keyed by method name
 */
export function fakeGoogleClient<T = unknown>(
  pin: GoogleAdapterPin,
  answers: Record<string, MethodAnswer> = {},
): FakeGoogleClient<T> {
  const sent: SentCall[] = [];
  const namespace: Record<string, unknown> = {};

  for (const method of pin.methods) {
    namespace[method] = (params: unknown): Promise<unknown> => {
      sent.push({ method, params });
      const answer = answers[method];
      return Promise.resolve(
        typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer ?? {},
      );
    };
  }

  const client = (pin.namespace ? { [pin.namespace]: namespace } : namespace) as T;
  return { client, sent, names: () => sent.map((s) => s.method) };
}

/** The installed package, when it IS installed. Both Google packages are
 *  devDependencies, so `undefined` here is a finding, not the normal case. */
export function realPackage(sdkPackage: string): Record<string, unknown> | undefined {
  try {
    return require_(sdkPackage) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * The installed version of a package, read from its own package.json.
 *
 * Not `require('<pkg>/package.json')`: `@google/genai` does not export that
 * subpath, so the file is found by walking up from the resolved entry point —
 * which works for any package regardless of what its `exports` map allows.
 */
export function installedVersion(sdkPackage: string): string | undefined {
  try {
    let dir = dirname(require_.resolve(sdkPackage));
    for (let depth = 0; depth < 8; depth++) {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (manifest.name === sdkPackage) return manifest.version;
      } catch {
        /* keep walking */
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* not installed */
  }
  return undefined;
}

/**
 * Every method name reachable on an object — own properties AND the whole
 * prototype chain.
 *
 * The prototype half is what the AWS pin would have checked. The OWN half is
 * what `@google/genai` needs: `Models` assigns `generateContent`,
 * `generateContentStream` and `embedContent` as instance fields, so they never
 * appear on `Models.prototype` at all.
 */
export function reachableMethods(target: object): Set<string> {
  const names = new Set<string>();
  let node: object | null = target;
  while (node && node !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(node)) {
      const value = (target as Record<string, unknown>)[name];
      if (typeof value === 'function') names.add(name);
    }
    node = Object.getPrototypeOf(node) as object | null;
  }
  return names;
}

/**
 * Walk a DOTTED method path through a factory chain and answer whether the
 * last segment is really a callable member.
 *
 * `'bucket.file.save'` → `typeof storage.bucket(x).file(y).save === 'function'`.
 * The intermediate segments are called with a placeholder string: on this
 * client they are pure local constructions (a `Bucket`/`File` handle is built,
 * nothing is fetched), which is what lets a surface check run offline with no
 * credential. Returns `undefined` when the chain breaks before the end — the
 * caller reports THAT as the missing name, since a broken chain and a missing
 * leaf are the same bug at different depths.
 */
export function chainMethodExists(root: object, path: string): boolean {
  const segments = path.split('.');
  let node: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    const factory = (node as Record<string, unknown>)[segment];
    if (typeof factory !== 'function') return false;
    node = (factory as (arg: string) => unknown).call(node, 'surface-pin');
    if (node === null || typeof node !== 'object') return false;
  }
  const leaf = segments[segments.length - 1]!;
  const value = (node as Record<string, unknown>)[leaf];
  return typeof value === 'function';
}

/**
 * Every source file that LOADS a Google package, with the packages it loads.
 * Matches real load sites only — a package NAMED in prose is not a dependency.
 */
export function findGoogleLoadSites(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const srcRoot = join(REPO_ROOT, 'src');
  const packages = GOOGLE_PACKAGES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const loadSite = new RegExp(
    String.raw`(?:lazyRequire\s*(?:<[^>]*>)?\s*\(|(?:^|[^.\w])require\s*\(|\bimport\s*\(|\bfrom\s+)\s*['"]((?:${packages})(?:/[^'"]+)?)['"]`,
    'g',
  );

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.ts')) continue;
      const text = readFileSync(full, 'utf8');
      let match: RegExpExecArray | null;
      loadSite.lastIndex = 0;
      while ((match = loadSite.exec(text)) !== null) {
        const key = relative(REPO_ROOT, full);
        const set = out.get(key) ?? new Set<string>();
        // Normalize a subpath import (`@google/genai/node`) to its package.
        const spec = match[1]!;
        set.add(GOOGLE_PACKAGES.find((p) => spec === p || spec.startsWith(`${p}/`)) ?? spec);
        out.set(key, set);
      }
    }
  };

  walk(srcRoot);
  return out;
}
