/**
 * adapters/hosting/agentCoreA2A — an agentfootprint agent as an AWS Bedrock
 * **AgentCore A2A** server, callable by other agents.
 *
 * ── The split, again ─────────────────────────────────────────────────────────
 * Two different things are needed, and only one is Amazon's:
 *
 *   • The **A2A protocol** — JSON-RPC 2.0, `message/send`, artifacts, the agent
 *     card. An open protocol several runtimes speak, so it lives in
 *     `a2aWire.ts` with no vendor in it.
 *   • The **container contract** — port 9000 (not 8080, and not 8000: each
 *     protocol gets its own), the agent mounted at `/`, `GET /ping` answering
 *     `{"status":"Healthy"}`, the session id arriving in
 *     `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`, and a table of JSON-RPC
 *     error codes that are this runtime's exceptions rather than A2A's. That
 *     IS Amazon's, and it is what this file supplies.
 *
 * ── One deviation you must know about ────────────────────────────────────────
 * The A2A specification delivers JSON-RPC errors over HTTP 200. **AgentCore
 * does not** — it returns the real status code (409, 404, …) with the JSON-RPC
 * error body. That is a fact about the platform in front of your container, so
 * a CLIENT must parse the error body even on a non-2xx response; see
 * `agentCoreA2AErrorCode` for the table this host mirrors on the way out.
 *
 * ── What is NOT provided ─────────────────────────────────────────────────────
 * `message/stream` and the task lifecycle. The agent card this host serves
 * therefore declares `streaming: false` unless you overrule it, because a card
 * that advertises streaming to a wire that cannot stream is a caller left
 * waiting. AWS's own sample card says `true`; ours says what is true of ours.
 *
 * @example  An agent other agents can call
 *   import { agentCoreA2AHost, memorySessions, standingAgent } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: agentCoreA2AHost({
 *       card: { name: 'triage', description: 'Triages SAN alerts.', version: '1.0.0' },
 *     }),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { headerValue, httpHost, type HttpHost } from '../../hosting/httpHost.js';
import {
  a2aAgentCardDocument,
  a2aWire,
  A2A_AGENT_CARD_PATH,
  type A2AAgentCard,
} from './a2aWire.js';

/** The port an AgentCore A2A server is expected on — its own, not HTTP's or MCP's. */
export const DEFAULT_AGENTCORE_A2A_PORT = 9000;

/** A2A mounts the agent at the root. */
export const AGENTCORE_A2A_INVOKE_PATH = '/';

/** The runtime's health path for every protocol. */
export const AGENTCORE_PING_PATH = '/ping';

/** Where the platform puts the caller's session. */
export const AGENTCORE_SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/**
 * AgentCore's own JSON-RPC error codes, mapped from this library's refusal codes.
 *
 * These numbers are the RUNTIME's exception table, not A2A's: `-32051`
 * ResourceNotFound, `-32052` Validation, `-32053` Throttling and
 * ServiceQuotaExceeded, `-32054` Conflict and RetryableConflict, `-32055`
 * RuntimeClientError, `-32603` anything else. A client reads them to decide
 * whether to retry — `-32054` with "Session operation in progress" is the one
 * that must be retried with backoff, and A2A clients do not do that on their
 * own.
 *
 * Exported so a client built against this host can share one table with it
 * rather than keep a second copy that drifts.
 */
export function agentCoreA2AErrorCode(code: string | undefined): number {
  switch (code) {
    case 'ERR_SESSION_NOT_FOUND':
    case 'ERR_ARTIFACT_NOT_FOUND':
      return -32051;
    case 'ERR_INVALID_WIRE_OP':
    case 'ERR_DECISION_REQUIRED':
    case 'ERR_ARTIFACT_SESSION_REQUIRED':
    case 'invalid_request':
    case 'invalid_params':
    case 'unsupported_part':
      return -32052;
    case 'ERR_ADMISSION_REFUSED':
    case 'ERR_REQUEST_TOO_LARGE':
      return -32053;
    case 'ERR_CONCURRENT_RUN':
    case 'ERR_HOST_CLOSED':
    case 'ERR_AWAITING_DECISION':
    case 'ERR_PAUSE_NOT_CARRIED':
      return -32054;
    case 'method_not_found':
      // JSON-RPC's own "method not found" is -32601, but this runtime reports a
      // route it cannot resolve as ResourceNotFound. The platform's table wins
      // inside the platform's container.
      return -32051;
    default:
      return -32603;
  }
}

