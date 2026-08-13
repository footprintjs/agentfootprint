/**
 * googleGenAI — the one place a `GoogleGenAI` client gets built (9.13.0).
 *
 * Two adapters reach for the same SDK client — `gemini()` (the LLM provider)
 * and `geminiEmbedder()` — and they need the SAME two doors, the SAME refusals
 * and the SAME `_client` seam. Duplicating that is how the two drift: one grows
 * a fix, the other keeps the bug, and the difference is invisible until a
 * consumer hits the door that was not fixed.
 *
 * So the connection lives here and the adapters own only their own calls.
 * Nothing in this file knows what a model, a message or a vector is.
 *
 * ─── The two doors ──────────────────────────────────────────────────
 *
 *   • **Vertex** — `{ project, location }` → `new GoogleGenAI({ vertexai: true,
 *     project, location, googleAuthOptions })`. Credentials come from
 *     Application Default Credentials: `GOOGLE_APPLICATION_CREDENTIALS`, the
 *     gcloud user credentials, or the metadata server on GCE / Cloud Run. There
 *     is no API key on this path.
 *   • **Gemini API (AI Studio)** — `{ apiKey }` → `new GoogleGenAI({ apiKey })`.
 *     One key, no cloud project.
 *
 * ─── The API version, which is not what you would guess ─────────────
 *
 * The SDK's DEFAULT API version is `v1beta1` on Vertex and `v1beta` on the
 * Gemini API — verified against @google/genai 2.16.0 and pinned by
 * `test/adapters/google/google-surface-pin.test.ts`. It is not `v1`. Callers
 * who need a specific version pass `apiVersion`; callers who do not at least
 * find the truth stated instead of assuming a GA path.
 *
 * ─── The key can be a CALLBACK, and why (9.29.0) ────────────────────
 *
 * `GoogleGenAIOptions.apiKey` is `string` on the installed SDK (@google/genai
 * 2.16.0 `genai.d.ts`) — one value, fixed at construction. That is fine for an
 * AI Studio key, which does not expire, and wrong for every credential that
 * does: a Vertex OAuth access token lives about an hour, and a key pulled from
 * a secret manager is rotated on somebody else's schedule.
 *
 * An independent field trial on live GCP measured exactly that boundary: an
 * OAuth token that worked returned HTTP 401 once expired, with no place in the
 * options to put a fresh one ("Part 2B — ADC refresh versus OpenAI-compatible
 * OAuth"). So `apiKey` widens to `string | (() => string | Promise<string>)`,
 * and the refresh boundary is stated rather than implied:
 *
 *   • The callback runs ONCE PER REQUEST, before the request is built.
 *   • The SDK client is REBUILT only when the returned string differs from the
 *     one already in hand — a callback that returns a cached token costs one
 *     function call and nothing else.
 *   • A stream keeps the key it STARTED with. The boundary is the call, not
 *     the chunk; nothing here can re-authenticate a socket that is already
 *     open.
 *   • Vertex needs none of this. ADC refreshes itself, which the same trial
 *     verified by forcing an in-memory expiry and completing the next call.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';

/**
 * A key, or a way to get one.
 *
 * The function form is called before every request — see the file header for
 * the refresh boundary, which is the CALL and not the chunk.
 */
export type GoogleApiKeySource = string | (() => string | Promise<string>);

