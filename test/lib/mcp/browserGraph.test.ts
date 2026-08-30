/**
 * The browser fence — bundle the SHIPPED output the way a browser build does,
 * and assert what reaches the graph.
 *
 * ── Why a graph test and not a green test suite ──────────────────────────────
 * "The tests pass" is not evidence that a browser bundle works. Every test in
 * this repo runs in Node, where `node:module` resolves and `createRequire`
 * exists, so the exact failure a browser hits is the one Node can never
 * reproduce. What CAN be checked here is the thing that decides it: which
 * modules end up in the graph a bundler builds, and which builtins they reach
 * for. That is what this file asserts, over `dist/` — the bytes that ship, not
 * the sources.
 *
 * ── WHAT THIS GUARANTEES ─────────────────────────────────────────────────────
 *   1. `agentfootprint/providers` still bundles for a browser with the MCP SDK
 *      BLOCKED at resolve time. That is the optional-peer property, stated as a
 *      build: a literal `import('@modelcontextprotocol/sdk/...')` anywhere on
 *      this graph would fail this test, which is what stops a future "just use
 *      a dynamic import" from silently breaking every consumer who does not
 *      have the peer installed.
 *   2. The `node:` edges on that graph are EXACTLY the two known ones. A NEW
 *      node edge on the `/providers` path fails the build.
 *   3. The builtins hidden inside `lazyRequire("…")` — invisible to any module
 *      graph, by design — are exactly the four known ones. This is the half a
 *      metafile walk cannot see, so it is checked by reading the emitted text.
 *   4. The MCP path a browser actually walks (`mcpClient` + the two SDK client
 *      modules) bundles with only `node:module` externalized, reaches no other
 *      builtin, and never pulls in `client/stdio.js` — the SDK's one
 *      Node-importing client module.
 *   5. Everything on the MCP path that is NOT the loader, plus the real SDK,
 *      bundles with NO externals at all and ZERO node edges.
 *
 * ── WHAT IT CANNOT CATCH ─────────────────────────────────────────────────────
 * It is a bundler, not a browser. It does not run a page, so it cannot prove
 * that the transport's `fetch`, its SSE handling or the SDK's ajv path behave
 * in Chrome; it cannot see CORS, a service worker, or a CSP that refuses ajv's
 * code generation. It cannot see anything a module reaches at CALL time through
 * a variable specifier beyond the string scan in (3). And it measures esbuild —
 * Vite/rollup agrees on (1) and (2) but not on every hatch (it rejects the
 * `.catch()` escape esbuild accepts, and it auto-externalizes `node:module`
 * where raw esbuild refuses). Until a real page drives initialize/listTools/
 * callTool, the honest report is "proven in Node, fenced at the graph, not
 * gated in a browser."
 */

import { describe, expect, it } from 'vitest';
import { build, type Metafile, type Plugin } from 'esbuild';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './realTransportSupport.js';

const DIST = resolve(REPO_ROOT, 'dist/esm');
const SCRATCH = resolve(REPO_ROOT, 'node_modules/.agentfootprint-browser-graph');

/** Fails the build if anything reaches for the optional MCP peer. */
const blockTheSdk: Plugin = {
  name: 'block-mcp-sdk',
  setup(builder) {
    builder.onResolve({ filter: /^@modelcontextprotocol\// }, (args) => ({
      errors: [
        {
          text:
            `the MCP SDK reached the browser graph: ${args.path} (imported by ${args.importer}). ` +
            'It is an OPTIONAL peer — a specifier a bundler can resolve statically is a specifier ' +
            'every consumer without the package must now install.',
        },
      ],
    }));
  },
};

interface Graph {
  readonly nodeEdges: readonly string[];
  readonly inputs: readonly string[];
  readonly text: string;
}

async function bundle(
  entry: string,
  options: { external?: string[]; blockSdk?: boolean } = {},
): Promise<Graph> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    metafile: true,
    write: false,
    logLevel: 'silent',
    ...(options.external && { external: options.external }),
    ...(options.blockSdk && { plugins: [blockTheSdk] }),
  });
  return {
    nodeEdges: nodeEdgesOf(result.metafile),
    inputs: Object.keys(result.metafile.inputs),
    text: result.outputFiles[0]!.text,
  };
}

/**
 * Every `node:` specifier on the graph, with the file that reached for it.
 *
 * esbuild reports input paths relative to the process cwd, so they are
 * normalized to their `dist/esm/…` tail — the assertion is about which MODULE
 * reached for a builtin, not about where the suite was run from.
 */
function nodeEdgesOf(meta: Metafile): string[] {
  const edges: string[] = [];
  for (const [file, info] of Object.entries(meta.inputs)) {
    for (const imported of info.imports ?? []) {
      if (imported.path.startsWith('node:')) edges.push(`${imported.path} <- ${shipped(file)}`);
    }
  }
  return edges.sort();
}

/** A shipped module named the way it ships, whatever the cwd was. */
function shipped(file: string): string {
  const at = file.replace(/\\/g, '/').indexOf('dist/esm/');
  return at === -1 ? file : file.slice(at);
}

/** A tiny entry file, so a fixture can name several modules at once. */
function fixture(name: string, source: string): string {
  mkdirSync(SCRATCH, { recursive: true });
  const file = resolve(SCRATCH, name);
  writeFileSync(file, source);
  return file;
}

// The graph tests read what SHIPS, so they need a build. Say so rather than
// failing on a missing file three frames deep inside esbuild.
const built = existsSync(resolve(DIST, 'doors/providers.js'));

