/**
 * 10 — Discovery-style ToolProvider (v2.11.6): runtime tool catalogs
 * over hubs, MCP registries, custom indexes — without library changes.
 *
 * v2.11.5 ToolProvider was sync — `list(ctx) => Tool[]`. v2.11.6 widens
 * the return type to `Tool[] | Promise<Tool[]>`, adds `signal` to the
 * dispatch context, and emits `agentfootprint.tools.discovery_failed`
 * when a provider throws. Sync providers (the 99% case) still pay
 * zero microtask overhead — the agent does an `instanceof Promise`
 * check before awaiting.
 *
 * What this lets you build (no library API additions required):
 *
 *   • Rube / Composio / Arcade / Action / any tool-hub adapter
 *   • Per-tenant tool catalogs (multi-tenant SaaS — different orgs
 *     see different toolsets)
 *   • Per-skill tool resolution from a backing config service
 *   • TTL-cached MCP-server pulls (don't fetch every iteration)
 *
 * Pattern in this file: a `discoveryProvider({ hub, ttlMs })` factory
 * over a hypothetical generic `ToolHub` interface, with TTL caching,
 * AbortSignal honored, and a graceful-failure scenario showing the
 * `discovery_failed` event.
 *
 * Three scenarios run:
 *
 *   1. Async discovery — provider fetches the catalog, agent dispatches
 *      a discovered tool. Two iterations → cache hit on the second.
 *
 *   2. Cancellation — agent run is aborted mid-discovery; provider
 *      sees the abort via `ctx.signal` and short-circuits.
 *
 *   3. Failure path — hub is unreachable; `tools.discovery_failed`
 *      fires; the run rejects loudly so a configured `reliability`
 *      rule (or the caller) can decide what to do.
 *
 * Run:  npx tsx examples/features/10-discovery-provider.ts
 */

import {
  Agent,
  defineTool,
  mock,
  type LLMToolSchema,
  type Tool,
  type ToolDispatchContext,
  type ToolProvider,
} from '../../src/index.js';
import { type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/10-discovery-provider',
  title: 'Discovery-style ToolProvider — async list() over a tool hub with TTL cache',
  group: 'features',
  description:
    'v2.11.6 — ToolProvider.list(ctx) may return Promise<Tool[]> for runtime tool catalogs (Rube, MCP, custom hubs). Demonstrates TTL caching, ctx.signal propagation, and the agentfootprint.tools.discovery_failed event when discovery throws. Sync providers still pay zero overhead.',
  defaultInput: 'demo discovery / cancellation / failure paths',
  providerSlots: ['feature'],
  tags: ['feature', 'tool-provider', 'discovery', 'mcp', 'rube'],
};

// ─── A generic tool hub — stand-in for Rube, MCP registry, etc. ──

// #region tool-hub-interface
/** Minimal interface a hub adapter exposes. Real adapters wrap an
 *  HTTP / RPC / SDK client — this interface is what discoveryProvider
 *  needs from any of them. */
interface ToolHub {
  /** Fetch the current tool catalog. May reject (network / auth). */
  fetchCatalog(opts: { signal?: AbortSignal }): Promise<readonly Tool[]>;
}
// #endregion tool-hub-interface

// #region discovery-provider
/**
 * Discovery-style ToolProvider over a ToolHub.
 *
 *   • Returns `Promise<Tool[]>` (async path; agent awaits).
 *   • TTL-caches the result so repeated iterations don't re-fetch.
 *   • Honors `ctx.signal` so the agent's AbortController cancels the
 *     in-flight discovery instead of holding the run open.
 *   • Sets `id` so observability / `discovery_failed` events route
 *     to the right adapter.
 */
function discoveryProvider(opts: {
  hub: ToolHub;
  ttlMs: number;
  id?: string;
}): ToolProvider {
  let cache: { tools: readonly Tool[]; expiresAt: number } | undefined;
  return {
    id: opts.id ?? 'discovery',
    async list(ctx: ToolDispatchContext): Promise<readonly Tool[]> {
      const now = Date.now();
      if (cache && cache.expiresAt > now) return cache.tools;
      const tools = await opts.hub.fetchCatalog({
        ...(ctx.signal && { signal: ctx.signal }),
      });
      cache = { tools, expiresAt: now + opts.ttlMs };
      return tools;
    },
  };
}
// #endregion discovery-provider

