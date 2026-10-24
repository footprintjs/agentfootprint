#!/usr/bin/env node
/** Free, offline counterfactual replay. See REPARSE.md. No provider imports. */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { replayProvenance, runReparse } from './reparse-files.mjs';
export { hash, reparseTrial, summarizeReparse } from './reparse-core.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lib = Object.assign(
    {},
    await import('../../dist/esm/answer-validation/outputSchema.js'),
    await import('../../dist/esm/core/agent/negativeClaims/delivery.js'),
    await import('../../dist/esm/core/agent/negativeClaims/prose.js'),
    await import('../../dist/esm/integrity/claim-binding/capture.js'),
    await import('../../dist/esm/semantics/toolEffects.js'),
  );
  lib.replayProvenance = replayProvenance(fileURLToPath(new URL('../../', import.meta.url)));
  const summary = runReparse(process.argv[2], process.argv[3], lib);
  console.log(JSON.stringify(summary, null, 2));
}