describe.skipIf(!built)('the /providers browser graph', () => {
  it('bundles for a browser with the MCP SDK blocked — the optional-peer property, as a build', async () => {
    const graph = await bundle(resolve(DIST, 'doors/providers.js'), {
      external: ['node:*'],
      blockSdk: true,
    });

    expect(graph.inputs.filter((f) => f.includes('modelcontextprotocol'))).toEqual([]);
    // And the door is really the whole door, not a stub that resolved to nothing.
    expect(graph.inputs.length).toBeGreaterThan(100);
  });

  it('LAW: the node edges are EXACTLY these two — a new one fails the build', async () => {
    const graph = await bundle(resolve(DIST, 'doors/providers.js'), {
      external: ['node:*'],
      blockSdk: true,
    });

    // Both sit inside a function body or behind a namespace import that is
    // never read at module scope, which is why the door LOADS in a browser
    // today. A third edge would have to be argued for on the same terms.
    expect(graph.nodeEdges).toEqual([
      'node:http <- dist/esm/lib/mcp/mcpServe.js',
      'node:module <- dist/esm/lib/lazyRequire.js',
    ]);
  });

  it('LAW: the builtins hidden behind lazyRequire are exactly these four', async () => {
    // The half a module graph CANNOT see. `lazyRequire` takes a string
    // PARAMETER precisely so no bundler can follow it, so an edge walk reports
    // zero here and a new call-time Node dependency would slip in unnoticed.
    // Read the emitted text instead.
    const graph = await bundle(resolve(DIST, 'doors/providers.js'), {
      external: ['node:*'],
      blockSdk: true,
    });
    const hidden = [
      ...new Set([...graph.text.matchAll(/lazyRequire\(\s*["']([^"']+)["']/g)].map((m) => m[1]!)),
    ].sort();

    expect(hidden.filter((s) => s.startsWith('node:'))).toEqual([
      'node:child_process',
      'node:crypto',
      'node:fs',
      'node:os',
    ]);
    // …and the MCP peer is reached ONLY through that same invisible seam, which
    // is what keeps it optional.
    expect(hidden.filter((s) => s.startsWith('@modelcontextprotocol/'))).toEqual([
      '@modelcontextprotocol/sdk/client/index.js',
      '@modelcontextprotocol/sdk/client/stdio.js',
      '@modelcontextprotocol/sdk/client/streamableHttp.js',
      '@modelcontextprotocol/sdk/server/index.js',
      '@modelcontextprotocol/sdk/server/stdio.js',
      '@modelcontextprotocol/sdk/server/streamableHttp.js',
      '@modelcontextprotocol/sdk/types.js',
    ]);
  });

  it('the fence has teeth: blocking the SDK really does fail a graph that imports it', async () => {
    // A gate that cannot fail proves nothing. This is the same plugin, over a
    // graph that genuinely reaches the SDK.
    const entry = fixture(
      'imports-the-sdk.js',
      "export { Client } from '@modelcontextprotocol/sdk/client/index.js';\n",
    );
    await expect(bundle(entry, { external: ['node:*'], blockSdk: true })).rejects.toThrow(
      /the MCP SDK reached the browser graph/,
    );
  });
});

/** What a browser consumer's own entry looks like: our client, the SDK's two. */
function browserPathFixture(): string {
  return fixture(
    'browser-mcp-path.js',
    `export { mcpClient } from ${JSON.stringify(resolve(DIST, 'lib/mcp/mcpClient.js'))};
export { Client } from '@modelcontextprotocol/sdk/client/index.js';
export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
`,
  );
}

// ─── The path a browser actually walks ────────────────────────────

describe.skipIf(!built)('the MCP path a browser walks', () => {
  it('mcpClient + the two SDK client modules reach node:module and nothing else', async () => {
    // `node:module` is the ONE builtin on this path, and it is the namespace
    // import `postbuild-esm.mjs` deliberately emits: a bundler binds the stub
    // without reading a property, and `createRequire` is touched only inside a
    // function body that `sdk` / `connection` never enter. Externalizing it is
    // what Vite does on its own.
    const graph = await bundle(browserPathFixture(), { external: ['node:module'] });

    expect(graph.nodeEdges).toEqual(['node:module <- dist/esm/lib/lazyRequire.js']);
    // The SDK really is on this graph — otherwise the assertion above is vacuous.
    expect(graph.inputs.filter((f) => f.includes('modelcontextprotocol')).length).toBeGreaterThan(
      5,
    );
  });

  it('LAW: client/stdio.js — the SDK module that imports node: — never joins that graph', async () => {
    // The reason the stdio branch keeps `lazyRequire` forever. If `sdk` ever
    // grew a `StdioClientTransport` member, or the http module started
    // re-exporting it, this is what would say so.
    const graph = await bundle(browserPathFixture(), { external: ['node:module'] });

    expect(graph.inputs.filter((f) => /client[/\\]stdio/.test(f))).toEqual([]);
  });

  it('everything on the MCP path except the loader bundles with NO externals and zero node edges', async () => {
    // The SDK is not the barrier and never was — and neither is any of this
    // library's MCP code that does not touch `lazyRequire`. Stated as a build
    // so the claim cannot rot: no `external`, no plugins, no escape hatch.
    const entry = fixture(
      'browser-pure-half.js',
      [
        'transportUrl',
        'connectionRefusals',
        'sdkLoadFailure',
        'throttleRetry',
        'toolExtras',
        'gatewayTransport',
      ]
        .map((m) => `export * from ${JSON.stringify(resolve(DIST, `lib/mcp/${m}.js`))};`)
        .concat([
          "export { Client } from '@modelcontextprotocol/sdk/client/index.js';",
          "export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';",
        ])
        .join('\n'),
    );
    const graph = await bundle(entry);

    expect(graph.nodeEdges).toEqual([]);
  });
});
