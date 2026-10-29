/**
 * boundTool — a tool bound to its conversation, the list it came from and that
 * list's generation, re-checked after every wait and at the send gate.
 *
 * Pattern: the shape every MCP tool takes (`mcpClient.ts` · `mcpToolShape`) +
 *          one `execute` that runs the five steps of § 6.3.
 * Role:    A bound tool carries its BINDING: the key it was listed for; the
 *          context it was listed in (per client, the configuration; shared, the
 *          entry's context); the list it came from (per client, the client
 *          incarnation; shared, the entry); and that list's generation. Its
 *          `execute`:
 *
 *   1. checks that the calling run's caller identity encodes to its key —
 *      otherwise `identity-mismatch`, nothing sent;
 *   2. checks its binding is current — otherwise `stale-tools`, nothing sent;
 *   3. is admitted against `maxOperations` and takes a lease on its key's
 *      client, opening one from a plan resolved now when the key has none. A
 *      client whose plan's context differs from the binding's refuses with
 *      `binding-changed` (the client stays for the next list). A client that is
 *      not the incarnation the tool was listed from is checked against its OWN
 *      fresh list — the call goes on only if that list holds the same
 *      definition, compared as canonical JSON; otherwise `stale-tools`. Under
 *      the app's sharing contract, a replacement whose context matches uses the
 *      shared entry as it stands;
 *   4. after every wait, checks step 2 again — and asks the app's `share`
 *      again, so a changed authorization name refuses it (`binding-changed`);
 *   5. sends through the send gate (`mcp/requestGuard.ts`), asked at every
 *      boundary the request crosses — before every attempt, after a credential
 *      arrives, after signing — classifies the outcome (a server's 404 for the
 *      session is `SessionExpiredError`; a handle this process lost is
 *      `LocalSessionHandleLostError`; neither is repeated), files its use, and
 *      releases its lease once the request's own work has settled.
 *
 * Never another conversation's connection: the binding is to the KEY, and a
 * client of any other key never serves it.
 */

import type { Tool, ToolExecutionContext } from '../../tools/tools.js';
import { mcpClientUseOf } from '../../tools/mcpClientUse.js';
import { LocalSessionHandleLostError } from '../../tools/toolSessions.js';
import { ServerEndedSessionError } from './sessionEnded.js';
import { mcpToolShape } from '../mcpClient.js';
import { withCallGuard } from '../requestGuard.js';
import type { Definition } from './definitions.js';
import { McpPoolRefusedError, PoolFullError, type McpPoolLimit } from './errors.js';
import { poolKeyOf, type PoolKey } from './identityKey.js';
import type { Pool } from './pool.js';
import type { PooledClient } from './pooledClient.js';
import { UseFacts } from './record.js';
import type { Operation } from './work.js';

/** What a bound tool was listed under. */
export interface Binding {
  readonly key: PoolKey;
  /** The definitions context: `pc:<configHash>` per client, `sh:<context>` shared. */
  readonly context: string;
  readonly shared: boolean;
  /** The list it came from: an incarnation's own, or a shared entry's. */
  readonly listId: string;
  readonly generation: number;
  /** Per client: the incarnation it was listed from. */
  readonly clientId?: string;
  readonly definition: Definition;
}

/** A callable tool for `binding`, shaped as every MCP tool is. */
export function boundTool(pool: Pool, binding: Binding): Tool {
  return {
    ...mcpToolShape(pool.settings.name, binding.definition.listed),
    execute: (args, ctx) => executeBound(pool, binding, args, ctx),
  };
}

/** The five steps. */
async function executeBound(
  pool: Pool,
  binding: Binding,
  args: unknown,
  ctx: ToolExecutionContext | undefined,
): Promise<unknown> {
  const facts = new UseFacts(pool.settings.name, 'call');
  facts.keyHash = binding.key.keyHash;
  let operation: Operation | undefined;
  try {
    // 1 — the calling run's caller identity, encoded the one way.
    const caller = poolKeyOf(ctx?.identity, { requirePrincipal: false, requireTenant: false });
    if (typeof caller === 'string' || caller.key !== binding.key.key) {
      throw pool.refused('identity-mismatch');
    }
    pool.interact();
    // 2 — the binding, before anything is admitted.
    if (beforeLease(pool, binding) === 'stale') throw pool.refused('stale-tools');
    // 3 — admitted, leased, opened when the key has none; the app's names asked
    // again, so a changed authorization refuses what was listed under the old.
    operation = pool.admit('call', 'call', ctx?.signal);
    const client = await pool.leaseClient(binding.key, operation, facts);
    if (pool.refreshContext(client).context !== binding.context) {
      throw pool.refused('binding-changed');
    }
    const { inner, effective } = await toolOn(pool, binding, client, operation, facts);
    // 4 — after every wait, the binding again.
    operation.check();
    checkHolds(pool, client, effective);
    // 5 — the send gate, asked at every boundary the request crosses.
    operation.guardWith(() => checkHolds(pool, client, effective));
    operation.phase = 'call';
    const callCtx = withCallGuard(
      { ...(ctx ?? {}), signal: operation.signal } as ToolExecutionContext,
      operation,
    );
    try {
      return await inner.execute(args as Record<string, unknown>, callCtx);
    } catch (error) {
      throw classified(pool, client, operation, facts, error);
    }
  } catch (error) {
    noteRefusal(facts, error);
    throw error;
  } finally {
    operation?.finish();
    mcpClientUseOf(ctx)?.file(facts.toUse());
  }
}

