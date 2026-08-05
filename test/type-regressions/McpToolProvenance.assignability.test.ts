/**
 * Compile-level regression test — 7.23.0's two MCP-side seams.
 *
 * Both are things a runtime test cannot see, so the real compiler pins them
 * here (this file lives under ./tsconfig.json, run via `npm run test:types`,
 * and its name matches `test/**\/*.test.ts` so `npm test` runs the runtime
 * assertions too):
 *
 *   1. **The `callTool` union is a union.** The shim used to promise only the
 *      `content` arm, which let `result.content.map(...)` compile against a
 *      value that can arrive without one. That is the 7.13.0 lesson applied to
 *      a second shim: the fidelity of the type is what turns this error class
 *      into a compile error the next time somebody writes it. The
 *      `@ts-expect-error` below fails the build the day the union is narrowed
 *      away again.
 *   2. **Provenance is optional everywhere.** `Tool.source` and
 *      `ToolMiddlewareContext.toolSource` are additive — a `Tool` written
 *      before 7.23.0 still compiles, and a middleware that never mentions
 *      `toolSource` still compiles.
 *
 * 3. And the `fetch` seam is typed as the SDK types it — a plain
 *    `(url, init) => Promise<Response>` is accepted, so the function a
 *    consumer already has is the function this option takes.
 */
import { describe, expect, it } from 'vitest';
import type { McpCallToolResult, McpHttpTransport } from '../../src/tool-providers/index';
import type { Tool } from '../../src/core/tools';
import type { ToolMiddleware, ToolMiddlewareContext } from '../../src/index';
import { allow, deny } from '../../src/index';

// ─── 1. The union has two arms, and the compiler knows it ─────────

function readWithNarrowing(result: McpCallToolResult): string {
  if ('toolResult' in result) return String(result.toolResult);
  return result.content.map((c) => c.text ?? `[${c.type}]`).join('\n');
}

function readWithoutNarrowing(result: McpCallToolResult): string {
  // @ts-expect-error — `content` does not exist on the legacy arm. Reading it
  // unconditionally is exactly the bug 7.23.0 fixed; if this line ever stops
  // erroring, the shim has lost the arm that makes the bug visible.
  return result.content.length > 0 ? 'blocks' : 'empty';
}

// ─── 2. Provenance is additive on both sides ──────────────────────

/** A pre-7.23 tool literal: no `source`, still a `Tool`. */
const legacyTool: Tool = {
  schema: { name: 'act', description: 'does a thing', inputSchema: { type: 'object' } },
  execute: () => 'ok',
};

/** A relayed tool declares where it came from. */
const relayedTool: Tool = {
  schema: { name: 'call_aws', description: 'relayed', inputSchema: { type: 'object' } },
  source: 'aws-prod',
  execute: () => 'ok',
};

/** A middleware that scopes its rule to one server, written against the types alone. */
const scoped: ToolMiddleware = {
  name: 'prod-only',
  onToolCall: (call: ToolMiddlewareContext) =>
    call.toolSource === 'aws-prod' ? deny('production needs a ticket') : allow(),
};

/** A middleware that never mentions provenance still compiles unchanged. */
const unaware: ToolMiddleware = { name: 'unaware', onToolCall: () => allow() };

// ─── 3. The fetch option takes the function you already have ──────

const signed: McpHttpTransport = {
  transport: 'http',
  url: 'https://example.invalid/mcp',
  headers: { 'x-tenant': 'acme' },
  fetch: async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', 'Signed');
    return fetch(url, { ...init, headers });
  },
};

/** The global `fetch` itself satisfies the option — no adapter needed. */
const plain: McpHttpTransport = {
  transport: 'http',
  url: 'https://example.invalid/mcp',
  fetch: globalThis.fetch,
};

describe('McpCallToolResult + tool provenance — type regressions', () => {
  it('narrowing reads both arms of the union', () => {
    expect(readWithNarrowing({ toolResult: 41.2 })).toBe('41.2');
    expect(readWithNarrowing({ content: [{ type: 'text', text: 'hi' }] })).toBe('hi');
    expect(typeof readWithoutNarrowing).toBe('function');
  });

  it('provenance is optional on the Tool and on the middleware context', () => {
    expect(legacyTool.source).toBeUndefined();
    expect(relayedTool.source).toBe('aws-prod');
    expect(scoped.onToolCall({ toolName: 'call_aws', toolSource: 'aws-prod' } as never)).toEqual(
      deny('production needs a ticket'),
    );
    expect(unaware.onToolCall({ toolName: 'act' } as never)).toEqual(allow());
  });

  it('the http transport accepts a signer and the plain global fetch', () => {
    expect(typeof signed.fetch).toBe('function');
    expect(typeof plain.fetch).toBe('function');
  });
});
