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
 * **With exactly one exception, which is a field on the row rather than a
 * footnote here.** `@google-cloud/firestore` is NOT installed, because it drags
 * `@opentelemetry/api` to the root and disarms a live refusal test. So for the
 * `firestoreSessions` row, assertions (2) and (3) SKIP here and run only for
 * somebody who installs the package locally; assertion (1) runs everywhere. See
 * that row's `notInstalled`, which has to say why or the suite fails.
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
  '@google-cloud/firestore',
  'google-auth-library',
  '@googleapis/aiplatform',
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
 *
 * `'class'` is the Firestore shape, and it is a fourth kind rather than a bent
 * `'chain'` for one concrete reason: the chain walker CALLS each intermediate
 * with a placeholder string, and `collection.where` needs three arguments of
 * three different kinds before it will hand back the next link. Firestore
 * exports every class in that chain from the module root (`Query`,
 * `DocumentReference`, `Transaction`, `DocumentSnapshot`, `FieldPath`), so the
 * surface can be read off the PROTOTYPES with nothing constructed, no arguments
 * invented and no query built. `Transaction` in particular has a private
 * constructor and is only ever handed to you inside a real transaction — a
 * check that had to construct one could not run offline at all.
 */
export type GoogleSurfaceKind = 'object' | 'chain' | 'class' | 'gax' | 'rest';

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
  /**
   * Why this row's package is deliberately NOT a devDependency, and what it was
   * verified against instead.
   *
   * Present on exactly one row, and it is an exception that had to be EARNED
   * rather than assumed — the whole reason the other Google packages are
   * devDependencies is that the reality assertion must run in CI (see the header
   * above). It is recorded as a field rather than left implicit so the
   * "everything is installed" assertion has to acknowledge it out loud, and so
   * the next person to reach for `npm install` finds the reason before the
   * failure.
   */
  readonly notInstalled?: string;
  /** Anything a reader of this row needs that the fields cannot say. */
  readonly note?: string;
}

