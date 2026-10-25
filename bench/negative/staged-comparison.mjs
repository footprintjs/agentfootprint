#!/usr/bin/env node
/** Free sequential replay; both checkouts must be built before starting. */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { replayProvenance } from './reparse-files.mjs';
import { runStagedComparison } from './staged-comparison-files.mjs';
export {
  compareStages,
  summarizeStages,
  ORIGINAL_DENOMINATORS,
  STAGES,
} from './staged-comparison-core.mjs';

async function loadBuilt(root) {
  const modules = [
    'answer-validation/outputSchema.js',
    'core/agent/negativeClaims/delivery.js',
    'core/agent/negativeClaims/prose.js',
    'integrity/claim-binding/capture.js',
    'semantics/toolEffects.js',
  ];
  return {
    ...Object.assign(
      {},
      ...(await Promise.all(
        modules.map((name) => import(pathToFileURL(join(root, 'dist/esm', name)).href)),
      )),
    ),
    replayProvenance: replayProvenance(root),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [
    run,
    out,
    baselineRoot,
    correctedRoot = fileURLToPath(new URL('../../', import.meta.url)),
  ] = process.argv.slice(2);
  if (!run || !out || !baselineRoot)
    throw new Error(
      'Expected <original-run> <new-private-output> <baseline-root> [corrected-root].',
    );
  const baseline = await loadBuilt(resolve(baselineRoot)),
    corrected = await loadBuilt(resolve(correctedRoot));
  if (
    !isDeepStrictEqual(
      baseline.replayProvenance.replayScripts,
      corrected.replayProvenance.replayScripts,
    )
  )
    throw new Error('Historical replay scripts changed between checkouts.');
  console.log(JSON.stringify(runStagedComparison(run, out, baseline, corrected), null, 2));
}
