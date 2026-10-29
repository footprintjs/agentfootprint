/**
 * `tools/list` pagination — every page is read, and a list that cannot be
 * finished says so (L-33).
 *
 * MCP pages a tool list: a page carries `nextCursor` when the server has more,
 * and the client asks for the next page with `{ cursor }`. `mcpClient` used to
 * read the first page only, so a paginating server's catalogue was cut short
 * in silence. These tests pin the law that replaced it:
 *
 *   1. every page is read, in order, until the server sends no cursor;
 *   2. at most 100 pages: a list that does not end there is refused as
 *      incomplete (`'page-limit'`), never returned cut short;
 *   3. a cursor the server already sent is refused as incomplete
 *      (`'cursor-repeated'`), never followed into a loop;
 *   4. the client's `signal` rides every page, and no page is asked for once
 *      it has fired;
 *   5. a server that answers in one page gets the request it always got.
 *
 * Fast path: hand-written connections, through both the `connection` arm and
 * the `_client` seam. Truth path: a real SDK server over HTTP, at the bottom.
 */

import { createServer, type Server as HttpServer } from 'node:http';

import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { disableDevMode, enableDevMode } from 'footprintjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpToolListIncompleteError, mcpClient } from '../../src/tool-providers/index.js';
import type { McpConnection, McpListedTool, McpSdkClient } from '../../src/mcp/types.js';
import { REAL_TRANSPORT_TIMEOUT, freePort } from './realTransportSupport.js';

// ─── A paginating connection, by hand ─────────────────────────────

/** One listed tool, named. */
const toolNamed = (name: string): McpListedTool => ({
  name,
  description: `tool ${name}`,
  inputSchema: { type: 'object' },
});

interface Page {
  readonly tools: readonly McpListedTool[];
  readonly nextCursor?: string;
}

/**
 * A connection whose `listTools` answers from `pageFor(cursor)` — the cursor
 * the client sent, `undefined` for the first page — and records every call's
 * arguments exactly as they arrived.
 */
function pagingConnection(pageFor: (cursor: string | undefined) => Page | Promise<Page>): {
  readonly connection: McpSdkClient;
  readonly calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const connection: McpSdkClient = {
    connect: async () => undefined,
    listTools: async (...args: unknown[]) => {
      calls.push(args);
      const params = args[0] as { cursor?: string } | undefined;
      return pageFor(params?.cursor);
    },
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    close: async () => undefined,
  } as McpSdkClient;
  return { connection, calls };
}

/** Pages `p1 → p2 → p3`, two tools each; the last carries no cursor. */
const THREE_PAGES: Readonly<Record<string, Page>> = {
  start: { tools: [toolNamed('a1'), toolNamed('a2')], nextCursor: 'p2' },
  p2: { tools: [toolNamed('b1'), toolNamed('b2')], nextCursor: 'p3' },
  p3: { tools: [toolNamed('c1'), toolNamed('c2')] },
};
const threePages = (cursor: string | undefined): Page => THREE_PAGES[cursor ?? 'start']!;

const names = (tools: readonly { schema: { name: string } }[]): string[] =>
  tools.map((t) => t.schema.name);

