/**
 * adapters/hosting/agentcore — AWS Bedrock **AgentCore Runtime** adapters for
 * the two hosting ports.
 *
 *   import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting-providers';
 *   import { standingAgent } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     host: agentCoreRuntimeHost(),
 *     sessions: agentCoreSessions({ store: 'session-storage' }),
 *   });
 *
 * ── What this file actually is ───────────────────────────────────────────────
 * Vendor paths, a header name, and two JSON body shapes. That is the whole
 * adapter, and it is the claim the hosting ports were designed to make: a
 * container runtime's contract is a CONFIGURATION of HTTP work that already
 * exists, not a second implementation of it. Nothing here reaches into the
 * ports, and nothing here needed the ports to change.
 *
 * AgentCore Runtime is a **container contract**: an ARM64 image serving HTTP on
 * `0.0.0.0:8080` —
 *
 *   POST /invocations   JSON `{ "prompt": "..." }` → JSON `{ "response", "status" }`
 *   GET  /ping          → `{ "status": "Healthy", "time_of_last_update": <unix seconds> }`
 *
 * and the caller's conversation arrives in the
 * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header rather than in the body,
 * which is the one thing paths-and-bodies configuration alone could not
 * express before this release.
 *
 * ── Verification status, stated plainly ──────────────────────────────────────
 * `agentCoreRuntimeHost` is **plain HTTP and is really verified**: it runs the
 * same host conformance suite as `nodeHost`, over a real socket, in
 * `test/hosting/host-contract.test.ts`. There is no AWS SDK on its path.
 *
 * `agentCoreSessions({ store: 'memory' })` is **contract-mapped and
 * injection-tested**: its AgentCore Memory calls are exercised through the
 * `_client` seam, never against AWS. Confirm the command and field names
 * against your installed `@aws-sdk/client-bedrock-agentcore` before you rely
 * on it.
 *
 * Both modes have now been exercised against the real service by a production
 * integration, and the `'memory'` mode came back with a defect no injected fake
 * could have shown: given an OBJECT as an event's blob, the service stores its
 * own host language's `toString()` of it and returns a string that is not JSON
 * and cannot be decoded. This shim writes JSON text for exactly that reason.
 * Envelopes written by any build before 7.22.1 are unrecoverable — the mangling
 * is lossy, so there is nothing to migrate, and the honest response is a loud
 * refusal rather than a silent fresh start.
 *
 * Pattern: Adapter (GoF). Role: outer ring. The file-backed session store uses
 * `node:fs` and nothing else; the event-backed one lazy-loads the AWS SDK, so
 * importing this module costs zero peer-dep load.
 */

import { checkEnvelope } from '../../hosting/envelope.js';
import { headerValue, httpHost } from '../../hosting/httpHost.js';
import type { HttpHost, HttpRequestFacts, HttpWire } from '../../hosting/httpHost.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../../hosting/types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

// ─── The runtime host ────────────────────────────────────────────────

const HOST_NAME = 'agentCoreRuntimeHost';

/** The runtime's container contract, as constants rather than as scattered literals. */
const INVOKE_PATH = '/invocations';
const HEALTH_PATH = '/ping';
const RUNTIME_PORT = 8080;
/**
 * The header the runtime puts the caller's conversation in. Matched
 * case-insensitively — HTTP header names are case-insensitive and a proxy in
 * front of the container is free to re-case them.
 */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** Options for {@link agentCoreRuntimeHost}. */
export interface AgentCoreRuntimeHostOptions {
  /**
   * Port to bind. Default `8080` — the port the container contract specifies.
   * Pass `0` in tests to take an ephemeral one.
   */
  readonly port?: number;
  /**
   * Interface to bind. Default `'0.0.0.0'`, which the contract requires: bind
   * to loopback inside the container and the runtime's health probe cannot
   * reach you.
   */
  readonly hostname?: string;
  /**
   * Report `'HealthyBusy'` instead of `'Healthy'` on the health path.
   *
   * A function, not a flag, because busy is a live fact about the process, not
   * a setting: the runtime reads it on every probe to decide whether to send
   * you more work. Omit it and the host reports `'Healthy'`, which is the
   * honest answer for an agent that answers synchronously.
   */
  readonly busy?: () => boolean;
  /**
   * A `node:http` server **you** own, already listening. Given one, this
   * adapter attaches `/invocations` and `/ping` to it instead of binding a
   * socket of its own — which is the only way to serve something else on the
   * same port, and a container gets one port.
   *
   * The case this exists for: a container that must also answer a WebSocket
   * upgrade beside the runtime's two routes. Add your `'upgrade'` listener to
   * the server, listen on 8080 yourself, and attach the agent to it.
   *
   * Every law is `httpHost`'s: unmatched paths are YOURS (this adapter writes
   * no 404 on a server it does not own), and `close()` detaches and drains
   * without closing your socket. `port` and `hostname` are refused alongside
   * it — a server you own already has an address.
   *
   * @example
   *   const server = createServer();
   *   server.on('upgrade', handleWebSocket);
   *   await new Promise<void>((r) => server.listen(8080, '0.0.0.0', r));
   *   const handle = await standingAgent({
   *     agent,
   *     host: agentCoreRuntimeHost({ server }),
   *     sessions: agentCoreSessions({ store: 'session-storage' }),
   *   });
   */
  readonly server?: import('node:http').Server;
}