/** The tool to run on `client`, and the binding the send gate checks it against. */
async function toolOn(
  pool: Pool,
  binding: Binding,
  client: PooledClient,
  operation: Operation,
  facts: UseFacts,
): Promise<{ readonly inner: Tool; readonly effective: Binding }> {
  const name = binding.definition.listed.name;
  const port = client.port;
  if (port === undefined) throw pool.refused('init-failed');
  if (binding.shared) {
    // The shared entry as it stands: a definition this client may never have
    // listed, so the tool carries its own checks (`ClientPort.bind`).
    return { inner: port.bind(binding.definition.listed), effective: binding };
  }
  if (client.clientId === binding.clientId) {
    const own = client.list.tool(name);
    if (own === undefined) throw pool.refused('stale-tools');
    return { inner: own, effective: binding };
  }
  // A replacement: its own fresh list, under the context of now, then the
  // same definition or nothing.
  const listed = await pool.ensureListed(client, operation);
  if (listed.context !== binding.context) throw pool.refused('binding-changed');
  const fresh = listed.list.definition(name);
  const own = listed.list.tool(name);
  if (
    fresh === undefined ||
    own === undefined ||
    fresh.canonical !== binding.definition.canonical
  ) {
    facts.revalidated = 'refused';
    throw pool.refused('stale-tools');
  }
  facts.revalidated = 'kept';
  return {
    inner: own,
    effective: {
      ...binding,
      clientId: client.clientId,
      listId: listed.list.id,
      generation: listed.list.generation,
    },
  };
}

/**
 * Step 2, before a lease: a shared binding against its entry; a per-client
 * binding against its incarnation when that incarnation is still the key's
 * current client. An incarnation that is gone is not stale yet — step 3 checks
 * the replacement's own list.
 */
function beforeLease(pool: Pool, binding: Binding): 'stale' | 'ok' {
  if (binding.shared) return sharedHolds(pool, binding) ? 'ok' : 'stale';
  const current = pool.clients.currentFor(binding.key.key);
  if (current === undefined || current.clientId !== binding.clientId) return 'ok';
  return listHolds(current, binding) ? 'ok' : 'stale';
}

/**
 * The binding holds on `client` — the one the call runs on: the app's names
 * still give its context, and its list has not moved. Otherwise the refusal:
 * `binding-changed` for a changed context, `stale-tools` for a moved list.
 */
function checkHolds(pool: Pool, client: PooledClient, binding: Binding): void {
  if (!pool.contextHolds(client, binding.context)) throw pool.refused('binding-changed');
  const holds = binding.shared ? sharedHolds(pool, binding) : listHolds(client, binding);
  if (!holds) throw pool.refused('stale-tools');
}

function sharedHolds(pool: Pool, binding: Binding): boolean {
  const entry = pool.shared.peek(binding.context);
  return (
    entry !== undefined &&
    entry.list.id === binding.listId &&
    entry.list.generation === binding.generation
  );
}

function listHolds(client: PooledClient, binding: Binding): boolean {
  return client.list.id === binding.listId && client.list.generation === binding.generation;
}

/**
 * What the call failed with, as the pool read it: a server's 404 for the
 * session it issued is `SessionExpiredError`; a handle this process lost is
 * `LocalSessionHandleLostError` (the transport's own object). Either way the
 * client leaves its key, and the call is not repeated. Anything else is the
 * error as it came.
 */
function classified(
  pool: Pool,
  client: PooledClient,
  operation: Operation,
  facts: UseFacts,
  error: unknown,
): unknown {
  const lost = pool.classifyFailure(client, operation, error);
  if (lost === 'expired') {
    facts.client = 'expired';
    facts.evidence = 'server-404';
    return new ServerEndedSessionError(pool.settings.name, client.clientId, error);
  }
  if (lost === 'handle-lost') {
    facts.client = 'handle-lost';
    facts.evidence = 'transport-forgot-handle';
    return error instanceof LocalSessionHandleLostError
      ? error
      : new LocalSessionHandleLostError({ cause: error });
  }
  return error;
}

/** A refusal's word on the record. */
export function noteRefusal(facts: UseFacts, error: unknown): void {
  if (error instanceof McpPoolRefusedError) {
    facts.refusal = error.reason;
  } else if (error instanceof PoolFullError) {
    facts.refusal = LIMIT_WORDS[error.limit];
  } else {
    return;
  }
  // No client was touched: the pool refused to give one.
  if (facts.clientId === undefined) facts.client = 'refused';
}

const LIMIT_WORDS: Readonly<
  Record<McpPoolLimit, 'pool-full' | 'principal-full' | 'ending-full' | 'operations-full'>
> = {
  pool: 'pool-full',
  principal: 'principal-full',
  ending: 'ending-full',
  operations: 'operations-full',
};
