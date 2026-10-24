#!/usr/bin/env node
/** No network: compare an old built renderer and the new built default renderer.
 * node bench/negative/compare-evidence-owned.mjs <run> <new-out> <baseline-root> [current-root]
 * Both roots must already be built. Historical reparse files remain unchanged. */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { replayProvenance } from './reparse-files.mjs';
import { runComparison } from './compare-evidence-owned-files.mjs';
export {
  compareTrial,
  summarizeComparison,
  ORIGINAL_DENOMINATORS,
} from './compare-evidence-owned-core.mjs';

export async function loadBuiltRuntime(root) {
  const modules = [
    'answer-validation/outputSchema.js',
    'core/agent/negativeClaims/delivery.js',
    'core/agent/negativeClaims/prose.js',
    'integrity/claim-binding/capture.js',
    'semantics/toolEffects.js',
  ];
  const lib = Object.assign(
    {},
    ...(await Promise.all(
      modules.map((file) => import(pathToFileURL(join(root, 'dist/esm', file)).href)),
    )),
  );
  lib.replayProvenance = replayProvenance(root);
  return lib;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [run, out, baselineRoot, currentRoot = fileURLToPath(new URL('../../', import.meta.url))] =
    process.argv.slice(2);
  if (!run || !out || !baselineRoot)
    throw new Error('Expected <run> <new-out> <baseline-root> [current-root].');
  const baseline = await loadBuiltRuntime(resolve(baselineRoot)),
    current = await loadBuiltRuntime(resolve(currentRoot));
  if (
    !isDeepStrictEqual(
      baseline.replayProvenance.replayScripts,
      current.replayProvenance.replayScripts,
    )
  )
    throw new Error('Historical replay scripts changed between builds.');
  console.log(JSON.stringify(runComparison(run, out, baseline, current), null, 2));
}
