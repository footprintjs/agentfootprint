/**
 * adapters/hosting/a2aWire — the A2A protocol, as an `HttpWire`.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * **A2A** (agent-to-agent) is an open protocol for one agent calling another:
 * JSON-RPC 2.0 over HTTP, a `message/send` method carrying text parts, a result
 * carrying artifacts, and a discovery document — the **agent card** — that says
 * what the agent is and what it can do. It is nobody's product; several
 * runtimes speak it, so it lives here on its own and the runtimes that host it
 * configure this rather than reimplement it.
 *
 * ── The subset, stated plainly ───────────────────────────────────────────────
 * One method: `message/send`, text parts only. Deliberately NOT carried:
 * `message/stream` and the rest of the task lifecycle (`tasks/get`,
 * `tasks/cancel`, push notifications), non-text parts, and multi-turn task
 * state. An agent card built here therefore declares `streaming: false` by
 * default — advertising a capability this wire cannot honour is how a caller
 * finds out by hanging.
 *
 * ── Why it fits `httpHost` without changing it ───────────────────────────────
 * JSON-RPC's one hard requirement on a reply is that it ECHOES the request's
 * `id`. That is possible here only because `HttpWire`'s body methods receive
 * the request that produced them — a seam added for a different protocol
 * entirely, and the reason this one needed no new machinery.
 *
 * @example  A2A on paths of your own choosing
 *   httpHost({
 *     name: 'myA2AHost',
 *     wire: a2aWire({ card: { name: 'triage', description: '…', version: '1.0.0' } }),
 *     invokePath: '/',
 *     healthPath: '/health',
 *   });
 */

import { WireRequestRefusal } from '../../hosting/errors.js';
import type { FailureOrigin, HttpRequestFacts, HttpWire } from '../../hosting/httpHost.js';

/** The A2A protocol revision this wire's documents declare. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Where the A2A specification puts an agent's discovery document. */
export const A2A_AGENT_CARD_PATH = '/.well-known/agent-card.json';

/** The one method this wire carries. */
export const A2A_SEND_METHOD = 'message/send';

/**
 * JSON-RPC's own reserved codes, the two this wire can raise.
 *
 * `-32601` is "method not found" and `-32602` is "invalid params" — both from
 * the JSON-RPC specification rather than from A2A or any runtime, which is why
 * they are the only numbers this neutral file knows. A runtime's own error
 * codes belong to that runtime's adapter.
 */
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/** One skill an agent card advertises. */
export interface A2ASkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[];
}

/** The agent card this wire serves — what another agent reads to decide to call yours. */
export interface A2AAgentCard {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** Where callers reach this agent. A runtime that mounts the agent behind its
   *  own URL fills this in; left out, the card simply omits it. */
  readonly url?: string;
  /** Default `false` — see the module note on why this wire does not claim it. */
  readonly streaming?: boolean;
  readonly defaultInputModes?: readonly string[];
  readonly defaultOutputModes?: readonly string[];
  readonly skills?: readonly A2ASkill[];
}