/** The connection half of a Google adapter's options — the same on both. */
export interface GoogleGenAIConnectionOptions {
  /** Google Cloud project id — the VERTEX door. Env fallback (read by the SDK):
   *  `GOOGLE_CLOUD_PROJECT`. */
  readonly project?: string;
  /** Vertex location, e.g. `'us-central1'` or `'global'` (the SDK's default).
   *  Env fallback: `GOOGLE_CLOUD_LOCATION`. */
  readonly location?: string;
  /**
   * API key — the GEMINI API door. Env fallbacks: `GEMINI_API_KEY`, then
   * `GOOGLE_API_KEY`.
   *
   * A FUNCTION here is re-read before every request, so a short-lived
   * credential can refresh without rebuilding the provider. See the file
   * header for what "before every request" does and does not cover.
   */
  readonly apiKey?: GoogleApiKeySource;
  /** Force the door instead of inferring it: `true` = Vertex, `false` = the
   *  Gemini API. */
  readonly vertexai?: boolean;
  /** Pin the API version. Unset means the SDK's default — `v1beta1` on Vertex,
   *  `v1beta` on the Gemini API. */
  readonly apiVersion?: string;
  /** `GoogleAuthOptions` for the Vertex door — a key file, scopes, or an
   *  `AuthClient` you built (workload identity federation, impersonation). */
  readonly googleAuthOptions?: Record<string, unknown>;
}

/** Constructor options as `GoogleGenAI` takes them. */
interface GoogleGenAICtorOptions {
  vertexai?: boolean;
  project?: string;
  location?: string;
  apiKey?: string;
  apiVersion?: string;
  googleAuthOptions?: Record<string, unknown>;
}

/** An empty environment variable is not a setting — see `resolveGoogleGenAIClient`. */
const set = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined;