/**
 * The AgentCore Runtime contract as an {@link HttpWire}.
 *
 * Exported so the body shapes are inspectable and testable without binding a
 * socket, and so a deployment that must serve the same bodies from somewhere
 * else can reuse them by name.
 */
export function agentCoreRuntimeWire(busy?: () => boolean): HttpWire {
  return {
    readRequest(facts: HttpRequestFacts) {
      // `prompt` is the field the runtime's own quickstart and this repo's
      // deploy template use. `input` is accepted too because the runtime passes
      // the payload through verbatim — it is the CALLER who picks the field —
      // and refusing a caller who used the port's own word would be a rule this
      // adapter invented rather than one the contract imposes.
      const prompt = facts.body.prompt ?? facts.body.input;
      const input = typeof prompt === 'string' ? prompt : '';
      // The conversation id arrives in a header, never in the body. It is
      // caller-adjacent data, not identity — the port says so and it is just as
      // true here.
      const sessionId = headerValue(facts, SESSION_HEADER);
      // A person's answer to a run that stopped to ask. Read as-is: what a
      // decision looks like is the tool author's business, not this dialect's.
      // Without it a deployment here could start turns but never finish one
      // that asked a question.
      const decision = facts.body.decision;
      return {
        input,
        ...(sessionId !== undefined && { sessionId }),
        ...(decision !== undefined && { decision }),
      };
    },
    // The runtime polls this to decide whether the container is ready and
    // whether to send it more work. `time_of_last_update` is unix SECONDS.
    health: () => ({
      status: busy?.() === true ? 'HealthyBusy' : 'Healthy',
      time_of_last_update: Math.floor(Date.now() / 1000),
    }),
    output: (response) => ({ response, status: 'success' }),
    // The message only — never a stack. The runtime surfaces the status code;
    // the body is read by whoever called the agent.
    failure: (error, code) => ({ error, status: 'error', ...(code !== undefined && { code }) }),
    // A distinct field from `response` on purpose: a caller concatenating
    // stream frames must not be able to double-count the final answer by
    // reading the same key twice.
    chunk: (chunk) => ({ chunk }),
    // Unfinished work, in this dialect's own vocabulary. `status` is neither
    // 'success' nor 'error' because it is neither: the run stopped to ask a
    // person, it is stored, and a later call carrying `decision` finishes it.
    awaiting: (pending) => ({ awaiting: pending, status: 'awaiting' }),
  };
}

/**
 * An `AgentHost` that speaks AgentCore Runtime's container contract.
 *
 * Passes the same conformance suite as `nodeHost` — it is the same HTTP host
 * with this runtime's two paths, its header, and its two body shapes.
 *
 * @example  The container's entry point
 *   const handle = await standingAgent({
 *     agent,
 *     host: agentCoreRuntimeHost(),
 *     sessions: agentCoreSessions({ store: 'session-storage' }),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */
export function agentCoreRuntimeHost(options: AgentCoreRuntimeHostOptions = {}): HttpHost {
  return httpHost({
    name: HOST_NAME,
    wire: agentCoreRuntimeWire(options.busy),
    invokePath: INVOKE_PATH,
    healthPath: HEALTH_PATH,
    // With a caller-owned server this adapter binds nothing, so it must not
    // invent the contract's port either — the port is whatever the caller
    // listened on, and passing one anyway is refused by `httpHost` rather than
    // quietly ignored. An explicitly passed port still travels, so that refusal
    // reaches a caller who asked for both.
    ...(options.server !== undefined
      ? {
          server: options.server,
          ...(options.port !== undefined && { port: options.port }),
          ...(options.hostname !== undefined && { hostname: options.hostname }),
        }
      : { port: options.port ?? RUNTIME_PORT, hostname: options.hostname ?? '0.0.0.0' }),
  });
}