export interface AgentCoreA2AHostOptions {
  /** The agent card other agents read. Required — discovery is not optional in A2A. */
  readonly card: A2AAgentCard;
  /** Port to bind. Default {@link DEFAULT_AGENTCORE_A2A_PORT}. Pass `0` in tests. */
  readonly port?: number;
  /** Interface to bind. Default `'0.0.0.0'` — a container's door must be reachable. */
  readonly hostname?: string;
  /** Ceiling on a request body. Default one mebibyte. */
  readonly maxBodyBytes?: number;
  /** A `node:http` server you own. Refused together with `port`/`hostname`. */
  readonly server?: Server;
  /**
   * Answer a path this host does not own. The agent card is served BEFORE this
   * runs, and everything else falls through to you unchanged — so supplying one
   * costs you nothing the card was not already going to take.
   */
  readonly onUnhandled?: (req: IncomingMessage, res: ServerResponse) => void;
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/**
 * An {@link HttpHost} serving AgentCore's A2A container contract.
 *
 * `httpHost` keeps its own promises — draining, aborting on disconnect, failing
 * a handler that throws or answers nothing — and this supplies the protocol,
 * the paths, the port, the session header and the error table.
 */
export function agentCoreA2AHost(options: AgentCoreA2AHostOptions): HttpHost {
  const { server, onUnhandled, hostname, card } = options;
  const cardDocument = JSON.stringify(a2aAgentCardDocument(card));

  /** The discovery document, served before anything falls through to the caller. */
  const serveCard = (req: IncomingMessage, res: ServerResponse): void => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === A2A_AGENT_CARD_PATH) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(cardDocument),
      });
      res.end(cardDocument);
      return;
    }
    // Not the card: the caller's own routes, if they have any. Chaining rather
    // than consuming the slot — an adapter that took `onUnhandled` for itself
    // would silently remove a seam the host documents as the consumer's.
    if (onUnhandled) {
      onUnhandled(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `no route for ${req.method ?? '?'} ${path}` }));
  };

  const socket = server
    ? { server }
    : {
        port: options.port ?? DEFAULT_AGENTCORE_A2A_PORT,
        ...(hostname === undefined ? {} : { hostname }),
        onUnhandled: serveCard,
      };

  const protocol = a2aWire({
    card,
    // The runtime's health contract, not A2A's — A2A has no /ping at all.
    health: { status: 'Healthy' },
    errorCodeFor: agentCoreA2AErrorCode,
    name: 'agentCoreA2AHost',
  });

  return httpHost({
    name: 'agentCoreA2AHost',
    wire: {
      ...protocol,
      // The one thing the protocol does not carry and the platform does: which
      // conversation this call belongs to, in a header of the runtime's own.
      readRequest(facts) {
        const base = protocol.readRequest(facts);
        const sessionId = headerValue(facts, AGENTCORE_SESSION_HEADER);
        return { ...base, ...(sessionId !== undefined && { sessionId }) };
      },
    },
    invokePath: AGENTCORE_A2A_INVOKE_PATH,
    healthPath: AGENTCORE_PING_PATH,
    // NOT `['streaming']`, which is this file's default. `message/send` has
    // nowhere to put a chunk: a caller gets one JSON-RPC reply and nothing
    // before it. Declaring streaming anyway would make `requireCapability`
    // pass for a host that cannot honour it, and would contradict the agent
    // card, which says `streaming: false` for the same reason. The host
    // conformance suite catches exactly this — it asserts chunks IF AND ONLY IF
    // the capability is declared, and it caught it here.
    capabilities: [],
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    ...socket,
  });
}
