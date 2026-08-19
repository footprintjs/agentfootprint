#!/usr/bin/env node
/**
 * agentfootprint-check-semantics — CI gate for semantic tool results
 * (9.53.0). Humble shell: all behavior lives in src/lib/semantics/cli.ts
 * (unit-tested there); this wrapper only resolves the built module and maps
 * the returned code onto process.exitCode.
 *
 *   npx agentfootprint-check-semantics semantics-catalog.json
 *   npx agentfootprint-check-semantics semantics-catalog.json --strict
 *
 * Guide: docs-next/content/docs/build/semantic-results.mdx
 */
const { runCheckSemanticsCli } = await import('../dist/esm/lib/semantics/cli.js');
process.exitCode = await runCheckSemanticsCli(process.argv.slice(2));
