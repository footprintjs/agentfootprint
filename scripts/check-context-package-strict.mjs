/** Fixed real four-root published-cohort gate. No mode, executable or callback comes from data. */
import { runStrictContextPackageContract } from './context-package-contract.mjs';

process.exitCode = await runStrictContextPackageContract(process.argv);
