/**
 * The default-graph fence — bundle the SHIPPED root entry the way a browser
 * build does, and assert that the trace toolpack is NOT on the graph a plain
 * `import { Agent, defineTool } from 'agentfootprint'` loads.
 *
 * ── Why a graph test ─────────────────────────────────────────────────────────
 * lazyMount.test.ts proves the pack loads lazily in Node. It cannot prove what
 * a bundler does with the same `import()`, and that is where the bytes are
 * decided: every browser consumer, and the docs site's own demo chunk (which
 * this fence exists to keep from growing again — four releases of
 * docs-next/scripts/check-site-budget.mjs history say why), pays for whatever
 * a static walk from the root entry can reach. So this file walks `dist/esm/`
 * with esbuild, code-splitting on, and reads the chunk graph:
 *
 *   1. LAW: `lib/trace-toolpack/traceToolpack.js` is absent from the SYNC
 *      closure of the root entry — the chunks reached by static imports. A
 *      future static import of the pack from `Agent`'s graph fails here.
 *   2. The pack is still REACHABLE — it sits in a chunk reached only by a
 *      `dynamic-import` edge — so the seam is a real split, not a dropped
 *      feature.
 *   3. The `/observe` door carries the pack statically. That is the
 *      contrast, stated: a consumer who imports the debugger wants it eagerly,
 *      and the fence is about the DEFAULT graph, not the whole surface.
 *
 * ── What it cannot catch ─────────────────────────────────────────────────────
 * It is esbuild, not webpack or a browser: the docs site's webpack build and
 * its site budget are the measurement that closes the loop, and a page that
 * drives `.selfExplain()` in Chrome is the only proof the chunk loads there.
 */

import { describe, expect, it } from 'vitest';
import { build, type Metafile } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const DIST = resolve(REPO_ROOT, 'dist/esm');
const PACK = 'dist/esm/lib/trace-toolpack/traceToolpack.js';

interface SplitGraph {
  /** Inputs of every chunk reached from the entry by static imports only. */
  readonly syncInputs: ReadonlySet<string>;
  /** Inputs of chunks reached ONLY across a dynamic-import edge. */
  readonly dynamicInputs: ReadonlySet<string>;
}

/** A shipped module named the way it ships, whatever the cwd was. */
function shipped(file: string): string {
  const at = file.replace(/\\/g, '/').indexOf('dist/esm/');
  return at === -1 ? file : file.slice(at);
}

/**
 * Bundle one shipped entry with code splitting and partition its chunks by
 * how the entry reaches them. `external: ['node:*']` mirrors what every
 * browser bundler does with builtins the graph names but never calls.
 */
async function splitGraph(entry: string): Promise<SplitGraph> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    outdir: resolve(REPO_ROOT, 'node_modules/.agentfootprint-default-graph'),
    metafile: true,
    write: false,
    logLevel: 'silent',
    external: ['node:*'],
  });
  return partition(result.metafile, entry);
}

function partition(meta: Metafile, entry: string): SplitGraph {
  const outputs = meta.outputs;
  const entryOutput = Object.keys(outputs).find((file) =>
    outputs[file]!.entryPoint?.endsWith(shipped(entry)),
  );
  if (entryOutput === undefined) throw new Error(`no output for entry ${entry}`);
  const syncChunks = new Set<string>();
  const dynamicChunks = new Set<string>();
  const walk = (chunk: string, sync: boolean): void => {
    const seen = sync ? syncChunks : dynamicChunks;
    if (seen.has(chunk) || (!sync && syncChunks.has(chunk))) return;
    seen.add(chunk);
    for (const edge of outputs[chunk]!.imports) {
      if (edge.external || !edge.path.endsWith('.js')) continue;
      walk(edge.path, sync && edge.kind !== 'dynamic-import');
    }
  };
  walk(entryOutput, true);
  const inputsOf = (chunks: ReadonlySet<string>): Set<string> =>
    new Set([...chunks].flatMap((chunk) => Object.keys(outputs[chunk]!.inputs).map(shipped)));
  const syncInputs = inputsOf(syncChunks);
  const dynamicInputs = new Set([...inputsOf(dynamicChunks)].filter((f) => !syncInputs.has(f)));
  return { syncInputs, dynamicInputs };
}

// The graph tests read what SHIPS, so they need a build. Say so rather than
// failing on a missing file three frames deep inside esbuild.
const built = existsSync(resolve(DIST, 'index.js')) && existsSync(resolve(DIST, PACK.slice(9)));

describe.skipIf(!built)('the default browser graph of the root entry', () => {
  it('LAW: the trace toolpack is not on the sync closure of `import from "agentfootprint"`', async () => {
    const graph = await splitGraph(resolve(DIST, 'index.js'));
    // The entry really is the whole entry, not a stub that resolved to nothing.
    expect(graph.syncInputs.size).toBeGreaterThan(200);
    expect(graph.syncInputs.has('dist/esm/core/Agent.js')).toBe(true);
    expect(graph.syncInputs.has(PACK)).toBe(false);
    // The two facts the builder needs before the pack loads ARE on it.
    expect(graph.syncInputs.has('dist/esm/lib/trace-toolpack/traceToolNames.js')).toBe(true);
  });

  it('the pack is still reachable — behind a dynamic-import edge, in its own chunk', async () => {
    const graph = await splitGraph(resolve(DIST, 'index.js'));
    expect(graph.dynamicInputs.has(PACK)).toBe(true);
    expect(graph.dynamicInputs.has('dist/esm/lib/trace-toolpack/lazyToolpack.js')).toBe(true);
  });

  it('contrast: the /observe door carries the pack statically, by design', async () => {
    const graph = await splitGraph(resolve(DIST, 'observe.js'));
    expect(graph.syncInputs.has(PACK)).toBe(true);
  });

  it('the sideEffects list the ESM build now carries is TRUE: every module-level registration survives', async () => {
    // With `sideEffects` finally reaching dist/esm (9.94.0), a bundler may
    // skip any module not on the list whose exports go unused. The list names
    // the three registrations this package has and the barrels that import
    // them; this is the proof at the graph, not the list: a root consumer
    // still gets the three cache strategies registered (else
    // `Agent.create({ provider: anthropic() })` would silently cache as NoOp),
    // and a /context consumer still gets the dev-warn host bound.
    const root = await splitGraph(resolve(DIST, 'index.js'));
    for (const strategy of ['Anthropic', 'OpenAI', 'Bedrock']) {
      expect(root.syncInputs.has(`dist/esm/cache/strategies/${strategy}CacheStrategy.js`)).toBe(
        true,
      );
    }
    const context = await splitGraph(resolve(DIST, 'doors/context.js'));
    expect(context.syncInputs.has('dist/esm/lib/injection-engine/devWarnHost.js')).toBe(true);
  });
});
