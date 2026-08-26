/**
 * agentCoreGatewayTransport — the four facts that are AgentCore's alone.
 *
 * The transport underneath is `gatewayTransport`, already tested and already
 * vendor-free. What is asserted here is only what this file adds: the endpoint
 * shape, the policy-session header, and the two catalogue helpers — plus the
 * one behaviour that is easy to get wrong and expensive when you do, which is
 * that a policy session resolved per request does not leak between callers.
 */

import { describe, expect, it } from 'vitest';

import {
  agentCoreGatewayTransport,
  agentCoreGatewayUrl,
  gatewaySearchTool,
  hasGatewaySearch,
  AGENTCORE_GATEWAY_SEARCH_TOOL,
  AGENTCORE_POLICY_SESSION_HEADER,
  AGENTCORE_SIGV4_SERVICE,
} from '../../src/adapters/mcp/agentcore.js';
import { staticTokens } from '../../src/identity/staticTokens.js';
import type { Tool } from '../../src/core/tools.js';

const credentials = staticTokens({ gateway: 'tok-1' });

function tool(name: string): Tool {
  return {
    schema: { name, description: name, inputSchema: { type: 'object' } },
    execute: () => 'unused',
  } as unknown as Tool;
}

// ─── the endpoint ────────────────────────────────────────────────────

describe('agentCoreGatewayUrl', () => {
  it('builds the hostname nobody remembers', () => {
    expect(agentCoreGatewayUrl({ gatewayId: 'my-gw-a1b2c3d4e5', region: 'us-east-1' })).toBe(
      'https://my-gw-a1b2c3d4e5.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp',
    );
  });

  it('refuses half an address rather than building a wrong one', () => {
    expect(() => agentCoreGatewayUrl({ gatewayId: 'gw', region: '' })).toThrow(/both/);
    expect(() => agentCoreGatewayUrl({ gatewayId: '', region: 'us-east-1' })).toThrow(/both/);
  });
});

// ─── the constants, pinned literally ─────────────────────────────────

describe('the wire names are pinned, not paraphrased', () => {
  it('search tool, policy-session header, SigV4 service', () => {
    // Literal assertions on purpose: these must fail if AWS's spelling moves,
    // not merely if our own helpers agree with each other.
    expect(AGENTCORE_GATEWAY_SEARCH_TOOL).toBe('x_amz_bedrock_agentcore_search');
    expect(AGENTCORE_POLICY_SESSION_HEADER).toBe('x-amzn-bedrock-agentcore-policy-session-id');
    expect(AGENTCORE_SIGV4_SERVICE).toBe('bedrock-agentcore');
  });
});

// ─── the policy session header ───────────────────────────────────────

describe('the policy session header', () => {
  /** Capture what the transport's fetch seam finally sends. */
  function capturing(): { seen: Record<string, string>[]; fetch: typeof globalThis.fetch } {
    const seen: Record<string, string>[] = [];
    const fetch = (async (_input: unknown, init?: RequestInit) => {
      seen.push({ ...((init?.headers as Record<string, string>) ?? {}) });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    return { seen, fetch };
  }

  it('is absent when no session was named', async () => {
    const { seen, fetch } = capturing();
    const transport = agentCoreGatewayTransport({
      gatewayId: 'gw',
      region: 'us-east-1',
      credentials,
      fetch,
    });
    await transport.fetch?.('https://example.test', { headers: { a: 'b' } });
    expect(seen[0]).toBeDefined();
    expect(seen[0]?.[AGENTCORE_POLICY_SESSION_HEADER]).toBeUndefined();
  });

  it('is stamped from a fixed string', async () => {
    const { seen, fetch } = capturing();
    const transport = agentCoreGatewayTransport({
      gatewayId: 'gw',
      region: 'us-east-1',
      credentials,
      policySessionId: 'sess-A',
      fetch,
    });
    await transport.fetch?.('https://example.test', {});
    expect(seen[0]?.[AGENTCORE_POLICY_SESSION_HEADER]).toBe('sess-A');
  });

  it('is resolved PER REQUEST from a function — two callers, two sessions', async () => {
    const { seen, fetch } = capturing();
    let current: string | undefined = 'sess-A';
    const transport = agentCoreGatewayTransport({
      gatewayId: 'gw',
      region: 'us-east-1',
      credentials,
      policySessionId: () => current,
      fetch,
    });

    await transport.fetch?.('https://example.test', {});
    current = 'sess-B';
    await transport.fetch?.('https://example.test', {});
    current = undefined;
    await transport.fetch?.('https://example.test', {});

    // The whole point: one shared transport, and each caller's actions stay in
    // their own policy session. A fixed string here would have merged them.
    expect(seen.map((h) => h[AGENTCORE_POLICY_SESSION_HEADER])).toEqual([
      'sess-A',
      'sess-B',
      undefined,
    ]);
  });

  it('keeps the caller’s own headers and their own fetch', async () => {
    const { seen, fetch } = capturing();
    const transport = agentCoreGatewayTransport({
      gatewayId: 'gw',
      region: 'us-east-1',
      credentials,
      policySessionId: 'sess-A',
      fetch,
    });
    await transport.fetch?.('https://example.test', { headers: { 'x-mine': 'kept' } });
    expect(seen[0]?.['x-mine']).toBe('kept');
    expect(seen[0]?.[AGENTCORE_POLICY_SESSION_HEADER]).toBe('sess-A');
  });
});

// ─── the catalogue helpers ───────────────────────────────────────────

describe('finding the gateway’s own search tool', () => {
  it('finds it by its exact wire name', () => {
    const tools = [tool('lookup'), tool(AGENTCORE_GATEWAY_SEARCH_TOOL), tool('refund')];
    expect(gatewaySearchTool(tools)?.schema.name).toBe(AGENTCORE_GATEWAY_SEARCH_TOOL);
    expect(hasGatewaySearch(tools)).toBe(true);
  });

  it('answers undefined for a gateway without it — a permanent, legitimate answer', () => {
    const tools = [tool('lookup'), tool('refund')];
    expect(gatewaySearchTool(tools)).toBeUndefined();
    expect(hasGatewaySearch(tools)).toBe(false);
  });
});