/** The env this module reads, or `{}` off-Node. */
const environment = (): Record<string, string | undefined> =>
  (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;

/**
 * WHICH SERVICE a set of options addresses.
 *
 * The two doors are not two factories, so nothing about them is visible in a
 * call site's shape — and they do not accept the same models. A live field
 * trial found the documented default (`gemini-2.5-flash`) working on Vertex
 * and refused with HTTP 404 on the key door: *"This model models/gemini-2.5-flash
 * is no longer available to new users"* (FINDINGS "Failure 1"). One silent
 * default for two services is untenable, so the door has to be a value the
 * adapter can branch on.
 */
export type GoogleDoor = 'vertex' | 'gemini-api';

/**
 * Which door these options open.
 *
 * The order mirrors `resolveGoogleGenAIClient` exactly, because a door that
 * disagreed with the client that gets built is worse than no door at all.
 *
 * @param readEnv `false` when the caller injected a `_client`. A double talks
 *        to no service, so the ambient `GEMINI_API_KEY` of whoever is running
 *        the tests describes a door that will never be dialled — reading it
 *        would make an offline suite depend on a developer's shell.
 */
export function resolveGoogleDoor(
  options: GoogleGenAIConnectionOptions,
  readEnv = true,
): GoogleDoor {
  if (options.vertexai === true) return 'vertex';
  if (options.vertexai === false) return 'gemini-api';
  const env = readEnv ? environment() : {};
  if ((set(options.project) ?? set(env.GOOGLE_CLOUD_PROJECT)) !== undefined) return 'vertex';
  const key =
    (typeof options.apiKey === 'function' ? 'callback' : set(options.apiKey)) ??
    set(env.GEMINI_API_KEY) ??
    set(env.GOOGLE_API_KEY);
  return key !== undefined ? 'gemini-api' : 'vertex';
}

/**
 * Build (or accept) a `GoogleGenAI` client.
 *
 * `injected` is the `_client` test seam: a structural double exposing only the
 * namespace members the calling adapter uses. When it is present the SDK is
 * never required, no environment is read and no refusal fires — a test drives
 * the adapter's translation with no Google anywhere near it.
 *
 * @param factory  the public name to put in refusals — `'gemini'`,
 *                 `'geminiEmbedder'`. A message that names the wrong factory
 *                 sends the reader to the wrong line of their own code.
 * @param apiKey   the key STRING for this build. Callers holding a callback
 *                 resolve it first (see {@link createGoogleGenAIClientResolver});
 *                 a function reaching the SDK's `apiKey` field would be sent
 *                 as `[object Function]` and fail as an auth error.
 * @throws when neither a project nor an API key is resolvable; when
 *         `vertexai: true` is asked for without a project; and when
 *         `@google/genai` is not installed.
 */
export function resolveGoogleGenAIClient<T>(
  options: GoogleGenAIConnectionOptions,
  factory: string,
  injected?: T,
  apiKey?: string,
): T {
  if (injected) return injected;

  const env = environment();
  // Read HERE only to decide whether there is enough configuration to build
  // anything at all. The values are never copied into the constructor, so the
  // SDK stays the single resolver of its own environment variables — one place
  // that answers "where did my project come from", not two that can disagree.
  // An EMPTY variable is not a setting. `GOOGLE_CLOUD_PROJECT=` in a shell or a
  // CI matrix is how a project comes to be "present" and unusable — the guards
  // below would pass and the SDK would fail on the first call instead.
  const project = set(options.project) ?? set(env.GOOGLE_CLOUD_PROJECT);
  const resolvedKey =
    set(apiKey) ??
    (typeof options.apiKey === 'string' ? set(options.apiKey) : undefined) ??
    set(env.GEMINI_API_KEY) ??
    set(env.GOOGLE_API_KEY);
  const vertexai = options.vertexai ?? (project !== undefined ? true : undefined);

  if (vertexai !== false && project === undefined && resolvedKey === undefined) {
    throw new Error(
      `${factory}: no Google project and no API key — this factory cannot tell which service ` +
        'you meant, and the SDK would warn on stderr, construct anyway, and fail on the first ' +
        'call with something that reads like a network problem.\n' +
        `  Vertex:      ${factory}({ project: "my-project", location: "us-central1" }) — or set ` +
        'GOOGLE_CLOUD_PROJECT; credentials come from Application Default Credentials.\n' +
        `  Gemini API:  ${factory}({ apiKey: process.env.GEMINI_API_KEY }) — or set ` +
        'GEMINI_API_KEY.\n' +
        `  Tests:       ${factory}({ _client }) with a { models: { … } } double — no SDK, no ` +
        'network, no credentials.',
    );
  }
  if (vertexai === true && project === undefined) {
    throw new Error(
      `${factory}: \`vertexai: true\` selects Vertex, which is addressed by PROJECT and not by ` +
        'key. Pass `{ project }` (or set GOOGLE_CLOUD_PROJECT), or drop `vertexai` and pass ' +
        '`{ apiKey }` to use the Gemini API instead.',
    );
  }

  let GoogleGenAI: (new (opts: GoogleGenAICtorOptions) => T) | undefined;
  try {
    const mod = lazyRequire<{ GoogleGenAI?: unknown; default?: { GoogleGenAI?: unknown } }>(
      '@google/genai',
    );
    GoogleGenAI = (mod.GoogleGenAI ?? mod.default?.GoogleGenAI) as
      | (new (opts: GoogleGenAICtorOptions) => T)
      | undefined;
  } catch {
    throw new Error(
      `${factory} requires the \`@google/genai\` package.\n` +
        '  Install:  npm install @google/genai\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  if (!GoogleGenAI) {
    throw new Error(
      `${factory}: \`@google/genai\` is installed but exports no \`GoogleGenAI\`. These adapters ` +
        'are built against @google/genai 2.x — update the package.',
    );
  }

  // Only what was ASKED for goes on the wire; everything omitted is left to the
  // SDK's own environment resolution. The key is the one exception: the
  // CALLBACK form has already been called by the time we get here, so what
  // travels is the string it answered with — never the function.
  const key = apiKey ?? (typeof options.apiKey === 'string' ? options.apiKey : undefined);
  return new GoogleGenAI({
    ...(vertexai !== undefined && { vertexai }),
    ...(options.project !== undefined && { project: options.project }),
    ...(options.location !== undefined && { location: options.location }),
    ...(key !== undefined && { apiKey: key }),
    ...(options.apiVersion !== undefined && { apiVersion: options.apiVersion }),
    ...(options.googleAuthOptions !== undefined && {
      googleAuthOptions: options.googleAuthOptions,
    }),
  });
}

/**
 * One client, and the key it was built with.
 *
 * The key travels BESIDE the client because the adapter that made the call is
 * the thing that redacts it out of a vendor error, and under a callback the
 * key in force is not the one the options were constructed with. A redactor
 * given the wrong string is a redactor that does nothing, silently.
 */
export interface GoogleGenAIClientLease<T> {
  readonly client: T;
  /** The key string this client is authenticating with, when there is one. */
  readonly apiKey?: string;
}

/** Ask for the client to use for THIS request. */
export type GoogleGenAIClientResolver<T> = () => Promise<GoogleGenAIClientLease<T>>;

/**
 * The client seam every Google adapter calls through — one per request.
 *
 * Three paths, and only the third one is new:
 *
 *  1. **`_client` injected** — the double, always, no SDK, no environment.
 *     Any `apiKey` still rides along on the lease so redaction tests can
 *     prove a secret never reaches an error message.
 *  2. **`apiKey` a string (or absent)** — the client is built ONCE. With
 *     `eager`, it is built at factory time, so a missing peer dependency and
 *     an unanswerable door are still refused where the consumer typed the
 *     call rather than on their first request.
 *  3. **`apiKey` a callback** — called before every request. The client is
 *     rebuilt only when the answer CHANGED, so a cached token costs one
 *     function call. Construction cannot be eager here: calling a consumer's
 *     credential provider from a factory would fetch a token nobody asked
 *     for yet, and possibly before their own setup ran.
 *
 * @param eager build now (path 2 only), preserving construction-time refusals.
 */
export function createGoogleGenAIClientResolver<T>(
  options: GoogleGenAIConnectionOptions,
  factory: string,
  injected?: T,
  eager = false,
): GoogleGenAIClientResolver<T> {
  const source = options.apiKey;

  if (injected) {
    // A double stands in for the SDK CLIENT, not for the credential. So a
    // callback is still called per request here: it is the only way a test can
    // watch a key rotate, and the only way redaction can be proved against the
    // key that is actually in force rather than the one at construction.
    if (typeof source !== 'function') {
      const lease: GoogleGenAIClientLease<T> = {
        client: injected,
        ...(source !== undefined && { apiKey: source }),
      };
      return async () => lease;
    }
    return async () => ({ client: injected, apiKey: await resolveKey(source, factory) });
  }

  if (typeof source !== 'function') {
    let built: T | undefined = eager
      ? resolveGoogleGenAIClient<T>(options, factory, undefined)
      : undefined;
    return async () => {
      built ??= resolveGoogleGenAIClient<T>(options, factory, undefined);
      return { client: built, ...(source !== undefined && { apiKey: source }) };
    };
  }

  // The callback path. `lastKey` is held so the SDK client survives a callback
  // that keeps answering the same thing — which is what a well-behaved token
  // cache does on all but one call in a thousand.
  let lastKey: string | undefined;
  let built: T | undefined;
  return async () => {
    const answer = await resolveKey(source, factory);
    if (built === undefined || answer !== lastKey) {
      built = resolveGoogleGenAIClient<T>(options, factory, undefined, answer);
      lastKey = answer;
    }
    return { client: built, apiKey: answer };
  };
}

/** Call the credential callback and insist on something usable. */
async function resolveKey(
  source: () => string | Promise<string>,
  factory: string,
): Promise<string> {
  const answer = await source();
  if (typeof answer === 'string' && answer.trim().length > 0) return answer;
  // The value is NOT quoted back. It is a credential when it is right, and it
  // is whatever the consumer's provider returned when it is wrong; a message
  // that printed it would be the one place this library leaks one.
  throw new Error(
    `${factory}: the \`apiKey\` callback returned ${describeKey(answer)}, and a key has to be a ` +
      'non-empty string.\n' +
      '  The callback is called before every request, so this is a live credential failure, ' +
      'not a configuration one — a token fetch that failed usually throws rather than returning ' +
      'nothing.\n' +
      `  Fix:  return the token, or throw from the callback so ${factory} can report why.`,
  );
}

/** What came back, said without saying it. */
function describeKey(value: unknown): string {
  if (typeof value === 'string') return 'an empty string';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `a ${typeof value}`;
}
