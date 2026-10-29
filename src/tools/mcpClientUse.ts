/**
 * mcpClientUse — the door an MCP client pool's use of a client enters the run by.
 *
 * Pattern: a per-dispatch port (the `requestEvidence.ts` precedent) for a call,
 *          and a per-context ledger for a listing, behind one allow-list.
 * Role:    `mcpClientPool` (`mcp/pool/`, layer L12) runs below the agent (L9):
 *          it cannot reach a scope, and the agent cannot import it. Both reach
 *          this module, which sits under both:
 *
 *   - a CALL: the dispatch loop puts a port on each call's context
 *     (`mcpClientUseFor`), stamped with that call's id; a pooled tool files its
 *     use through it once, as its `execute` settles;
 *   - a LISTING: the pool files its use against the `ToolDispatchContext`
 *     object it was handed (`fileListUse`); the tools slot takes the uses filed
 *     against the context it passed (`takeListUses`) after `list(ctx)`, and
 *     emits them.
 *
 * Either way the event is `agentfootprint.tools.mcp_client`, emitted by the
 * library stage that called the pool, mid-stage, through `typedEmit` — so the
 * run's redaction rule serves it and its meta carries the real stage.
 *
 * THE ALLOW-LIST is the whole record: the fields of `ToolsMcpClientPayload`,
 * the library's own words for each, numbers, and two ids of the pool's own
 * making (`keyHash`, `clientId`) under a fixed shape. A filing with anything
 * else — a field nobody listed, a word outside its set, a non-plain value — is
 * refused whole, never trimmed into something it did not say.
 */

import { isDevMode } from 'footprintjs';

import type { ToolsMcpClientPayload } from '../events/payloads.js';
import { typedEmit, type EmitableScope } from '../recorders/core/typedEmit.js';

/** What a pool use files: the payload, less the call id the dispatch stamps. */
export type McpClientUse = Omit<ToolsMcpClientPayload, 'toolCallId'>;

/** Where one dispatched call's pool use goes. */
export interface McpClientUseSink {
  /** File the use. Never throws; a filing outside the allow-list is refused whole. */
  file(use: McpClientUse): void;
}

/** @internal The context key the dispatcher puts a call's sink under. */
export const MCP_CLIENT_USE: unique symbol = Symbol('agentfootprint.mcp-client-use');

/** What the dispatcher spreads into a call's context. */
export interface McpClientUsePort {
  readonly [MCP_CLIENT_USE]: McpClientUseSink;
}

/**
 * The port for one dispatch: files `agentfootprint.tools.mcp_client` at
 * `'call'`, stamped with the call's id, at most once.
 */
export function mcpClientUseFor(
  scope: EmitableScope,
  call: { readonly toolCallId: string },
): McpClientUsePort {
  let filed = false;
  const sink: McpClientUseSink = {
    file: (use) => {
      if (filed) return;
      filed = true;
      emitUse(scope, { ...use, at: 'call' }, call.toolCallId);
    },
  };
  return { [MCP_CLIENT_USE]: sink };
}

/** The sink a call's context carries, or `undefined`. Never throws, whatever `ctx` is. */
export function mcpClientUseOf(ctx: unknown): McpClientUseSink | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  let port: unknown;
  try {
    port = (ctx as { readonly [MCP_CLIENT_USE]?: unknown })[MCP_CLIENT_USE];
  } catch {
    return undefined;
  }
  if (port === null || typeof port !== 'object') return undefined;
  return typeof (port as { readonly file?: unknown }).file === 'function'
    ? (port as McpClientUseSink)
    : undefined;
}

/** Listing uses filed against a dispatch context, until the tools slot takes them. */
const LIST_USES = new WeakMap<object, McpClientUse[]>();

/** File a listing's use against the `ToolDispatchContext` it was asked with. Never throws. */
export function fileListUse(ctx: unknown, use: McpClientUse): void {
  if (ctx === null || typeof ctx !== 'object') return;
  const uses = LIST_USES.get(ctx) ?? [];
  uses.push({ ...use, at: 'list' });
  LIST_USES.set(ctx, uses);
}

/** Take (and forget) every listing use filed against `ctx`. */
export function takeListUses(ctx: object): readonly McpClientUse[] {
  const uses = LIST_USES.get(ctx) ?? [];
  LIST_USES.delete(ctx);
  return uses;
}

/** Emit the listing uses filed against `ctx`, as the tools slot does after `list(ctx)`. */
export function emitListUses(scope: EmitableScope, ctx: object): void {
  for (const use of takeListUses(ctx)) emitUse(scope, use, undefined);
}