// ─── The session store ───────────────────────────────────────────────

/**
 * Where {@link agentCoreSessions} keeps a conversation between requests.
 *
 *  - `'session-storage'` — a JSON file under the container's own storage. The
 *    runtime keeps that storage for the life of a session, INCLUDING across a
 *    stop/resume of the container, so a conversation survives the thing most
 *    likely to interrupt it. It does not survive the session ending.
 *  - `'memory'` — one AgentCore Memory event per persist. Outlives the session,
 *    the container and the deployment; costs an API call per turn and the
 *    `@aws-sdk/client-bedrock-agentcore` peer dependency.
 *
 * Chosen at construction, never per call: a store that silently changed where
 * it wrote would be a store you cannot reason about after an incident.
 */
export type AgentCoreSessionStore = 'session-storage' | 'memory';

/** The default file the `'session-storage'` mode writes to. */
export const DEFAULT_SESSION_STORAGE_PATH = '/tmp/agentcore-session';

/** Options for the file-backed mode. */
export interface AgentCoreFileSessionsOptions {
  readonly store: 'session-storage';
  /**
   * Where to write. Default {@link DEFAULT_SESSION_STORAGE_PATH}. One file
   * holds every session this container has seen, keyed by session id — the
   * runtime already gives each session its own storage, so the keying is
   * belt-and-braces for the case where it does not.
   */
  readonly path?: string;
}

/** One AgentCore Memory event, as this adapter cares about it. */
export interface AgentCoreSessionEvent {
  /** Server-assigned event id. */
  readonly eventId: string;
  /**
   * The envelope decoded from the event's blob payload.
   *
   * `null` means the event carried **no blob at all** — nothing here ever
   * claimed to be a session, which is an absence and hydrates as "no
   * conversation".
   *
   * A blob that IS present but could not be decoded travels here **as-is**, so
   * the shared reading law refuses it by name rather than this adapter quietly
   * calling a conversation that exists an absent one. Those are different facts
   * and only one of them is safe to answer with a fresh start.
   */
  readonly envelope: unknown;
}

/**
 * The minimal AgentCore Memory surface the session store calls. The real SDK is
 * adapted to this shape in one function below; tests inject a fake via
 * `_client` and never touch AWS.
 */
export interface AgentCoreSessionClientLike {
  /**
   * Append one envelope as an event (the server assigns the event id).
   *
   * The envelope arrives as an OBJECT; how it reaches the wire is the
   * implementation's business. The shipped shim writes it as JSON text, because
   * this service returns an object blob back as its own host language's
   * `toString()` of it — see `createSessionClient`.
   */
  createEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    envelope: CheckpointEnvelope;
  }): Promise<void>;
  /** The session's events, newest first — the adapter reads only the newest. */
  listEvents(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    maxResults?: number;
  }): Promise<{ events: readonly AgentCoreSessionEvent[] }>;
}

/** Options for the event-backed mode. */
export interface AgentCoreMemorySessionsOptions {
  readonly store: 'memory';
  /** AgentCore Memory ARN or id. Required. */
  readonly memoryId: string;
  /** AWS region, when the adapter constructs the SDK client itself. */
  readonly region?: string;
  /**
   * The AgentCore `actorId` these conversations belong to. Default
   * `'afp-standing-agent'`. One actor per deployed agent is the usual shape.
   */
  readonly actorId?: string;
  /** Pre-built client, to share one SDK config across the host app. */
  readonly client?: AgentCoreSessionClientLike;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: AgentCoreSessionClientLike;
  /** @internal Test injection — the AWS SDK module, to exercise the real shim with a fake SDK. */
  readonly _sdk?: BedrockAgentCoreSessionSdkModule;
}

/** Options for {@link agentCoreSessions}. */
export type AgentCoreSessionsOptions =
  | AgentCoreFileSessionsOptions
  | AgentCoreMemorySessionsOptions;

/**
 * A `SessionLifecycle` backed by AgentCore, with the checkpoint's home chosen
 * at construction.
 *
 * Both modes store the SAME `CheckpointEnvelope` the port defines — a
 * conversation or a paused run — and both refuse an unknown `format` by name
 * through the shared `checkEnvelope`: a session written by a newer runtime is
 * refused, never half-restored. That law is inherited, not re-implemented, and
 * so is its other half: a stored session that is present but **unreadable** is
 * refused by name too (`UnreadableEnvelopeError`), never answered with a fresh
 * start. Only a session that was never written hydrates as `undefined`.
 *
 * @example  Survive a stop/resume, no AWS SDK required
 *   agentCoreSessions({ store: 'session-storage' });
 *
 * @example  Outlive the session entirely
 *   agentCoreSessions({ store: 'memory', memoryId: process.env.MEMORY_ID!, region: 'us-west-2' });
 */
