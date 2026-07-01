#!/usr/bin/env node
/**
 * agentfootprint-lint-tools — CI gate for tool-catalog confusability
 * (RFC-002 C3). Humble shell: all behavior lives in src/lib/tool-lint/cli.ts
 * (unit-tested there); this wrapper only resolves the built module and maps
 * the returned code onto process.exitCode.
 *
 *   npx agentfootprint-lint-tools tools.json
 *   npx agentfootprint-lint-tools tools.json --threshold 0.94 --strict
 *
 * Guide: docs/guides/tool-catalog-lint.md
 */
const { runToolLintCli } = await import('../dist/esm/lib/tool-lint/cli.js');
process.exitCode = await runToolLintCli(process.argv.slice(2));
