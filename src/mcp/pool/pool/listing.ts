/** Listing and invalidation against the pool's authoritative owners. */

import { untilAborted } from '../../../lib/abort.js';
import { encodeIdentityField } from '../../../memory/identity/encode.js';
import type { Tool } from '../../../tools/tools.js';
import type { ClientSet } from '../clientSet.js';
import { definitionOf, type Definition, type SharedDefinitions } from '../definitions.js';
import type { McpPoolRefusedError } from '../errors.js';
import { scopeMatcher } from '../identityKey.js';
import { MAX_SHARED_TOOLS, type PoolSettings } from '../options.js';
import { contextFor } from '../plan.js';
import type { PooledClient } from '../pooledClient.js';
import { Work, type Operation } from '../work.js';
import type { RequestEvidenceOutcome, ServedList } from './contracts.js';
import { isContextMoved } from './refusals.js';

/** Actual pool owners and callbacks needed to serve and invalidate definitions. */
export interface ListingHost {
  readonly clients: ClientSet;
  readonly shared: SharedDefinitions;
  readonly settings: PoolSettings;
  readonly signal: AbortSignal;
  now(): number;
  refused(reason: McpPoolRefusedError['reason'], cause?: unknown): McpPoolRefusedError;
  classifyFailure(client: PooledClient, work: Work, error: unknown): RequestEvidenceOutcome;
}

export class PoolListing {
  constructor(private readonly host: ListingHost) {}

  // ─── Lists ─────────────────────────────────────────────────────────

  /** Where `client`'s definitions are served from: its shared entry, or its own list. */
  servedListOf(client: PooledClient): ServedList {
    const { context, shared } = client.definitions;
    if (shared) {
      return {
        list: this.host.shared.entryFor(context, client.key.tenant).list,
        shared: true,
        context,
      };
    }
    return { list: client.list, shared: false, context };
  }

  /**
   * The definitions context `client` serves under NOW: the app's `share` asked
   * again over the client's own configuration. A changed answer moves the
   * client to the new context and stops serving its own list, so every tool
   * bound under the old one is refused before it is sent.
   *
   * @throws `binding-changed`, `share`'s error as its cause, when the answer
   *   cannot be had — never the old context
   */
  refreshContext(client: PooledClient): PooledClient['definitions'] {
    if (this.host.settings.share === undefined) return client.definitions;
    let now: PooledClient['definitions'];
    try {
      now = contextFor(this.host.settings, client.key, client.plan.configHash);
    } catch (cause) {
      throw this.host.refused('binding-changed', cause);
    }
    if (now.context !== client.definitions.context) {
      client.definitions = now;
      client.list.invalidate();
    }
    return now;
  }

  /** Does `context` still name the definitions context `client` serves under? False when it cannot be had. */
  contextHolds(client: PooledClient, context: string): boolean {
    try {
      return this.refreshContext(client).context === context;
    } catch {
      return false;
    }
  }