/** The rejection `promise` settles with, or a failure if it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the listing to reject, and it resolved');
}

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

// ─── 1. Every page ────────────────────────────────────────────────

describe('tools/list pagination — every page is read', () => {
  it('a multi-page server lists every tool, in page order (the `_client` seam)', async () => {
    const { connection, calls } = pagingConnection(threePages);
    const client = await mcpClient({
      name: 'paged',
      transport: { transport: 'stdio', command: 'unused' },
      _client: connection,
    });

    expect(names(await client.tools())).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
    // Page one is asked with no arguments at all; each later page with the
    // cursor the previous page sent, as `{ cursor }`.
    expect(calls).toEqual([[], [{ cursor: 'p2' }], [{ cursor: 'p3' }]]);
  });

  it('the `connection` arm reads every page too', async () => {
    const { connection, calls } = pagingConnection(threePages);
    const client = await mcpClient({ name: 'paged', connection: connection as McpConnection });

    expect(names(await client.tools())).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
    expect(calls).toHaveLength(3);
  });

  it('every page of the listing is cached, and refresh() reads every page again', async () => {
    const { connection, calls } = pagingConnection(threePages);
    const client = await mcpClient({ name: 'paged', connection: connection as McpConnection });

    await client.tools();
    await client.tools();
    expect(calls).toHaveLength(3);
    expect(names(await client.refresh())).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
    expect(calls).toHaveLength(6);
  });

  it('a tool listed on a later page is callable, through the same connection', async () => {
    const { connection } = pagingConnection(threePages);
    const client = await mcpClient({ name: 'paged', connection: connection as McpConnection });

    const c2 = (await client.tools()).find((t) => t.schema.name === 'c2')!;
    expect(await c2.execute({ q: 1 })).toBe('ok');
    expect((connection.callTool as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      name: 'c2',
      arguments: { q: 1 },
    });
  });

  it('a replay entry for a tool listed on a later page is not reported as unlisted', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connection } = pagingConnection(threePages);
    const client = await mcpClient({
      name: 'paged',
      transport: { transport: 'stdio', command: 'unused' },
      _client: connection,
      replay: { tools: { c1: { on: ['throttle'] } } },
    });

    await client.tools();
    const unlisted = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('c1'));
    expect(unlisted).toEqual([]);
  });
});

// ─── 2. The page bound ────────────────────────────────────────────

describe('tools/list pagination — the bound is 100 pages, and hitting it is said', () => {
  /** A server whose list never ends: every page names a fresh cursor and one tool. */
  const endless = (cursor: string | undefined): Page => {
    const n = cursor === undefined ? 1 : Number(cursor.slice('page-'.length));
    return { tools: [toolNamed(`t${n}`)], nextCursor: `page-${n + 1}` };
  };

  it('asks for exactly 100 pages, then rejects with a typed incomplete marker', async () => {
    const { connection, calls } = pagingConnection(endless);
    const client = await mcpClient({ name: 'catalog', connection: connection as McpConnection });

    const error = await rejectionOf(client.tools());

    expect(calls).toHaveLength(100);
    expect(error).toBeInstanceOf(McpToolListIncompleteError);
    expect(error).toMatchObject({
      name: 'McpToolListIncompleteError',
      code: 'ERR_MCP_TOOL_LIST_INCOMPLETE',
      reason: 'page-limit',
      server: 'catalog',
      pages: 100,
    });
    const incomplete = error as McpToolListIncompleteError;
    // What WAS listed travels on the error, wrapped and callable, for a caller
    // that chooses to use an incomplete list. `tools()` never returns it.
    expect(incomplete.tools).toHaveLength(100);
    expect(names(incomplete.tools).slice(0, 2)).toEqual(['t1', 't2']);
    expect(incomplete.tools[99]!.source).toBe('catalog');
    expect(incomplete.message).toMatch(/mcpClient\[catalog\]/);
    expect(incomplete.message).toMatch(/100 pages/);
    expect(incomplete.message).toMatch(/incomplete/);
    // The cursor is the server's data, never the library's words.
    expect(incomplete.message).not.toMatch(/page-101/);
  });

  it('a list that ends on page 100 exactly is complete', async () => {
    const { connection, calls } = pagingConnection((cursor) => {
      const page = endless(cursor);
      return page.nextCursor === 'page-101' ? { tools: page.tools } : page;
    });
    const client = await mcpClient({ name: 'catalog', connection: connection as McpConnection });

    expect(await client.tools()).toHaveLength(100);
    expect(calls).toHaveLength(100);
  });

  it('an incomplete listing is never cached: the next call reads again', async () => {
    const { connection, calls } = pagingConnection(endless);
    const client = await mcpClient({ name: 'catalog', connection: connection as McpConnection });

    await expect(client.tools()).rejects.toBeInstanceOf(McpToolListIncompleteError);
    await expect(client.tools()).rejects.toBeInstanceOf(McpToolListIncompleteError);
    expect(calls).toHaveLength(200);
  });

  it('refresh() reports it the same way', async () => {
    const { connection } = pagingConnection(endless);
    const client = await mcpClient({ name: 'catalog', connection: connection as McpConnection });

    await expect(client.refresh()).rejects.toMatchObject({ reason: 'page-limit', pages: 100 });
  });

  it('an incomplete list warns about no replay entry: what it did not read, it cannot judge', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connection } = pagingConnection(endless);
    const client = await mcpClient({
      name: 'catalog',
      transport: { transport: 'stdio', command: 'unused' },
      _client: connection,
      replay: { tools: { t250: { on: ['throttle'] } } },
    });

    await expect(client.tools()).rejects.toBeInstanceOf(McpToolListIncompleteError);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('t250'))).toEqual([]);
  });
});