/**
 * THE REGISTRY. Verified against the installed packages: `@google/genai` 2.16.0
 * and `google-auth-library` 11.0.1 (2026-08-12), `@google-cloud/storage` 7.22.0
 * (9.25.0), and `@googleapis/aiplatform` 31.0.0 (2026-08-13, the Sessions +
 * Memory Bank batch). Assertions (2) and (3) below re-verify all four of those on
 * every run — each is a real devDependency — so for them the dates are provenance
 * rather than the guarantee.
 *
 * `@google-cloud/firestore` 9.0.0 (2026-08-14) is the fifth, and for it the date
 * IS the guarantee: the package is not installed here, so assertions (2) and (3)
 * skip that row and its member spellings rest on a hand check against a real
 * install. See `notInstalled` on the row.
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
    adapter: 'agentEngineSessions',
    sources: ['src/adapters/hosting/googleAgentEngine.ts', 'src/adapters/google/aiPlatform.ts'],
    sdkPackage: '@googleapis/aiplatform',
    kind: 'rest',
    ctor: 'aiplatform',
    namespace: 'projects.locations.reasoningEngines.sessions',
    methods: ['create', 'get', 'appendEvent', 'delete', 'list', 'operations.wait'],
    apiVersions: { rest: 'v1' },
    note:
      'Read off a real install of @googleapis/aiplatform 31.0.0 before the adapter was ' +
      'written, and four of those reads changed the design. (1) `create` accepts a ' +
      'caller-supplied `sessionId` query parameter — so our session id IS the resource id, ' +
      '`hydrate` is one `get` by name, and no mapping table exists. (2) `create` and `delete` ' +
      'return a LongrunningOperation while `get` and `appendEvent` return directly, which is ' +
      'why every operation-shaped write waits on `operations.wait` before returning: a persist ' +
      'that came back early would make the next hydrate a race whose failure mode is ' +
      '"no conversation". ' +
      '(3) `Session.userId` is REQUIRED and IMMUTABLE, which is where the userId resolver ' +
      'comes from — and why the FIRST write is the only one that may name it. ' +
      "(4) `Session.sessionState` is a free-form Struct, which is the envelope's home. " +
      'PATCH IS DELIBERATELY ABSENT FROM THIS ROW, and that is the 9.30.0 correction: a field ' +
      'trial (2026-08-14) ran 9.29.0 live and the service refused ' +
      '`patch({ updateMask: "sessionState" })` with HTTP 400 — "you can only update it by ' +
      'appending an event" — so turn one stored and every later turn failed. The double built ' +
      'from this row exposes no `patch` at all, which is what makes a regression land on the ' +
      "dispatch rather than on somebody else's bill. `sessions.events.list` stays uncalled: " +
      'this store keeps ONE envelope under one key and reads the envelope, never the log.',
  },
  {
    adapter: 'firestoreSessions',
    sources: ['src/adapters/hosting/firestoreSessions.ts'],
    sdkPackage: '@google-cloud/firestore',
    kind: 'class',
    ctor: 'Firestore',
    notInstalled:
      'Verified against a real install of @google-cloud/firestore 9.0.0 in a scratch project ' +
      '(2026-08-14): every member on this row was read out of `types/firestore.d.ts` and then ' +
      'confirmed on the constructed client and the exported prototypes. It is NOT a ' +
      'devDependency here, and that is a measured decision rather than a size complaint. ' +
      '`@google-cloud/firestore` has `@opentelemetry/api` as a HARD dependency, so installing ' +
      'it hoists that package to the root — and this repository has a test that proves ' +
      '`otelObservability()` refuses BY NAME when `@opentelemetry/api` is absent. Adding ' +
      'Firestore turns that refusal into something no test can reach, which is the same ' +
      'trade the AWS pin makes for the same reason: an installed package makes ONE check ' +
      'runnable and an absent-peer check vacuous, and here the absent-peer check is the one ' +
      'that guards a live refusal a user meets. Assertions (2) and (3) therefore SKIP this ' +
      'row in CI and run in full for anyone who installs the package locally; assertion (1), ' +
      'the dispatch, runs everywhere.',
    methods: [
      'Firestore.collection',
      'Firestore.runTransaction',
      'Firestore.terminate',
      'CollectionReference.doc',
      'Query.where',
      'Query.orderBy',
      'Query.startAfter',
      'Query.limit',
      'Query.get',
      'QuerySnapshot.docs',
      'DocumentReference.get',
      'DocumentReference.delete',
      'DocumentSnapshot.exists',
      'DocumentSnapshot.data',
      'DocumentSnapshot.id',
      'Transaction.get',
      'Transaction.set',
      'FieldPath.documentId',
    ],
    note:
      'Read off a real install of @google-cloud/firestore 9.0.0 before the adapter was ' +
      'written, and five of those reads shaped the design. ' +
      '(1) `Transaction.get` is ASYNC and `Transaction.set` is SYNCHRONOUS (it answers the ' +
      'transaction, for chaining) — the asymmetry a convenient double gets wrong, and the ' +
      'reason the adapter can read-then-write inside one function without sequencing ' +
      'promises. (2) `DocumentSnapshot.exists` is a PROPERTY, not a method, and a missing ' +
      'document comes back as a snapshot rather than as an error — so "no conversation" is ' +
      'READ, never inferred from a failure. (3) `QuerySnapshot.docs` is a materialised ' +
      'ARRAY; the SDK has `Query.stream()` for the other shape and this adapter does not use ' +
      'it, so a double handing back an async iterable would be testing a client nobody ' +
      'ships. (4) `FieldPath.documentId()` is a STATIC returning a sentinel — there is no ' +
      'string spelling of `__name__` the client accepts in `orderBy`, which is why the ' +
      'module is loaded even when a caller passes their own client. (5) `startAfter` accepts ' +
      'a bare document-name STRING for a documentId ordering and converts it to a full ' +
      'reference, which is what lets the listing cursor stay an opaque `savedAt:docId` token ' +
      'rather than a second round trip to fetch a snapshot. ' +
      '(6) THE CURSOR READS `DocumentSnapshot.id`, NOT `DocumentReference.id`, and this row ' +
      'pins the one the adapter really reads. `last` in the cursor mint comes out of ' +
      '`QuerySnapshot.docs`, so it is a `QueryDocumentSnapshot`, which extends ' +
      '`DocumentSnapshot` (firestore.d.ts line 1667) and inherits its `readonly id: string` ' +
      '(line 1617). Hand-verified in the same 9.0.0 install, in the .d.ts AND at runtime: ' +
      '`DocumentSnapshot.prototype` really owns `id`, and `QueryDocumentSnapshot.prototype` ' +
      'really inherits from it. This member was added after a review found the row pinning ' +
      'the sibling instead — its provenance is that hand check, not a test that runs here. ' +
      'It is a PROPERTY, which is why the double models it as one: an `id()` method would ' +
      "mint a function's source text into a pagination token, the same lie shape as an " +
      '`exists()` method. `DocumentReference.id` is REAL (line 1442) and is deliberately not ' +
      'on this row, because this adapter never reads it — `FirestoreDocumentReferenceLike` ' +
      'declares `id` only so the test double can key its staged writes by it. This row lists ' +
      'what is CALLED, and a member nobody calls is the same overclaim as a citation nobody ' +
      'can follow. ' +
      '`WriteBatch`, `BulkWriter`, `Query.stream`, `Query.count`, `Firestore.batch` and ' +
      '`CollectionReference.listDocuments` are all on the surface and deliberately NOT ' +
      'called: a session store writes one document at a time, and a listing that streamed ' +
      'or counted would be answering a question the port never asks. ' +
      '`set` with `{ merge: true }` is absent from this row and that absence is ' +
      'load-bearing: merge is how ownership would silently transfer to the last writer, ' +
      'which is the whole reason the write is a transaction.',
  },
  {
    adapter: 'memoryBankStore',
    sources: ['src/adapters/memory/memoryBank.ts', 'src/adapters/google/aiPlatform.ts'],
    sdkPackage: '@googleapis/aiplatform',
    kind: 'rest',
    ctor: 'aiplatform',
    namespace: 'projects.locations.reasoningEngines.memories',
    methods: ['create', 'get', 'patch', 'delete', 'retrieve', 'operations.wait'],
    apiVersions: { rest: 'v1' },
    note:
      '`retrieve` covers BOTH reads — `list()` sends simpleRetrievalParams, `search()` sends ' +
      'similaritySearchParams — because retrieve takes the scope as a STRUCTURED field whose ' +
      'exact-match semantics the SDK states outright, where `memories.list` selects with an ' +
      'AIP-160 filter STRING whose ability to express a scope match is unverified. That is ' +
      'why `list` is on the surface and NOT called. ' +
      '`purge` is NOT called either, and that one is load-bearing: ' +
      '`PurgeMemoriesRequest.force` defaults to FALSE, which the service documents as ' +
      '"validated but not executed" — a forget() built on it without that flag would report ' +
      'success and delete nothing, which is a compliance failure that looks exactly like a ' +
      'working erasure. forget() therefore paginates retrieve-then-delete. ' +
      '`rollback` and `generate` are unpinned features, not oversights. ' +
      'The ranking trap lives on the RESPONSE rather than in a method name: a retrieved row ' +
      'carries `distance` (smaller is closer) and the port carries a cosine `score` (higher ' +
      'is closer), so the adapter converts and refuses `minScore` rather than forwarding a ' +
      'number that reads like a similarity and is not one.',
  },
  {
    adapter: 'googleIdentity',
    sources: ['src/adapters/identity/google.ts'],
    sdkPackage: 'google-auth-library',
    kind: 'object',
    ctor: 'GoogleAuth',
    methods: ['getClient'],
    note:
      'Only ONE method is dispatched on the constructed `GoogleAuth`: everything after ' +
      '`getClient()` happens on the CLIENT it answers with (`getAccessToken`, and the ' +
      '`credentials.expiry_date` the expiry is read from), which is an `OAuth2Client` / ' +
      '`Impersonated` / `Compute` depending on the environment — a class this adapter never ' +
      'names and must not. `Impersonated` is reached as a CONSTRUCTOR rather than a method, ' +
      'so assertion (2) cannot cover it as a name on this surface; the dedicated test in ' +
      "the adapter's own suite asserts it exists on the installed package. This adapter " +
      "caches the CLIENT and never a token — the library's own refresh logic is what keeps " +
      'the one-hour token fresh, and an adapter-held token would be an expiry we did not ' +
      'compute and could not see revoked.',
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

/** The installed package, when it IS installed. Every Google package here is a
 *  devDependency except `@google-cloud/firestore`, so `undefined` is a FINDING
 *  for the others and the expected answer for that one — which is why the row
 *  carrying it must declare `notInstalled` and why its checks skip rather than
 *  pass. */
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
 * Answer whether `ClassName.member` is a real member of a module-exported class.
 *
 * The `'class'` kind's walker, and it looks in three places for one reason
 * each:
 *
 *   • the PROTOTYPE, walked to the top, for ordinary methods (`Query.where`);
 *   • as a property DESCRIPTOR rather than a function, because several members
 *     this adapter reads are accessors — `DocumentSnapshot.exists` and
 *     `QuerySnapshot.docs` are `readonly` properties, and a `typeof … ===
 *     'function'` check would report both of them missing;
 *   • on the CLASS itself, for a static (`FieldPath.documentId`).
 *
 * Nothing is constructed and nothing is called, so this runs offline with no
 * credential — which is the only way to check a class like `Transaction`, whose
 * constructor is private and whose instances exist only inside a live
 * transaction.
 */