  /**
   * The list `client` serves under NOW, listed again on it when it cannot be
   * served as it stands — one listing at a time per list; a second caller joins
   * it inside its own slot. Every attempt asks the app's names again
   * (`refreshContext`), so a listing that a moved context discarded or refused
   * at its send is listed once more under the context of now, never written
   * into the one it began under. A listing raced by an invalidation is
   * discarded too. Refused (`stale-tools`) when three attempts serve nothing.
   * What it returns was checked against the context with no wait since.
   */
  async ensureListed(client: PooledClient, operation: Operation): Promise<ServedList> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const served = this.servableNow(client);
      if (served.ready !== undefined) return served.ready;
      const { list } = served.wanted;
      if (list.listing === undefined) this.startListing(client, served.wanted, operation);
      operation.phase = 'listing';
      try {
        await untilAborted(list.listing as Promise<void>, operation.signal);
      } catch (error) {
        operation.check();
        // Refused at its send because the context moved: asked again next round.
        if (!isContextMoved(error)) throw error;
      }
      operation.check();
    }
    const served = this.servableNow(client);
    if (served.ready !== undefined) return served.ready;
    throw this.host.refused('stale-tools');
  }

  /**
   * What `client` can serve under the context of now — asked of the app's names
   * here — or, when nothing can, the list it should list. Too long to share:
   * the conversation's own client keeps that list, under the same context.
   */
  private servableNow(client: PooledClient): {
    readonly ready?: ServedList;
    readonly wanted: ServedList;
  } {
    this.refreshContext(client);
    const wanted = this.servedListOf(client);
    const now = this.host.now();
    const ttl = this.host.settings.definitionTtlMs;
    if (wanted.list.servable(now, ttl)) return { ready: wanted, wanted };
    // A context change invalidates the client's own list, so a servable one
    // was written under the context of now.
    if (wanted.shared && client.list.servable(now, ttl)) {
      return { ready: { list: client.list, shared: false, context: wanted.context }, wanted };
    }
    return { wanted };
  }

  /**
   * One listing on `client` for `served`'s context. Its requests are sent only
   * while that context holds — asked at every boundary they cross — and its
   * answer is written only if the context still holds when it arrives and the
   * list's generation held: an answer the app's names moved under belongs to
   * no context, and is dropped.
   */
  private startListing(client: PooledClient, served: ServedList, operation: Operation): void {
    const { list } = served;
    const began = list.generation;
    const beganOwn = client.list.generation;
    const work = new Work('listing', [this.host.signal]);
    work.guardWith(() => {
      if (!this.contextHolds(client, served.context)) throw this.host.refused('binding-changed');
    });
    operation.track(work.whenSettled());
    const port = client.port;
    if (port === undefined) throw this.host.refused('init-failed');
    client.phase = work;
    const pending = port.listing(work.signal);
    work.track(pending);
    list.listing = pending
      .then((listing) => {
        // Asked again before anything is kept: listed under one context,
        // answered under another, it is no one's.
        if (!this.contextHolds(client, served.context)) return;
        const definitions = listing.listed
          .map((listed) => definitionOf(listed))
          .filter((d): d is Definition => d !== undefined);
        if (served.shared && definitions.length > MAX_SHARED_TOOLS) {
          // Used by its own client, never shared.
          client.list.write(beganOwn, definitions, listing.tools, this.host.now());
          return;
        }
        list.write(began, definitions, served.shared ? undefined : listing.tools, this.host.now());
      })
      .catch((error: unknown) => {
        this.host.classifyFailure(client, work, error);
        throw error;
      })
      .finally(() => {
        list.listing = undefined;
        if (client.phase === work) client.phase = undefined;
        work.finish();
      });
    list.listing.catch(() => undefined);
  }

  // ─── Invalidation ──────────────────────────────────────────────────

  /** The server said a client's tool list changed: that client's list and its shared entry. */
  toolsChangedOn(client: PooledClient): void {
    client.list.invalidate();
    const { context, shared } = client.definitions;
    if (shared) this.host.shared.peek(context)?.list.invalidate();
  }

  /** The app's permission signal: every list in the scope. */
  permissionsChanged(scope: { readonly tenant?: string; readonly principal?: string }): void {
    const matches = scopeMatcher({
      ...(scope.tenant !== undefined && { tenant: scope.tenant }),
      ...(scope.principal !== undefined && { principal: scope.principal }),
    });
    for (const client of this.host.clients.openClients()) {
      if (matches(client.key)) client.list.invalidate();
    }
    // A shared entry is used across the tenant's principals: any of them changing invalidates it.
    const tenant = encodeIdentityField(scope.tenant);
    this.host.shared.invalidate((entry) => entry.tenant === tenant);
  }

  /** The server changed: every list. */
  toolsChanged(): void {
    for (const client of this.host.clients.openClients()) client.list.invalidate();
    this.host.shared.invalidate(() => true);
  }

  /** The bound shape of every definition in `served`, for a client of `key`. */
  definitionsOf(served: ServedList): readonly Definition[] {
    return served.list.all();
  }

  /** The tools a list's client-own entries carry, by name (per-client lists only). */
  ownTool(served: ServedList, name: string): Tool | undefined {
    return served.shared ? undefined : served.list.tool(name);
  }
}