// ─── 3. A repeated cursor ─────────────────────────────────────────

describe('tools/list pagination — a cursor sent twice is refused, never followed', () => {
  it('a cycle (a → b → a) stops before the repeat, as incomplete', async () => {
    const pages: Readonly<Record<string, Page>> = {
      start: { tools: [toolNamed('one')], nextCursor: 'a' },
      a: { tools: [toolNamed('two')], nextCursor: 'b' },
      b: { tools: [toolNamed('three')], nextCursor: 'a' },
    };
    const { connection, calls } = pagingConnection((cursor) => pages[cursor ?? 'start']!);
    const client = await mcpClient({ name: 'loopy', connection: connection as McpConnection });

    const error = await rejectionOf(client.tools());

    expect(calls).toEqual([[], [{ cursor: 'a' }], [{ cursor: 'b' }]]);
    expect(error).toBeInstanceOf(McpToolListIncompleteError);
    expect(error).toMatchObject({ reason: 'cursor-repeated', server: 'loopy', pages: 3 });
    expect(names((error as McpToolListIncompleteError).tools)).toEqual(['one', 'two', 'three']);
    expect((error as Error).message).toMatch(/mcpClient\[loopy\]/);
    expect((error as Error).message).not.toMatch(/'a'|"a"/);
  });

  it('a page that names its own cursor again is refused after one repeat ask', async () => {
    const { connection, calls } = pagingConnection((cursor) =>
      cursor === undefined
        ? { tools: [toolNamed('first')], nextCursor: 'same' }
        : { tools: [toolNamed('again')], nextCursor: 'same' },
    );
    const client = await mcpClient({ name: 'stuck', connection: connection as McpConnection });

    await expect(client.tools()).rejects.toMatchObject({ reason: 'cursor-repeated', pages: 2 });
    expect(calls).toHaveLength(2);
  });

  it('a connection that ignores the cursor and serves page one again is refused, not looped', async () => {
    // `listTools: () => sdk.listTools()` — a wrapper that drops the params.
    const { connection, calls } = pagingConnection(() => ({
      tools: [toolNamed('only')],
      nextCursor: 'more',
    }));
    const client = await mcpClient({ name: 'deaf', connection: connection as McpConnection });

    await expect(client.tools()).rejects.toMatchObject({ reason: 'cursor-repeated', pages: 2 });
    expect(calls).toHaveLength(2);
  });
});

// ─── 4. The signal, across pages ──────────────────────────────────

describe('tools/list pagination — the signal rides every page', () => {
  it('every page carries the signal in the trailing options argument', async () => {
    const controller = new AbortController();
    const { connection, calls } = pagingConnection(threePages);
    const client = await mcpClient({
      name: 'paged',
      connection: connection as McpConnection,
      signal: controller.signal,
    });

    await client.tools();
    const signal = controller.signal;
    expect(calls).toEqual([
      [undefined, { signal }],
      [{ cursor: 'p2' }, { signal }],
      [{ cursor: 'p3' }, { signal }],
    ]);
  });

  it('an abort while a page is in flight ends the listing with the abort (the SDK honours it)', async () => {
    const controller = new AbortController();
    const reason = new Error('the caller gave up');
    const { connection, calls } = pagingConnection((cursor) => {
      if (cursor === undefined) return { tools: [toolNamed('a')], nextCursor: 'p2' };
      // Page two waits for the abort and rejects with its reason, as the SDK does.
      return new Promise<Page>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason));
        queueMicrotask(() => controller.abort(reason));
      });
    });
    const client = await mcpClient({
      name: 'paged',
      connection: connection as McpConnection,
      signal: controller.signal,
    });

    expect(await rejectionOf(client.tools())).toBe(reason);
    expect(calls).toHaveLength(2);
  });

  it('a connection that ignores the signal: no further page is asked for once it fires', async () => {
    const controller = new AbortController();
    const reason = new Error('stop listing');
    const { connection, calls } = pagingConnection((cursor) => {
      // Page two "arrives" after the abort; this connection never looked at it.
      if (cursor === 'p2') controller.abort(reason);
      return threePages(cursor);
    });
    const client = await mcpClient({
      name: 'paged',
      connection: connection as McpConnection,
      signal: controller.signal,
    });

    expect(await rejectionOf(client.tools())).toBe(reason);
    // Pages one and two were asked; page three was not.
    expect(calls.map((c) => c[0])).toEqual([undefined, { cursor: 'p2' }]);
  });

  it('the abort wins over an incomplete list: the caller asked to stop', async () => {
    const controller = new AbortController();
    const reason = new Error('enough');
    const { connection } = pagingConnection((cursor) => {
      if (cursor === 'loop') controller.abort(reason);
      return { tools: [toolNamed(cursor ?? 'first')], nextCursor: 'loop' };
    });
    const client = await mcpClient({
      name: 'paged',
      connection: connection as McpConnection,
      signal: controller.signal,
    });

    expect(await rejectionOf(client.tools())).toBe(reason);
  });
});