export function classMemberExists(mod: Record<string, unknown>, path: string): boolean {
  const at = path.indexOf('.');
  if (at <= 0) return false;
  const Ctor = mod[path.slice(0, at)] as { prototype?: object } | undefined;
  const member = path.slice(at + 1);
  if (typeof Ctor !== 'function') return false;

  let node: object | null = (Ctor as { prototype?: object }).prototype ?? null;
  while (node !== null && node !== Object.prototype) {
    if (Object.getOwnPropertyDescriptor(node, member) !== undefined) return true;
    node = Object.getPrototypeOf(node) as object | null;
  }
  return Object.getOwnPropertyDescriptor(Ctor, member) !== undefined;
}

/**
 * Walk a dotted path of PROPERTIES and answer whether the last segment is a
 * callable member.
 *
 * The sibling of {@link chainMethodExists}, and it exists because the two
 * Google client families are reached in genuinely different ways:
 *
 *   • a `'chain'` row (`@google-cloud/storage`) is a FACTORY chain —
 *     `storage.bucket(b).file(k)` — so the intermediates must be CALLED.
 *   • a `'rest'` row (`@googleapis/aiplatform`) is a RESOURCE tree —
 *     `client.projects.locations.reasoningEngines.sessions` — so the
 *     intermediates must be READ. Calling one throws.
 *
 * Reusing the chain walker here would report every REST method missing, which
 * is a check that fails for a reason unrelated to the thing it is checking —
 * the worst kind of green-to-red.
 */
