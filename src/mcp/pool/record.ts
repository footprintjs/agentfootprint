/**
 * record — what the pool says about itself: one event per use in a run, and a
 * report for what happens outside one.
 *
 * Pattern: facts gathered while a use runs, filed once; reports delivered to the
 *          app's `onEvent`, which can never break the pool.
 * Role:    § 8 of the design. The record holds ids and outcomes. It never holds
 *          identity values, remote session ids or handles, header values, tool
 *          arguments, results, definitions, or a server's error text. In a run,
 *          every listing and every call files one `agentfootprint.tools.mcp_client`
 *          (`tools/mcpClientUse.ts`). Outside a run — idle ends, evictions,
 *          terminations, revoked leases, deferred ends and work that settled
 *          after its deadline — the pool reports to `onEvent`.
 *
 * Local settlement and remote resolution are different facts, reported apart:
 * an ending can settle here and stay unresolved there.
 */

import type { ToolsMcpClientPayload } from '../../events/payloads.js';
import type { McpClientUse } from '../../tools/mcpClientUse.js';
import type { McpTerminateOutcome } from '../types.js';
import type { EndReason } from './pooledClient.js';
import type { WorkKind } from './work.js';

/** What happens to a pool outside a run, as `onEvent` receives it. Ids and outcomes only. */
export interface McpPoolReport {
  /**
   * - `'ended'` — a client's ending finished, with its remote outcome;
   * - `'deferred'` — a client to be ended stays in the open set, still counted,
   *   until an ending slot and an operation slot free (or its lease ends);
   * - `'lease-revoked'` — an app lease ran past `maxLeaseMs`;
   * - `'settled-late'` — work whose caller was already answered has settled,
   *   and its charge is released.
   */
  readonly kind: 'ended' | 'deferred' | 'lease-revoked' | 'settled-late';
  /** The pool's name. */
  readonly server: string;
  /** The pool's own random id for the client, when one is concerned. */
  readonly clientId?: string;
  /** The tool-session digest of the conversation's key, when one is concerned. */
  readonly keyHash?: string;
  /** Why the client ended, or is to end. */
  readonly reason?: EndReason;
  /** `'ended'`: what the remote side answered (`McpTerminateOutcome.remote`). */
  readonly remote?: McpTerminateOutcome['remote'];
  /** `'ended'`: whether the remote ending was confirmed. */
  readonly resolved?: boolean;
  /** `'ended'`: the HTTP status the remote side answered with, when one was read. */
  readonly status?: number;
  /** `'ended'`: a failure's class name, never its message. */
  readonly errorClass?: string;
  /** `'settled-late'`: what the work was doing. */
  readonly work?: WorkKind;
  /** `'ended'`: how long the caller waited; `'settled-late'`: how long it ran past its answer. */
  readonly durationMs: number;
}

/** Delivers reports to the app; a throwing handler is swallowed and changes nothing. */
export class Reporter {
  constructor(
    private readonly server: string,
    private readonly onEvent: ((report: McpPoolReport) => void) | undefined,
  ) {}

  report(report: Omit<McpPoolReport, 'server'>): void {
    if (this.onEvent === undefined) return;
    try {
      this.onEvent({ server: this.server, ...report });
    } catch {
      // The app's handler is not the pool's work: it changes nothing.
    }
  }
}

/** The facts one pool use gathers while it runs, filed once when it settles. */
export class UseFacts {
  keyHash: string | undefined;
  clientId: string | undefined;
  generation: number | undefined;
  client: ToolsMcpClientPayload['client'] = 'refused';
  previous: ToolsMcpClientPayload['previous'];
  evidence: ToolsMcpClientPayload['evidence'];
  refusal: ToolsMcpClientPayload['refusal'];
  initMs: number | undefined;
  definitions: ToolsMcpClientPayload['definitions'];
  definitionsAgeMs: number | undefined;
  revalidated: ToolsMcpClientPayload['revalidated'];

  constructor(private readonly server: string, private readonly at: ToolsMcpClientPayload['at']) {}

  /** The use, as `tools/mcpClientUse.ts` files it. */
  toUse(): McpClientUse {
    return {
      server: this.server,
      at: this.at,
      client: this.client,
      ...(this.keyHash !== undefined && { keyHash: this.keyHash }),
      ...(this.clientId !== undefined && { clientId: this.clientId }),
      ...(this.generation !== undefined && { generation: this.generation }),
      ...(this.previous !== undefined && { previous: this.previous }),
      ...(this.evidence !== undefined && { evidence: this.evidence }),
      ...(this.refusal !== undefined && { refusal: this.refusal }),
      ...(this.initMs !== undefined && { initMs: this.initMs }),
      ...(this.definitions !== undefined && { definitions: this.definitions }),
      ...(this.definitionsAgeMs !== undefined && { definitionsAgeMs: this.definitionsAgeMs }),
      ...(this.revalidated !== undefined && { revalidated: this.revalidated }),
    };
  }
}
