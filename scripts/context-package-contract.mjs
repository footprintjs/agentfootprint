/** Fixed import-only internal contract entry. No setup or IO happens on import. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCommands } from './context-package-contract/commands.mjs';
import { PROTOCOL } from './context-package-contract/protocol.mjs';
import { createContractRunner } from './context-package-contract/runner.mjs';
import { runStrictNativeContract } from './context-package-contract/publishedDriver.mjs';

const ownerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTEXT_PACKAGE_CONTRACT_PROTOCOL = PROTOCOL;

export async function runPairedContextPackageContract(input) {
  return createContractRunner(ownerRoot, nativeCommands(ownerRoot, true)).runPaired(input);
}

export async function runRegistryContextPackageContract() {
  return createContractRunner(ownerRoot, nativeCommands(ownerRoot, false)).runRegistry();
}

export async function runStrictContextPackageContract(argv) {
  return runStrictNativeContract(ownerRoot, argv, runPairedContextPackageContract);
}
