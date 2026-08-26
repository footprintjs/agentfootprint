/**
 * adapters/hosting/foundryResponses — an agent behind Microsoft Foundry's
 * hosted-agent contract.
 *
 * ── The split, and why it is here ────────────────────────────────────────────
 * Two different things are needed to serve a Foundry hosted agent, and only one
 * of them is Microsoft's:
 *
 *   • The **Responses protocol** — `input` items, a `response` object, the
 *     named streaming lifecycle. That is a protocol several runtimes speak, so
 *     it lives in `responsesWire.ts` with no vendor in it.
 *   • The **hosting contract** — port 8088, `POST /responses`, a `HEAD` probe
 *     on the same path, `GET /readiness` answering `{"status":"healthy"}`, and
 *     `agent_session_id` as a session alias. That IS this runtime's contract,
 *     the same way `/invocations` and `X-Amzn-…` are another's, and it is what
 *     this file supplies.
 *
 * So this file is a configuration, not an implementation. Everything hard —
 * draining on close, aborting when the caller hangs up, failing a handler that
 * throws or answers nothing — is `httpHost`'s, shared with every other adapter
 * rather than reimplemented here where the two would drift.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * **Workflow Visualizer topology is not provided.** The Inspector can invoke
 * this host and render its answer; it does not learn that the answer came from
 * four composed agents, because nothing in the Responses protocol carries that
 * and inventing a channel for it would be claiming a compatibility this has
 * never demonstrated. An agent's internal structure is readable from
 * agentfootprint's own recorders.
 *
 * Everything the protocol does not carry — tool calls, image and file input,
 * function-call output, structured output — is refused by name. See
 * `responsesWire.ts`.
 *
 * This is an **inbound hosting adapter**: it is the door callers arrive at. It
 * is not a model provider, and it has nothing to do with which model the agent
 * calls — for Foundry models, that is `openai()` with the endpoint's base URL.
 *
 * @example  An agent behind the Inspector
 *   import { foundryResponsesHost, memorySessions, standingAgent } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: foundryResponsesHost(),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { httpHost, type HttpHost } from '../../hosting/httpHost.js';
import { responsesWire } from './responsesWire.js';

/** The port a Foundry hosted agent is expected on. */
export const DEFAULT_FOUNDRY_PORT = 8088;

/** The path that takes a turn. */
export const FOUNDRY_INVOKE_PATH = '/responses';

/** The path a Foundry hosted agent answers a readiness probe on. */
export const FOUNDRY_READINESS_PATH = '/readiness';

/**
 * Session aliases this contract accepts, in precedence order.
 *
 * `conversation` is the protocol's own; `agent_session_id` is this runtime's;
 * `session_id` is the spelling several clients send anyway. First one present
 * wins, so a caller using any of the three reaches the same session.
 */
export const FOUNDRY_SESSION_FIELDS: readonly string[] = [
  'conversation',
  'agent_session_id',
  'session_id',
];

/**
 * One mebibyte: large enough for any resume or job description this door was
 * built to carry, small enough that a hostile caller cannot spend the heap.
 */
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export interface FoundryResponsesHostOptions {
  /** Port to bind. Default {@link DEFAULT_FOUNDRY_PORT}. Pass `0` for an ephemeral test port. */
  readonly port?: number;
  /** Interface to bind. Default `'0.0.0.0'` — a container's door has to be reachable from outside it. */
  readonly hostname?: string;
  /** Model label echoed in `response` objects when the request names none. */
  readonly model?: string;
  /** Ceiling on a request body. Default one mebibyte. */
  readonly maxBodyBytes?: number;
  /**
   * A `node:http` server you own, to ATTACH these routes to rather than binding
   * one. Refused together with `port`/`hostname`, which would name a socket
   * this host does not bind.
   */
  readonly server?: Server;
  /** Answer a path this host does not own. Private-server mode only. */
  readonly onUnhandled?: (req: IncomingMessage, res: ServerResponse) => void;
}

/**
 * An {@link HttpHost} speaking Foundry's hosted-agent contract.
 *
 * @param options - Port, interface, model label and body ceiling.
 */
export function foundryResponsesHost(options: FoundryResponsesHostOptions = {}): HttpHost {
  const { server, onUnhandled, model, hostname } = options;
  // `port` and `hostname` name a socket a caller-owned server already bound, so
  // they are passed only when this host is the one binding. Defaulting the port
  // unconditionally would turn "attach to my server" into a refusal.
  const socket = server
    ? { server }
    : {
        port: options.port ?? DEFAULT_FOUNDRY_PORT,
        ...(hostname === undefined ? {} : { hostname }),
        ...(onUnhandled === undefined ? {} : { onUnhandled }),
      };

  return httpHost({
    name: 'foundryResponsesHost',
    wire: responsesWire({
      ...(model === undefined ? {} : { defaultModel: model }),
      sessionFields: FOUNDRY_SESSION_FIELDS,
      health: { status: 'healthy' },
    }),
    invokePath: FOUNDRY_INVOKE_PATH,
    healthPath: FOUNDRY_READINESS_PATH,
    // The Inspector asks whether the door is there before it uses it.
    invokeHeadProbe: true,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    ...socket,
  });
}
