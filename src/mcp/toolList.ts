/**
 * toolList — every page of a server's `tools/list` answer, or a typed refusal
 * that says the list is incomplete.
 *
 * Pattern: one bounded loop + one typed refusal.
 * Role:    MCP pages a tool list: a page carries `nextCursor` while the server
 *          has more, and the next page is asked for with `{ cursor }`. Reading
 *          only the first page cut a paginating server's catalogue short in
 *          silence — the agent saw part of it and nothing said so. This reads
 *          until the server sends no cursor, within a bound, and when it cannot
 *          finish the list it says why:
 *
 *   - `'page-limit'` — the list did not end within {@link MAX_TOOL_LIST_PAGES}
 *     pages;
 *   - `'cursor-repeated'` — a page named a cursor this listing already sent, so
 *     following it would loop.
 *
 * The first page is asked exactly as before pagination was followed: no params
 * (and, with no signal, no arguments at all). The client's signal rides every
 * page in the SDK's trailing options, and it is checked immediately before each
 * page is asked for and again when each answer arrives (`lib/abort.ts`): once
 * it has fired, nothing more is asked for and no page is accepted, the last one
 * included. An abort is the caller's word, so it wins over an incomplete list.
 * What it cannot do is settle a page a connection that ignores the signal is
 * still holding: that promise settles when the connection says.
 */

import { throwIfAborted } from '../lib/abort.js';
import type { Tool } from '../tools/tools.js';
import type { McpConnection, McpListedTool } from './types.js';

/**
 * The most `tools/list` requests one listing sends. A bound on REQUESTS, not on
 * the catalogue's size: a page may hold any number of tools. A server that
 * keeps paging past it is reported as incomplete rather than read without end.
 */
export const MAX_TOOL_LIST_PAGES = 100;

/** Why a server's tool list could not be read to its end. */
export type McpToolListIncompleteReason = 'page-limit' | 'cursor-repeated';

/** What a listing read: every tool its pages held, how many pages, and whether it ended. */
export interface ToolListing {
  readonly tools: readonly McpListedTool[];
  readonly pages: number;
  /**
   * Where the last page read begins in `tools`: everything before it came from
   * an earlier page. 0 for a one-page list. The MCP SDK's `Client` keeps its
   * per-tool checks for the last page only (`callChecks.ts`).
   */
  readonly lastPageStart: number;
  /** Absent when the server's list ended: the last page carried no cursor. */
  readonly incomplete?: McpToolListIncompleteReason;
}

/**
 * Read the server's tool list, page by page, until a page carries no cursor —
 * or until it cannot be finished, which the result says (`incomplete`).
 *
 * @throws the abort, when `signal` has fired before a page is asked for or by
 *   the time its answer arrives; and whatever the connection rejects a page
 *   with, as it always did
 */
export async function listEveryPage(
  connection: McpConnection,
  signal: AbortSignal | undefined,
): Promise<ToolListing> {
  const tools: McpListedTool[] = [];
  const sent = new Set<string>();
  let cursor: string | undefined;
  let lastPageStart = 0;
  for (let pages = 1; ; pages++) {
    // Immediately before EVERY request, the first included: an aborted listing
    // asks for nothing more (`lib/abort.ts`).
    throwIfAborted(signal);
    const page = await askPage(connection, cursor, signal);
    // And after EVERY answer, before it is accepted: a page that lands after
    // the abort — the last page too — is never part of a listing, so nothing
    // incomplete is returned and nothing complete is cached.
    throwIfAborted(signal);
    lastPageStart = tools.length;
    // One push per tool: spreading a very large page into `push` can overflow the stack.
    for (const tool of page.tools) tools.push(tool);
    const next = page.nextCursor;
    if (next === undefined || next === null) return { tools, pages, lastPageStart };
    if (sent.has(next)) return { tools, pages, lastPageStart, incomplete: 'cursor-repeated' };
    if (pages >= MAX_TOOL_LIST_PAGES) {
      return { tools, pages, lastPageStart, incomplete: 'page-limit' };
    }
    sent.add(next);
    cursor = next;
  }
}

/**
 * One page. The first carries no params — with no signal, no arguments at all —
 * which is the request a one-page server always got; a later page carries
 * `{ cursor }`. The signal rides the trailing options, never the params.
 */
function askPage(
  connection: McpConnection,
  cursor: string | undefined,
  signal: AbortSignal | undefined,
): ReturnType<McpConnection['listTools']> {
  const params = cursor === undefined ? undefined : { cursor };
  if (signal !== undefined) return connection.listTools(params, { signal });
  return params === undefined ? connection.listTools() : connection.listTools(params);
}

/** The fixed sentence each reason reads as. Never a cursor: that is the server's data. */
const BECAUSE: Readonly<Record<McpToolListIncompleteReason, (pages: number) => string>> = {
  'page-limit': (pages) => `the list did not end within ${pages} pages`,
  'cursor-repeated': (pages) =>
    `page ${pages} named a cursor this listing had already sent, so following it would loop`,
};

/**
 * A server's tool list that could not be read to its end. `tools()` and
 * `refresh()` reject with it rather than return a list cut short: an agent
 * handed part of a catalogue cannot know what it was not offered.
 *
 * `tools` holds what WAS listed — wrapped and callable, exactly as `tools()`
 * would have returned them — for a caller that decides to use an incomplete
 * list knowingly. Names the server, the reason and the count, never a cursor.
 */
export class McpToolListIncompleteError extends Error {
  readonly code = 'ERR_MCP_TOOL_LIST_INCOMPLETE' as const;

  constructor(
    readonly reason: McpToolListIncompleteReason,
    readonly server: string,
    /** The pages read before the listing stopped. */
    readonly pages: number,
    /** The tools those pages listed, in page order. */
    readonly tools: readonly Tool[],
  ) {
    super(
      `mcpClient[${server}]: the server's tool list is incomplete — ${BECAUSE[reason](pages)}. ` +
        `No tools were returned; the ${tools.length} listed before it stopped are on this ` +
        "error's `tools`, for a caller that chooses to use an incomplete list.",
    );
    this.name = 'McpToolListIncompleteError';
  }
}
