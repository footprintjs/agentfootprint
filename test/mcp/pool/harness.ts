/**
 * Shared plumbing for the MCP client pool's tests.
 */

import type { CredentialProvider, CredentialRequest } from '../../../src/identity/types.js';
import { bearer } from '../../../src/identity/kinds.js';
import { mcpClientPool, type McpClientPoolOptions } from '../../../src/tool-providers/index.js';
import type { McpPoolIdentity } from '../../../src/mcp/pool/options.js';
import type { McpPoolReport } from '../../../src/mcp/pool/record.js';
import type { ToolExecutionContext } from '../../../src/tools/tools.js';
import { MCP_CLIENT_USE, type McpClientUse } from '../../../src/tools/mcpClientUse.js';
import type { FakeEndpoint } from './fakeEndpoint.js';

/** An identity: principal, conversation, and a tenant when given. */
export function id(principal: string, conversationId: string, tenant?: string): McpPoolIdentity {
  return {
    conversationId,
    ...(tenant !== undefined && { tenant }),
    ...(principal !== '' && { principal }),
  };
}

/**
 * A tool call's context, as the dispatch loop builds one for a run that named
 * `identity` — with the call's record port, whose filings land in `uses`.
 */
export function callCtx(
  identity: McpPoolIdentity | undefined,
  signal?: AbortSignal,
  uses?: McpClientUse[],
): ToolExecutionContext {
  return {
    ...(identity !== undefined && { identity }),
    ...(signal !== undefined && { signal }),
    ...(uses !== undefined && {
      [MCP_CLIENT_USE]: { file: (use: McpClientUse) => uses.push(use) },
    }),
  } as unknown as ToolExecutionContext;
}

/** A pool over `endpoint`, one plain HTTP transport per client, reports collected. */
export function poolOver(
  endpoint: FakeEndpoint,
  options: Partial<McpClientPoolOptions> = {},
): { readonly pool: ReturnType<typeof mcpClientPool>; readonly reports: McpPoolReport[] } {
  const reports: McpPoolReport[] = [];
  const pool = mcpClientPool({
    name: 'orders',
    transport: () => ({ transport: 'http', url: endpoint.url, fetch: endpoint.fetch }),
    onEvent: (report) => reports.push(report),
    ...options,
  });
  return { pool, reports };
}

/**
 * A credential provider that vends at once, until told to stall: then every vend
 * waits until released — and IGNORES the signal it is handed, as a provider
 * that does its own slow I/O might.
 */
export function stallingProvider(): {
  readonly provider: CredentialProvider;
  stall(): void;
  /** Vends waiting. */
  readonly waiting: number;
  /** Vends asked for, in all. */
  readonly asked: number;
  /** Signals the waiting vends were handed. */
  readonly signals: readonly (AbortSignal | undefined)[];
  /** Release every waiting vend (and stop stalling). */
  releaseAll(): void;
  /** Release the oldest waiting vend. */
  releaseOne(): void;
} {
  let stalling = false;
  let asked = 0;
  const waiters: Array<() => void> = [];
  const signals: (AbortSignal | undefined)[] = [];
  const provider: CredentialProvider = {
    id: 'vault',
    async getCredential(request: CredentialRequest) {
      asked += 1;
      if (stalling) {
        signals.push(request.signal);
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      return { status: 'issued', credential: bearer('t-1') };
    },
  };
  return {
    provider,
    stall: () => {
      stalling = true;
    },
    get waiting() {
      return waiters.length;
    },
    get asked() {
      return asked;
    },
    signals,
    releaseAll: () => {
      stalling = false;
      for (const release of waiters.splice(0)) release();
    },
    releaseOne: () => {
      waiters.shift()?.();
    },
  };
}

/** Let pending promise work run: a few macrotask turns. */
export async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Every string a pool use produced, joined — for canary checks. */
export function everything(...values: unknown[]): string {
  return values
    .map((value) =>
      value instanceof Error
        ? `${value.name} ${value.message} ${JSON.stringify(value)}`
        : JSON.stringify(value),
    )
    .join('\n');
}
