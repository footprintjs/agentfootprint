/**
 * A stand-in for an opened pooled client, for the tests that drive the pool's
 * own lifecycle through its `_open` seam: when an open settles, when a close
 * settles, what a call does. No SDK and no network — the tests that need the
 * real MCP SDK use `fakeEndpoint.ts`.
 */

import type { ClientPort } from '../../../src/mcp/clientPort.js';
import type { OpenedClient } from '../../../src/mcp/pool/plan.js';
import { DeleteWatch, endSession, type Ending } from '../../../src/mcp/terminate.js';
import type { McpClient, McpListedTool, McpTransport } from '../../../src/mcp/types.js';
import type { Tool } from '../../../src/tools/tools.js';

/** A transport the stand-in never uses: nothing here reaches a network. */
export const NO_NETWORK: McpTransport = {
  transport: 'http',
  url: 'https://no-network.example.test/mcp',
};

export interface StubOptions {
  /** The tools it lists now, by name. Default `['status']`. */
  readonly tools?: () => readonly string[];
  /** What a call to `tool` does. Default: answers `<tool>@<client>`. */
  readonly call?: (tool: string, client: string) => Promise<unknown>;
  /** Its local close. Default: settles at once. */
  readonly close?: () => Promise<void>;
  /** Its ending. Default: the remote side says it ended the session, then the local close. */
  readonly end?: () => Ending;
  /** The name of every client whose ending started. */
  readonly ended?: string[];
}

/** An opened client named `name`. */
export function stubClient(name: string, options: StubOptions = {}): OpenedClient {
  const listedNow = (): McpListedTool[] =>
    (options.tools?.() ?? ['status']).map((tool) => ({
      name: tool,
      description: tool,
      inputSchema: { type: 'object' },
    }));
  const call = options.call ?? (async (tool: string, client: string) => `${tool}@${client}`);
  const toolFor = (listed: McpListedTool): Tool => ({
    schema: {
      name: listed.name,
      description: listed.description ?? listed.name,
      inputSchema: listed.inputSchema,
    },
    execute: () => call(listed.name, name),
  });
  const close = options.close ?? (async () => undefined);
  const client = {
    name,
    tools: async () => listedNow().map(toolFor),
    refresh: async () => listedNow().map(toolFor),
    close,
  } as McpClient;
  const port: ClientPort = {
    listing: async () => {
      const listed = listedNow();
      return { tools: listed.map(toolFor), listed };
    },
    bind: (listed) => toolFor(listed),
    end: () => {
      options.ended?.push(name);
      if (options.end !== undefined) return options.end();
      const settled = Promise.resolve()
        .then(close)
        .then(
          () => undefined,
          () => undefined,
        );
      return {
        outcome: settled.then(() => ({ remote: 'terminated', resolved: true, durationMs: 0 })),
        settled,
      };
    },
  };
  return { client, port };
}

/** A close that waits until released: `running` counts closes started and not yet released. */
export function heldCloses(): {
  readonly close: () => Promise<void>;
  readonly running: number;
  readonly started: number;
  /** Release the oldest running close. */
  releaseOne(): void;
  releaseAll(): void;
} {
  const waiting: Array<() => void> = [];
  let started = 0;
  return {
    close: () => {
      started += 1;
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    get running() {
      return waiting.length;
    },
    get started() {
      return started;
    },
    releaseOne: () => waiting.shift()?.(),
    releaseAll: () => {
      for (const release of waiting.splice(0)) release();
    },
  };
}

/**
 * The real ending procedure over a stand-in session whose `DELETE` is answered
 * 204, closing with `close`, its deadline `timeoutMs`.
 */
export function confirmedEnding(close: () => Promise<void>, timeoutMs: number): () => Ending {
  return () => {
    const watch = new DeleteWatch();
    const transport = {
      sessionId: 'session-1',
      async terminateSession(): Promise<void> {
        await watch.fetch(async () => new Response(null, { status: 204 }))(
          'https://no-network.example.test/mcp',
          { method: 'DELETE' },
        );
      },
    };
    return endSession(transport, watch, close, Date.now, timeoutMs);
  };
}