export function restMethodExists(root: object, path: string): boolean {
  const segments = path.split('.');
  let node: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[segment];
  }
  if (node === null || typeof node !== 'object') return false;
  const leaf = segments[segments.length - 1]!;
  return typeof (node as Record<string, unknown>)[leaf] === 'function';
}

/**
 * Build a `_client` double for a `'rest'` row — a nested object tree whose
 * leaves are exactly the pinned methods and nothing else.
 *
 * Same trick as {@link fakeGoogleClient}, one dimension deeper: an adapter
 * reaching for an unpinned method finds `undefined` and fails on the dispatch
 * rather than somewhere downstream. The row's `namespace` is the shared prefix
 * every method hangs off, so the tree is built from `namespace + method`.
 */
export function fakeGoogleRestClient<T = unknown>(
  pins: readonly GoogleAdapterPin[],
  answers: Record<string, MethodAnswer> = {},
): FakeGoogleClient<T> {
  const sent: SentCall[] = [];
  const root: Record<string, unknown> = {};

  // The RECORDED name is the row's own dotted spelling (`operations.wait`),
  // not the bare leaf: two collections each carry an `operations.wait`, and a
  // dispatch log that said `wait` twice could not tell you which one ran.
  const plant = (path: readonly string[], leaf: string, recordAs: string): void => {
    let node = root;
    for (const segment of path) {
      const next = node[segment];
      if (next === undefined) node[segment] = {};
      node = node[segment] as Record<string, unknown>;
    }
    node[leaf] = (params: unknown): Promise<unknown> => {
      sent.push({ method: recordAs, params });
      const answer = answers[recordAs];
      return Promise.resolve(
        typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer ?? {},
      );
    };
  };

  for (const pin of pins) {
    const prefix = pin.namespace === undefined ? [] : pin.namespace.split('.');
    for (const method of pin.methods) {
      const parts = method.split('.');
      plant([...prefix, ...parts.slice(0, -1)], parts[parts.length - 1]!, method);
    }
  }

  return { client: root as T, sent, names: () => sent.map((s) => s.method) };
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
