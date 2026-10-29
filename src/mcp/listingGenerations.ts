/**
 * listingGenerations — which `tools/list` answer the MCP SDK's `Client` holds
 * its per-tool call checks for, as far as one connection can tell.
 *
 * Pattern: a count of the list requests one connection sent and settled.
 * Role:    The SDK's `Client` keeps its per-tool call checks (`callChecks.ts`)
 *          for the tools of the last `tools/list` answer it received: every
 *          answer replaces them. A request that FAILED can replace them too: the
 *          SDK caches an answer before it returns it, and caching can throw after
 *          the old checks are cleared (1.32: an `outputSchema` its validator
 *          cannot compile). The library cannot see inside the SDK, but it sends
 *          every list request it makes. So it counts them:
 *
 *   - a request is OUT from the moment it is sent until it settles, because the
 *     SDK replaces its checks before the library sees the answer;
 *   - each request that settles, answered or failed, starts a new GENERATION.
 *
 * The SDK holds the checks of a listing's one answer only while the generation
 * that answer settled at is the latest and no request is out. The SDK keeps one
 * set of checks per client, so there is one count per connection object: every
 * `mcpClient` over the same client shares it (`listingsOf`). A `tools/list`
 * request the library did not send — your own code calling `listTools` on a
 * client passed as `connection` — is not counted: the library cannot see it.
 */

/** One settled `tools/list` request's answer, and the generation it settled at. */
export interface SettledListing<T> {
  readonly answer: T;
  readonly generation: number;
}

/** The `tools/list` requests one connection has out, and the generations they settled at. */
export class ListingGenerations {
  private settled = 0;
  private out = 0;

  /**
   * Send one `tools/list` request with `send`, counted as out from the moment it
   * is sent until it settles. Settling starts a new generation, answered or not.
   *
   * @throws whatever `send` rejects with, as it rejected
   */
  async ask<T>(send: () => Promise<T>): Promise<SettledListing<T>> {
    this.out += 1;
    try {
      const answer = await send();
      return { answer, generation: this.settle() };
    } catch (error) {
      this.settle();
      throw error;
    }
  }

  /** True while `generation` is the latest settled one and no request is out. */
  isLatest(generation: number): boolean {
    return this.out === 0 && this.settled === generation;
  }

  private settle(): number {
    this.out -= 1;
    this.settled += 1;
    return this.settled;
  }
}

/** One count per connection object, held only as long as the connection is. */
const BY_CONNECTION = new WeakMap<object, ListingGenerations>();

/**
 * The count for `connection`: the same one for every `mcpClient` that adapts
 * the same client, because the SDK keeps one set of checks per client and a
 * listing by any of them replaces it.
 */
export function listingsOf(connection: object): ListingGenerations {
  let listings = BY_CONNECTION.get(connection);
  if (listings === undefined) {
    listings = new ListingGenerations();
    BY_CONNECTION.set(connection, listings);
  }
  return listings;
}