// ─── Fixtures: fake hub implementations ─────────────────────────

function fakeTool(name: string, body = 'ok'): Tool {
  return defineTool({
    name,
    description: `${name} (discovered)`,
    inputSchema: { type: 'object' },
    execute: async () => `${name}:${body}`,
  });
}

/** A successful hub. */
function happyHub(): { hub: ToolHub; getFetchCount: () => number } {
  let fetchCount = 0;
  const hub: ToolHub = {
    async fetchCatalog() {
      fetchCount += 1;
      await new Promise((r) => setTimeout(r, 10)); // simulate I/O
      return [fakeTool('translate'), fakeTool('summarize')];
    },
  };
  return { hub, getFetchCount: () => fetchCount };
}

/** A hub that honors AbortSignal. */
function cancellableHub(): ToolHub {
  return {
    async fetchCatalog({ signal }) {
      // Simulate a long fetch that's interruptible.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 200);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
      return [fakeTool('slow')];
    },
  };
}

/** A hub that's unreachable. */
function brokenHub(): ToolHub {
  return {
    async fetchCatalog() {
      throw new Error('hub unreachable: ECONNREFUSED');
    },
  };
}

// ─── Scenario 1 — happy discovery + TTL cache hit ────────────────

async function scenarioHappy(): Promise<void> {
  console.log('\n[1] async discovery + TTL cache');
  const { hub, getFetchCount } = happyHub();
  const provider = discoveryProvider({ hub, ttlMs: 60_000, id: 'happy-hub' });

  let calls = 0;
  const llm = mock({
    respond: (req: {
      tools?: readonly LLMToolSchema[];
      messages: readonly { role: string }[];
    }) => {
      calls += 1;
      const toolNames = (req.tools ?? []).map((t) => t.name).join(', ');
      console.log(`    iter ${calls}: tools visible = [${toolNames}]`);
      // First iteration → call a discovered tool. Second iteration → finalize.
      const sawToolResult = req.messages.some((m) => m.role === 'tool');
      if (!sawToolResult) {
        return {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'translate', args: { lang: 'fr' } }],
        };
      }
      return { content: 'final answer', toolCalls: [] };
    },
  });

  const agent = Agent.create({ provider: llm, model: 'mock', maxIterations: 4 })
    .system('You translate text.')
    .toolProvider(provider)
    .build();

  await agent.run({ message: 'translate "hello" to french' });
  console.log(`    hub.fetchCatalog called ${getFetchCount()} time(s) — TTL cached after first`);
}

// ─── Scenario 2 — cancellation propagates via ctx.signal ────────

async function scenarioCancellation(): Promise<void> {
  console.log('\n[2] cancellation via ctx.signal');
  const provider = discoveryProvider({
    hub: cancellableHub(),
    ttlMs: 0,
    id: 'cancellable-hub',
  });

  const llm = mock({ respond: () => ({ content: 'never reached', toolCalls: [] }) });
  const agent = Agent.create({ provider: llm, model: 'mock' })
    .system('s')
    .toolProvider(provider)
    .build();

  const controller = new AbortController();
  // Abort 50ms in — well before the hub's 200ms fetch completes.
  setTimeout(() => controller.abort(), 50);

  try {
    await agent.run({ message: 'go' }, { env: { signal: controller.signal } });
    console.log('    unexpected: run completed without abort');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`    ✓ run aborted: ${msg}`);
  }
}

// ─── Scenario 3 — discovery failure emits typed event ───────────

async function scenarioFailure(): Promise<void> {
  console.log('\n[3] discovery failure → tools.discovery_failed event');
  const provider = discoveryProvider({ hub: brokenHub(), ttlMs: 0, id: 'broken-hub' });
  const llm = mock({ respond: () => ({ content: 'never reached', toolCalls: [] }) });
  const agent = Agent.create({ provider: llm, model: 'mock' })
    .system('s')
    .toolProvider(provider)
    .build();

  agent.on('agentfootprint.tools.discovery_failed', (e) => {
    console.log(
      `    event: providerId='${e.payload.providerId}' iteration=${e.payload.iteration} error='${e.payload.error}'`,
    );
  });

  try {
    await agent.run({ message: 'go' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`    ✓ run rejected loudly: ${msg}`);
  }
}

// ─── Driver ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  await scenarioHappy();
  await scenarioCancellation();
  await scenarioFailure();
  console.log('\nAll three scenarios complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