export interface A2AWireOptions {
  /** The agent card. Required: A2A discovery is not optional in the protocol. */
  readonly card: A2AAgentCard;
  /** Body for the health probe. Default `{ status: 'ok' }`. */
  readonly health?: unknown;
  /**
   * Map a refusal's stable code onto the numeric JSON-RPC code this deployment
   * reports. Absent, everything that is not a malformed request is
   * `-32603` (internal error) — the JSON-RPC catch-all.
   *
   * A runtime with its own published code table passes one; that table is the
   * runtime's, and this file does not carry anybody's.
   */
  readonly errorCodeFor?: (code: string | undefined) => number;
  /** Name used in refusal messages. Default `'a2aWire'`. */
  readonly name?: string;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The request's JSON-RPC id, echoed onto every reply. `null` is legal and distinct from absent. */
function requestId(facts: HttpRequestFacts | undefined): string | number | null {
  const id = facts?.body.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/**
 * The text of one A2A message — every part concatenated, refusing what is not text.
 *
 * A non-text part is refused rather than skipped for the reason every dialect
 * in this library refuses rather than skips: an answer produced from the parts
 * that happened to be understood is a wrong answer delivered confidently.
 */
export function readA2AMessageText(message: unknown): string {
  if (!isRecord(message)) {
    throw new WireRequestRefusal('invalid_params', 'params.message must be an object', 400);
  }
  const parts = message.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new WireRequestRefusal(
      'invalid_params',
      'params.message.parts must be a non-empty array',
      400,
    );
  }
  const text: string[] = [];
  for (const part of parts) {
    if (!isRecord(part) || part.kind !== 'text' || typeof part.text !== 'string') {
      const kind = isRecord(part) && typeof part.kind === 'string' ? part.kind : 'unknown';
      throw new WireRequestRefusal(
        'unsupported_part',
        `this agent carries text parts only; '${kind}' parts are not supported`,
        400,
      );
    }
    text.push(part.text);
  }
  return text.join('');
}

/**
 * The agent card document, as the protocol prints it.
 *
 * Exported on its own because a deployment often has to serve the card from
 * somewhere this wire does not own — a CDN, a route in a framework, a runtime's
 * own discovery API — and the document should be built once, here, rather than
 * hand-copied into each of those places.
 */
export function a2aAgentCardDocument(card: A2AAgentCard): JsonObject {
  return {
    name: card.name,
    description: card.description,
    version: card.version,
    ...(card.url !== undefined && { url: card.url }),
    protocolVersion: A2A_PROTOCOL_VERSION,
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: card.streaming === true },
    defaultInputModes: card.defaultInputModes ?? ['text'],
    defaultOutputModes: card.defaultOutputModes ?? ['text'],
    skills: (card.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags ?? [],
    })),
  };
}

/** An `HttpWire` speaking A2A's `message/send`. */
export function a2aWire(options: A2AWireOptions): HttpWire {
  const health = options.health ?? { status: 'ok' };
  const name = options.name ?? 'a2aWire';
  const codeFor = options.errorCodeFor ?? ((): number => JSONRPC_INTERNAL_ERROR);

  const envelope = (facts: HttpRequestFacts | undefined, body: JsonObject): JsonObject => ({
    jsonrpc: '2.0',
    id: requestId(facts),
    ...body,
  });

  return {
    readRequest(facts) {
      const { body } = facts;
      if (body.jsonrpc !== '2.0') {
        throw new WireRequestRefusal(
          'invalid_request',
          `${name}: every request must carry "jsonrpc": "2.0"`,
          400,
        );
      }
      if (body.method !== A2A_SEND_METHOD) {
        // Named rather than ignored: a caller using a method this agent does
        // not implement learns which one it does, instead of receiving an
        // empty answer to a question that was never asked.
        throw new WireRequestRefusal(
          'method_not_found',
          `${name}: only '${A2A_SEND_METHOD}' is implemented; received '${String(body.method)}'`,
          404,
        );
      }
      const params = isRecord(body.params) ? body.params : undefined;
      const input = readA2AMessageText(params?.message);
      if (input.trim() === '') {
        throw new WireRequestRefusal(
          'invalid_params',
          `${name}: message text must not be empty`,
          400,
        );
      }
      // A2A carries no session of its own — the transport hosting it does, and
      // the runtime adapter reads it from wherever that transport puts it.
      return { input };
    },

    health: () => health,

    output: (output, facts) =>
      envelope(facts, {
        result: {
          artifacts: [
            {
              artifactId: String((facts?.body.id as string | undefined) ?? 'artifact'),
              name: 'agent_response',
              parts: [{ kind: 'text', text: output }],
            },
          ],
        },
      }),

    chunk: (text) => ({ kind: 'text', text }),

    failure: (message: string, code?: string, facts?: HttpRequestFacts, origin?: FailureOrigin) =>
      envelope(facts, {
        error: {
          code: codeFor(code),
          // A thrown exception's words are the author's note to their own logs.
          // A refusal this library authored was written to be read.
          message: origin === 'threw' ? 'The agent could not complete this request.' : message,
        },
      }),
  };
}
