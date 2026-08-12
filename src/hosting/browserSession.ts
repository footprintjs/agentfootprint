/**
 * hosting/browserSession — the client half of a session, for a page.
 *
 * A standing agent remembers a conversation per `sessionId`. Something has to
 * decide what that id IS, and in a browser that is one line:
 *
 *   const sessionId = browserSessionId();
 *   await fetch('/invoke', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
 *     body: JSON.stringify({ input: 'hello' }),
 *   });
 *
 * The server half is `nodeHost({ sessionHeader })` (default `'x-session-id'`,
 * so the line above needs no server option at all) or
 * `nodeHost({ sessionCookie })`, which does the same job without any client
 * code — see those options for the trade.
 *
 * ── Why this file imports NOTHING ────────────────────────────────────────────
 * It is the one piece of `hosting/` a browser bundle is meant to contain, and
 * the rest of that folder is Node: `httpHost` dynamically imports `node:http`,
 * `sqliteSessions` reaches `node:sqlite` through `createRequire`. So this file
 * has no imports at all and is exported from the MAIN barrel
 * (`import { browserSessionId } from 'agentfootprint'`) rather than from
 * `agentfootprint/hosting`, which no browser bundle should have to pull in. It
 * lives here, beside the server half it pairs with, so the two cannot drift
 * about which header carries what.
 *
 * Pattern: a plain function. There is no state to own beyond the storage key.
 */

/** Options for {@link browserSessionId}. */
export interface BrowserSessionIdOptions {
  /**
   * Where the id is kept. Default `'agentfootprint.sessionId'`.
   *
   * Change it when one origin serves two different agents that must not share a
   * conversation — two keys, two sessions, one browser.
   */
  readonly storageKey?: string;
}

/** The default `localStorage` key. Named, so a page can clear it deliberately. */
export const DEFAULT_SESSION_STORAGE_KEY = 'agentfootprint.sessionId';

/**
 * Storage for the runs where `localStorage` is not there — a private-mode
 * browser that throws on access, an SSR pass, a test. One `Map` for the module,
 * so a second call in the same page still gets the same id back.
 */
const fallbackStore = new Map<string, string>();

/**
 * The conversation this browser is having with your agent: minted once, kept,
 * and handed back on every later call.
 *
 * Pass it as `x-session-id` (or in the JSON body as `sessionId`) and a
 * `standingAgent` will hydrate the same conversation on every turn — and, since
 * 9.10.0, scope the agent's memory to it too, with no configuration.
 *
 * ── What it is, and the thing it is NOT ──────────────────────────────────────
 * **A session id is not authentication.** It is a handle the browser carries,
 * and anyone who can reach your host can send any string in its place. Nothing
 * here signs it, and nothing on the server side checks it: authenticate the
 * caller by your own means, then check that the authenticated principal is
 * allowed the session they claimed. Storing anything sensitive under a session
 * id alone is storing it under a value the client controls.
 *
 * ── Where it is kept, and what that costs ────────────────────────────────────
 * `localStorage`, under {@link BrowserSessionIdOptions.storageKey}. That means
 * it survives a reload and a closed tab, is scoped to the ORIGIN, and is
 * readable by any script running on that origin — including one you did not
 * write. It is per browser profile, so the same person on a phone and a laptop
 * is two conversations, and a shared machine is one.
 *
 * When `localStorage` cannot be reached — private mode in some browsers throws
 * on access, and there is no `window` at all during SSR — the id is kept in a
 * module-level `Map` instead. Same id for the life of the page, gone on reload.
 * This is a fallback and it is stated rather than hidden: a page that must
 * survive a reload in private mode needs its own storage.
 *
 * ── How it is minted ─────────────────────────────────────────────────────────
 * `crypto.randomUUID()` where it exists (every current browser, in a secure
 * context), then `crypto.getRandomValues`. Both are unguessable. On a runtime
 * that has NEITHER — an insecure-context page in an older browser — it falls
 * back to `Math.random`, which is **not** unguessable, and that is survivable
 * only because of the paragraph above: this id is a handle, never a credential.
 *
 * @example  A chat page that remembers across reloads
 * ```ts
 * import { browserSessionId } from 'agentfootprint';
 *
 * const sessionId = browserSessionId();
 * const reply = await fetch('/invoke', {
 *   method: 'POST',
 *   headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
 *   body: JSON.stringify({ input: message }),
 * }).then((r) => r.json());
 * ```
 *
 * @example  Two agents on one origin, two conversations
 * ```ts
 * const support = browserSessionId({ storageKey: 'support.sessionId' });
 * const billing = browserSessionId({ storageKey: 'billing.sessionId' });
 * ```
 */
export function browserSessionId(options: BrowserSessionIdOptions = {}): string {
  const key = options.storageKey ?? DEFAULT_SESSION_STORAGE_KEY;
  const existing = readStored(key);
  if (existing !== undefined && existing.length > 0) return existing;
  const minted = mintId();
  writeStored(key, minted);
  return minted;
}

/**
 * `localStorage` if it is both present and usable, otherwise `undefined`.
 *
 * Presence is not usability: Safari's private mode has historically THROWN on
 * `localStorage` access rather than being absent, so the only honest test is to
 * touch it inside a try.
 */
function storage(): Storage | undefined {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (candidate === undefined || candidate === null) return undefined;
    // A round trip, because a quota-exhausted or disabled store can be present
    // and still refuse every write.
    const probe = '__agentfootprint_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return undefined;
  }
}

function readStored(key: string): string | undefined {
  const store = storage();
  if (store === undefined) return fallbackStore.get(key);
  try {
    return store.getItem(key) ?? undefined;
  } catch {
    return fallbackStore.get(key);
  }
}

function writeStored(key: string, value: string): void {
  // The in-memory copy is kept EITHER WAY. A `localStorage` that accepted the
  // probe and then refused this write (quota, a policy change mid-page) would
  // otherwise mint a new id on every call, and a conversation that starts over
  // on every message is worse than one that ends at the reload.
  fallbackStore.set(key, value);
  const store = storage();
  if (store === undefined) return;
  try {
    store.setItem(key, value);
  } catch {
    // Already kept above. Nothing here is worth failing a page over.
  }
}

/** An unguessable id where the platform offers one; see the caveat on the door. */
function mintId(): string {
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof webcrypto?.randomUUID === 'function') return webcrypto.randomUUID();
  if (typeof webcrypto?.getRandomValues === 'function') {
    const bytes = webcrypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4, laid out by hand because `randomUUID` is what is
    // missing here, not the randomness.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20,
    )}-${hex.slice(20)}`;
  }
  // No crypto at all. Not unguessable, and labelled so in the returned value
  // itself rather than only in a doc nobody reads at three in the morning.
  const random = () => Math.random().toString(36).slice(2, 10);
  return `weak-${Date.now().toString(36)}-${random()}${random()}`;
}