/** One use, through the allow-list, as the event. Never throws. */
function emitUse(scope: EmitableScope, use: McpClientUse, toolCallId: string | undefined): void {
  const served = servedUse(use);
  if (served === undefined) {
    warnOnce('a filing outside the allow-list was refused');
    return;
  }
  try {
    typedEmit(scope, 'agentfootprint.tools.mcp_client', {
      ...served,
      ...(toolCallId !== undefined && { toolCallId }),
    });
  } catch (err) {
    // The record is not the work: a sink that dies must not fail the call.
    warnOnce(err instanceof Error ? err.message : String(err));
  }
}

// ─── The allow-list ──────────────────────────────────────────────────

type Words<W extends string> = { readonly [K in W]: true };

const AT: Words<ToolsMcpClientPayload['at']> = { list: true, call: true };
const CLIENT: Words<ToolsMcpClientPayload['client']> = {
  opened: true,
  joined: true,
  reused: true,
  'not-needed': true,
  refused: true,
  expired: true,
  'handle-lost': true,
};
const PREVIOUS: Words<NonNullable<ToolsMcpClientPayload['previous']>> = {
  idle: true,
  evicted: true,
  expired: true,
  'handle-lost': true,
  terminated: true,
};
const EVIDENCE: Words<NonNullable<ToolsMcpClientPayload['evidence']>> = {
  'server-404': true,
  'transport-forgot-handle': true,
};
const REFUSAL: Words<NonNullable<ToolsMcpClientPayload['refusal']>> = {
  'pool-full': true,
  'principal-full': true,
  'ending-full': true,
  'init-timeout': true,
  'init-failed': true,
  'no-identity': true,
  'incomplete-identity': true,
  'identity-mismatch': true,
  'stale-tools': true,
  'binding-changed': true,
  'request-unmatched': true,
  'lease-expired': true,
  'operations-full': true,
  closed: true,
};
const DEFINITIONS: Words<NonNullable<ToolsMcpClientPayload['definitions']>> = {
  shared: true,
  listed: true,
};
const REVALIDATED: Words<NonNullable<ToolsMcpClientPayload['revalidated']>> = {
  kept: true,
  refused: true,
};

/** A digest of `hashSessionKey`'s shape: hex (SHA-256) or the FNV fallback. */
const KEY_HASH = /^[0-9a-f]{8,16}$/;
/** The pool's own client id: a random hex string. */
const CLIENT_ID = /^[0-9a-f]{12,32}$/;
/** A server name the app declared: a short plain label. */
const SERVER = /^[\x21-\x7e][\x20-\x7e]{0,127}$/;

/** The use as the record may carry it, or `undefined` when it is outside the allow-list. */
export function servedUse(use: McpClientUse): McpClientUse | undefined {
  if (use === null || typeof use !== 'object' || Array.isArray(use)) return undefined;
  const allowed = new Set([
    'server',
    'at',
    'keyHash',
    'clientId',
    'generation',
    'client',
    'previous',
    'evidence',
    'refusal',
    'initMs',
    'definitions',
    'definitionsAgeMs',
    'revalidated',
  ]);
  for (const key of Object.keys(use)) if (!allowed.has(key)) return undefined;
  const ok =
    typeof use.server === 'string' &&
    SERVER.test(use.server) &&
    word(AT, use.at) &&
    word(CLIENT, use.client) &&
    optional(use.keyHash, (v) => typeof v === 'string' && KEY_HASH.test(v)) &&
    optional(use.clientId, (v) => typeof v === 'string' && CLIENT_ID.test(v)) &&
    optional(use.generation, wholeNumber) &&
    optional(use.previous, (v) => word(PREVIOUS, v)) &&
    optional(use.evidence, (v) => word(EVIDENCE, v)) &&
    optional(use.refusal, (v) => word(REFUSAL, v)) &&
    optional(use.initMs, nonNegative) &&
    optional(use.definitions, (v) => word(DEFINITIONS, v)) &&
    optional(use.definitionsAgeMs, nonNegative) &&
    optional(use.revalidated, (v) => word(REVALIDATED, v));
  if (!ok) return undefined;
  return { ...use };
}

function word<W extends string>(words: Words<W>, value: unknown): boolean {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(words, value);
}

function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function wholeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function nonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Dev mode, once per reason: a filing the record could not take. */
const warned = new Set<string>();
function warnOnce(reason: string): void {
  if (!isDevMode() || warned.has(reason)) return;
  warned.add(reason);
  // eslint-disable-next-line no-console
  console.warn(`[agentfootprint] tools.mcp_client: ${reason}.`);
}