export function agentCoreSessions(options: AgentCoreSessionsOptions): SessionLifecycle {
  return options.store === 'memory' ? memoryEventSessions(options) : fileSessions(options);
}

// ─── 'session-storage': a JSON file ──────────────────────────────────

interface SessionFile {
  readonly version: 1;
  readonly sessions: Record<string, CheckpointEnvelope>;
}

function fileSessions(options: AgentCoreFileSessionsOptions): SessionLifecycle {
  const path = options.path ?? DEFAULT_SESSION_STORAGE_PATH;

  async function readFile(): Promise<SessionFile> {
    const { readFile: read } = await import('node:fs/promises');
    let raw: string;
    try {
      raw = await read(path, 'utf8');
    } catch {
      // No file yet is the ordinary first-request state, not an error.
      return { version: 1, sessions: {} };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new TypeError(
        `[hosting] the session file at '${path}' is not JSON (${(err as Error).message}). ` +
          `Refusing rather than starting every conversation over silently — delete the file ` +
          `to start fresh, or point 'path' somewhere else.`,
      );
    }
    const sessions = (parsed as Partial<SessionFile> | null)?.sessions;
    return sessions && typeof sessions === 'object'
      ? { version: 1, sessions: sessions as Record<string, CheckpointEnvelope> }
      : { version: 1, sessions: {} };
  }

  return {
    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      const file = await readFile();
      const stored = file.sessions[sessionId];
      if (stored === undefined) return undefined;
      // Validate HERE as well as in the composer, so a refusal points at the
      // store that produced the bytes rather than at whoever read them next.
      // `checkEnvelope` accepts either format: a store keeps sessions, and
      // whether a session is mid-conversation or mid-question is not its
      // business — only whether it can be read at all.
      return checkEnvelope(stored, sessionId);
    },
    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      const { writeFile, rename, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const file = await readFile();
      const next: SessionFile = {
        version: 1,
        sessions: { ...file.sessions, [sessionId]: envelope },
      };
      await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
      // Write-then-rename: a container killed mid-write leaves the previous
      // conversation intact rather than a truncated file that refuses to parse.
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(next), 'utf8');
      await rename(temporary, path);
    },
  };
}

// ─── 'memory': one AgentCore Memory event per persist ────────────────

const DEFAULT_ACTOR_ID = 'afp-standing-agent';

function memoryEventSessions(options: AgentCoreMemorySessionsOptions): SessionLifecycle {
  if (!options.memoryId) {
    throw new Error(`agentCoreSessions({ store: 'memory' }) requires 'memoryId'.`);
  }
  const memoryId = options.memoryId;
  const actorId = options.actorId ?? DEFAULT_ACTOR_ID;
  const client =
    options._client ?? options.client ?? createSessionClient(options.region, options._sdk);

  return {
    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      // AgentCore Memory is an append-only log and lists newest-first, so the
      // newest readable event IS the conversation. Older ones are the earlier
      // turns and deliberately left where they are — they are the audit trail.
      const page = await client.listEvents({
        memoryId,
        actorId,
        sessionId: safeSessionId(sessionId),
        maxResults: 1,
      });
      const newest = page.events[0];
      // No event, or an event carrying no blob: nothing here ever claimed to be
      // a session, so this really is a fresh start. Anything else — including a
      // blob that came back mangled — goes to `checkEnvelope`, which refuses a
      // conversation it cannot read BY NAME instead of returning `undefined`
      // and letting the agent answer as if the session were new.
      if (!newest || newest.envelope === null || newest.envelope === undefined) return undefined;
      // `decodeBlob` again rather than only inside the shim: a caller-supplied
      // `client` is free to hand back the stored text as it found it, and text
      // this adapter can plainly read is not something to refuse on a
      // technicality. Anything it cannot read still reaches `checkEnvelope`.
      return checkEnvelope(decodeBlob(newest.envelope), sessionId);
    },
    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      await client.createEvent({
        memoryId,
        actorId,
        sessionId: safeSessionId(sessionId),
        envelope,
      });
    },
  };
}

const SESSION_ID_MAX = 99;

