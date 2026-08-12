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
 */

import { lazyRequire } from '../../lib/lazyRequire.js';

/** The connection half of a Google adapter's options — the same on both. */
export interface GoogleGenAIConnectionOptions {
  /** Google Cloud project id — the VERTEX door. Env fallback (read by the SDK):
   *  `GOOGLE_CLOUD_PROJECT`. */
  readonly project?: string;
  /** Vertex location, e.g. `'us-central1'` or `'global'` (the SDK's default).
   *  Env fallback: `GOOGLE_CLOUD_LOCATION`. */
  readonly location?: string;
  /** API key — the GEMINI API door. Env fallbacks: `GEMINI_API_KEY`, then
   *  `GOOGLE_API_KEY`. */
  readonly apiKey?: string;
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
 * @throws when neither a project nor an API key is resolvable; when
 *         `vertexai: true` is asked for without a project; and when
 *         `@google/genai` is not installed.
 */
export function resolveGoogleGenAIClient<T>(
  options: GoogleGenAIConnectionOptions,
  factory: string,
  injected?: T,
): T {
  if (injected) return injected;

  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<
    string,
    string | undefined
  >;
  // Read HERE only to decide whether there is enough configuration to build
  // anything at all. The values are never copied into the constructor, so the
  // SDK stays the single resolver of its own environment variables — one place
  // that answers "where did my project come from", not two that can disagree.
  // An EMPTY variable is not a setting. `GOOGLE_CLOUD_PROJECT=` in a shell or a
  // CI matrix is how a project comes to be "present" and unusable — the guards
  // below would pass and the SDK would fail on the first call instead.
  const set = (value: string | undefined): string | undefined =>
    value !== undefined && value.trim().length > 0 ? value : undefined;
  const project = set(options.project) ?? set(env.GOOGLE_CLOUD_PROJECT);
  const apiKey = set(options.apiKey) ?? set(env.GEMINI_API_KEY) ?? set(env.GOOGLE_API_KEY);
  const vertexai = options.vertexai ?? (project !== undefined ? true : undefined);

  if (vertexai !== false && project === undefined && apiKey === undefined) {
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
  // SDK's own environment resolution.
  return new GoogleGenAI({
    ...(vertexai !== undefined && { vertexai }),
    ...(options.project !== undefined && { project: options.project }),
    ...(options.location !== undefined && { location: options.location }),
    ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
    ...(options.apiVersion !== undefined && { apiVersion: options.apiVersion }),
    ...(options.googleAuthOptions !== undefined && {
      googleAuthOptions: options.googleAuthOptions,
    }),
  });
}
