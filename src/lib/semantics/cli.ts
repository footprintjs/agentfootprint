/**
 * check:semantics CLI core (9.53.0 — the build gate).
 *
 * Pattern: humble shell (the tool-lint `cli.ts` precedent) —
 *          `bin/agentfootprint-check-semantics.mjs` is a 2-line wrapper;
 *          ALL behavior (arg parsing, catalog coercion, report, exit code)
 *          lives here so it is unit-testable without spawning a process.
 * Role:    `src/lib/semantics/`. Reads ONE JSON file of tools + sample
 *          results, prints a report, returns the process exit code:
 *            0 — report.ok (and, under --strict, zero warnings)
 *            1 — findings failed the gate
 *            2 — usage / input error (bad flags, unreadable file,
 *                unrecognized JSON shape, unknown resultClass)
 *
 * Consumers wire it beside their other gates (the `check:tools` convention):
 *
 *   "check:semantics": "node scripts/dump-semantics-catalog.mjs && agentfootprint-check-semantics semantics-catalog.json"
 *
 * The catalog is sample results — what your MOCK tools return — because the
 * gate judges result shapes, and a build must never run tools that touch
 * live systems. A mock catalog is something this ecosystem already has
 * everywhere the check matters.
 */

import { checkSemantics, type SemanticsCatalogEntry, type SemanticsReport } from './check.js';
import { formatSemanticsReport } from './format.js';
import { RESULT_CLASSES } from './types.js';

export interface SemanticsCliIO {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const USAGE = `usage: agentfootprint-check-semantics <semantics-catalog.json> [options]

  <semantics-catalog.json>  JSON file of tools + sample results. Accepted shapes:
                              [{ name, resultClass?, results: [...] }]
                              [{ name, resultClass?, result: ... }]     (single sample)
                              { tools: [...] }                          (either row shape)

                            resultClass ∈ { ${RESULT_CLASSES.join(', ')} } — the class
                            declared on defineTool({ resultClass }); omit for tools
                            with no class rules (envelope rules still apply).

  --strict                  warnings also fail the gate
  --json                    print the full report as JSON instead of text

exit codes: 0 ok · 1 findings failed the gate · 2 usage/input error`;

/**
 * Normalize the accepted JSON shapes to the checker's catalog. Throws (with
 * a shape description) on unrecognized input — the CLI maps that to exit
 * code 2. `resultClass` values are passed through untouched; the checker is
 * the one owner of the closed-set refusal.
 */
export function coerceSemanticsCatalog(json: unknown): readonly SemanticsCatalogEntry[] {
  const list = Array.isArray(json)
    ? json
    : json !== null &&
      typeof json === 'object' &&
      Array.isArray((json as { tools?: unknown }).tools)
    ? (json as { tools: unknown[] }).tools
    : undefined;
  if (list === undefined) {
    throw new Error(
      'expected a JSON array of { name, resultClass?, results } rows or { tools: [...] }',
    );
  }
  return list.map((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`tools[${index}] is not an object`);
    }
    const entry = raw as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`tools[${index}] has no string 'name'`);
    }
    const results = Array.isArray(entry.results)
      ? entry.results
      : 'result' in entry
      ? [entry.result]
      : undefined;
    if (results === undefined) {
      throw new Error(
        `tools[${index}] ('${name}') has neither 'results' (an array of sample results) nor ` +
          `'result' (one sample) — the gate judges sample results; a mock tool's return is ` +
          `the natural sample.`,
      );
    }
    return {
      name,
      ...(entry.resultClass !== undefined
        ? { resultClass: entry.resultClass as SemanticsCatalogEntry['resultClass'] }
        : {}),
      results,
    };
  });
}

/**
 * Run the gate CLI. Returns the exit code (never calls `process.exit` — the
 * bin wrapper assigns it to `process.exitCode`).
 */
export async function runCheckSemanticsCli(
  argv: readonly string[],
  io: SemanticsCliIO = {
    // eslint-disable-next-line no-console
    stdout: (line) => console.log(line),
    // eslint-disable-next-line no-console
    stderr: (line) => console.error(line),
  },
): Promise<number> {
  let file: string | undefined;
  let strict = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--strict') strict = true;
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') {
      io.stderr(USAGE);
      return 2;
    } else if (arg.startsWith('-')) {
      io.stderr(`unknown flag '${arg}'\n\n${USAGE}`);
      return 2;
    } else if (file === undefined) file = arg;
    else {
      io.stderr(`unexpected extra argument '${arg}'\n\n${USAGE}`);
      return 2;
    }
  }
  if (file === undefined) {
    io.stderr(USAGE);
    return 2;
  }

  let report: SemanticsReport;
  try {
    // Lazy node:fs import (browser-compat — the tool-lint precedent):
    // `agentfootprint/observe` re-exports this module, and a top-level
    // node:fs import detonates a browser bundle at module-eval. The CLI
    // path is the only consumer that touches the filesystem.
    const { readFile } = await import('node:fs/promises');
    const catalog = coerceSemanticsCatalog(JSON.parse(await readFile(file, 'utf8')));
    report = checkSemantics(catalog);
  } catch (error) {
    io.stderr(`agentfootprint-check-semantics: ${file}: ${(error as Error).message}`);
    return 2;
  }

  if (json) io.stdout(JSON.stringify(report, null, 2));
  else io.stdout(formatSemanticsReport(report));

  if (!report.ok) return 1;
  if (strict && report.findings.length > 0) return 1;
  return 0;
}