/** AgentCore ids accept `[A-Za-z0-9_-]`; a session id is caller data and need not. */
function safeSessionId(raw: string): string {
  const slug = raw.replace(/[^A-Za-z0-9_-]/g, '-');
  if (slug.length <= SESSION_ID_MAX) return slug;
  // Keep a readable head plus a stable tail so two long ids stay distinct.
  return `${slug.slice(0, SESSION_ID_MAX - 9)}-${fnv1a(raw)}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCoreSessionSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly CreateEventCommand?: new (input: unknown) => unknown;
  readonly ListEventsCommand?: new (input: unknown) => unknown;
}

/**
 * Turn one stored blob back into an envelope — the adapter's ONE decode step.
 *
 * ── Why a string is the normal case, not the exotic one ──────────────────────
 * This adapter writes the envelope as **JSON text** (see `createEvent` below),
 * so the blob that comes back is a string and is parsed here. Objects are still
 * accepted: a caller who supplies their own `client` can hand back a real
 * object, and refusing it would break a seam that never had this problem.
 *
 * A blob it cannot decode is handed back **AS-IS**, never as `null`. `null`
 * means "no blob", which is an absence, and an absence is answered with a fresh
 * start; a conversation that exists and cannot be read must not be. Passing the
 * raw value on puts it in front of `checkEnvelope`, which refuses by name.
 */
function decodeBlob(blob: unknown): unknown {
  if (typeof blob !== 'string') return blob;
  try {
    const parsed: unknown = JSON.parse(blob);
    // JSON.parse('"x"') is a string, not an envelope. Hand back the ORIGINAL
    // bytes so the refusal quotes what the store actually holds.
    return parsed !== null && typeof parsed === 'object' ? parsed : blob;
  } catch {
    return blob;
  }
}

/** Pull the envelope out of an event's `payload` (a single `blob` document). */
function envelopeFromPayload(payload: unknown): unknown {
  if (!Array.isArray(payload)) return null;
  for (const part of payload) {
    if (!part || typeof part !== 'object' || !('blob' in part)) continue;
    const blob = (part as { blob?: unknown }).blob;
    // A part with no blob VALUE is not a session either — keep looking.
    if (blob === null || blob === undefined) continue;
    return decodeBlob(blob);
  }
  return null;
}

/**
 * Map {@link AgentCoreSessionClientLike} onto the real SDK commands. If AWS
 * renames a command, only this function changes — which is also why every test
 * injects past it.
 */
function createSessionClient(
  region: string | undefined,
  injected?: BedrockAgentCoreSessionSdkModule,
): AgentCoreSessionClientLike {
  let mod: BedrockAgentCoreSessionSdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCoreSessionSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        `agentCoreSessions({ store: 'memory' }) requires the ` +
          '`@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          "  Or use { store: 'session-storage' }, which needs no SDK at all.",
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'agentCoreSessions: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(region && { region }) });

  const send = async (
    Ctor: (new (input: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ): Promise<unknown> => {
    if (!Ctor) {
      throw new Error(
        `agentCoreSessions: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. Upgrade the SDK.`,
      );
    }
    return sdk.send(new Ctor(input));
  };

  return {
    async createEvent({ memoryId, actorId, sessionId, envelope }) {
      await send(mod.CreateEventCommand, 'CreateEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        // JSON TEXT, not the object. Field-learned, and the whole reason for
        // this release: given an object, the service stores its own host
        // language's `toString()` rendering of it and returns THAT string —
        // `{format=conversation-v1, data={...}}`, which is not JSON and which
        // nothing can turn back into a conversation. The envelope is defined as
        // something a store can hold as text (`toEnvelope` round-trips through
        // `JSON.stringify` by construction), so the encoding is ours to pick and
        // the honest pick is the one whose bytes come back unchanged.
        payload: [{ blob: JSON.stringify(envelope) }],
      });
    },
    async listEvents({ memoryId, actorId, sessionId, maxResults }) {
      const result = (await send(mod.ListEventsCommand, 'ListEventsCommand', {
        memoryId,
        actorId,
        sessionId,
        includePayloads: true,
        ...(maxResults !== undefined && { maxResults }),
      })) as { events?: ReadonlyArray<{ eventId?: string; payload?: unknown }> } | null;
      const events: AgentCoreSessionEvent[] = (result?.events ?? []).map((event) => ({
        eventId: event.eventId ?? '',
        envelope: envelopeFromPayload(event.payload),
      }));
      return { events };
    },
  };
}