// ─── 5. One page: the request it always got ───────────────────────

describe('tools/list pagination — a single page is byte-identical to before', () => {
  const onePage = (): Page => ({ tools: [toolNamed('solo'), toolNamed('pair')] });

  it('no signal: ONE call, with no arguments at all', async () => {
    const { connection, calls } = pagingConnection(onePage);
    const client = await mcpClient({
      name: 'flat',
      transport: { transport: 'stdio', command: 'unused' },
      _client: connection,
    });

    const tools = await client.tools();
    expect(calls).toEqual([[]]);
    expect(names(tools)).toEqual(['solo', 'pair']);
    expect(tools[0]!.schema).toEqual({
      name: 'solo',
      description: 'tool solo',
      inputSchema: { type: 'object' },
    });
    expect(tools[0]!.source).toBe('flat');
  });

  it('with a signal: ONE call, `(undefined, { signal })`', async () => {
    const controller = new AbortController();
    const { connection, calls } = pagingConnection(onePage);
    const client = await mcpClient({
      name: 'flat',
      connection: connection as McpConnection,
      signal: controller.signal,
    });

    await client.tools();
    expect(calls).toEqual([[undefined, { signal: controller.signal }]]);
  });
});

// ─── The truth path: a real SDK server that pages ─────────────────

interface PagingServer {
  readonly url: string;
  /** The `params` of every `tools/list` request, as the server parsed them. */
  readonly listParams: unknown[];
  close(): Promise<void>;
}

/** A real SDK server over HTTP whose tool list is `pages`, chained by cursor. */
async function startPagingServer(pages: readonly Page[]): Promise<PagingServer> {
  const listParams: unknown[] = [];
  const build = (): SdkServer => {
    const server = new SdkServer(
      { name: 'paging', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, (request) => {
      listParams.push(request.params);
      const index = request.params?.cursor === undefined ? 0 : Number(request.params.cursor);
      const page = pages[index]!;
      return {
        tools: page.tools.map((t) => ({ ...t, inputSchema: { type: 'object' as const } })),
        ...(page.nextCursor !== undefined && { nextCursor: page.nextCursor }),
      };
    });
    return server;
  };
  const listener: HttpServer = createServer((req, res) => {
    void (async () => {
      const server = build();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });
  const port = await freePort();
  await new Promise<void>((done, fail) => {
    listener.once('error', fail);
    listener.listen(port, '127.0.0.1', done);
  });
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    listParams,
    close: () =>
      new Promise<void>((done, fail) => {
        listener.closeAllConnections();
        listener.close((err) => (err ? fail(err) : done()));
      }),
  };
}

describe('tools/list pagination — against a real SDK server (streamable HTTP)', () => {
  it(
    'follows the real nextCursor to the last page; page one is sent with no params',
    async () => {
      const server = await startPagingServer([
        { tools: [toolNamed('alpha')], nextCursor: '1' },
        { tools: [toolNamed('beta')], nextCursor: '2' },
        { tools: [toolNamed('gamma')] },
      ]);
      const client = await mcpClient({
        name: 'real-paging',
        transport: { transport: 'http', url: server.url },
      });
      try {
        expect(names(await client.tools())).toEqual(['alpha', 'beta', 'gamma']);
        expect(server.listParams).toEqual([undefined, { cursor: '1' }, { cursor: '2' }]);
      } finally {
        await client.close();
        await server.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a one-page server gets exactly one tools/list, with no params',
    async () => {
      const server = await startPagingServer([{ tools: [toolNamed('only')] }]);
      const client = await mcpClient({
        name: 'real-flat',
        transport: { transport: 'http', url: server.url },
      });
      try {
        expect(names(await client.tools())).toEqual(['only']);
        expect(server.listParams).toEqual([undefined]);
      } finally {
        await client.close();
        await server.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});
