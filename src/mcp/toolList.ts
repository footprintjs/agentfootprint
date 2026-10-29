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
 * page in the SDK's trailing options, and once it has fired no further page is
 * asked for (`lib/abort.ts`): an abort is the caller's word, so it wins over an
 * incomplete list.
 */

import { throwIfAborted } from '../lib/abort.js';
import type { Tool } from '../tools/tools.js';
import type { McpConnection, McpListedTool } from './types.js';

/**
 * The most `tools/list` pages one listing reads. A catalogue past it is far
 * more than a model can choose from; a server that keeps paging past it is
 * reported as incomplete rather than read without end.
 */
export const MAX_TOOL_LIST_PAGES = 100;

/** Why a server's tool list could not be read to its end. */
export type McpToolListIncompleteReason = 'page-limit' | 'cursor-repeated';

/** What a listing read: every tool its pages held, how many pages, and whether it ended. */
export interface ToolListing {
  readonly tools: readonly McpListedTool[];
  readonly pages: number;
  /** Absent when the server's list ended: the last page carried no cursor. */
  readonly incomplete?: McpToolListIncompleteReason;
}

/**
 * Read the server's tool list, page by page, until a page carries no cursor —
 * or until it cannot be finished, which the result says (`incomplete`).
 *
 * @throws the abort, once `signal` has fired and another page was due; and
 *   whatever the connection rejects a page with, as it always did
 */
export async function listEveryPage(
  connection: McpConnection,
  signal: AbortSignal | undefined,
): Promise<ToolListing> {
  const tools: McpListedTool[] = [];
  const sent = new Set<string>();
  let cursor: string | undefined;
  for (let pages = 1; ; pages++) {
    const page = await askPage(connection, cursor, signal);
    // One push per tool: spreading a very large page into `push` can overflow the stack.
    for (const tool of page.tools) tools.push(tool);
    const next = page.nextCursor;
    if (next === undefined || next === null) return { tools, pages };
    throwIfAborted(signal);
    if (sent.has(next)) return { tools, pages, incomplete: 'cursor-repeated' };
    if (pages >= MAX_TOOL_LIST_PAGES) return { tools, pages, incomplete: 'page-limit' };
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
