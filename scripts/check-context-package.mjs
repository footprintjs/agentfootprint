/** Exercise the registry dependency through clean source and packed consumers. Run after build. */
import assert from 'node:assert/strict';
import { runRegistryContextPackageContract } from './context-package-contract.mjs';

assert.equal(process.argv.length, 2, 'The registry context CLI accepts no arguments.');
await runRegistryContextPackageContract();
console.log(
  'Clean source and packed consumers install the exact registry dependency online and from cache offline; integrity, CJS, ESM, legacy keys, shared helpers, own JSON fields and both declaration modes pass.',
);
