/**
 * Tool-lint CLI core (RFC-002 block C3 — the CI gate).
 *
 * Pattern: humble shell — `bin/agentfootprint-lint-tools.mjs` is a
 *          3-line wrapper; ALL behavior (arg parsing, catalog coercion,
 *          report, exit code) lives here so it is unit-testable without
 *          spawning a process.
 * Role:    `src/lib/tool-lint/`. Reads ONE JSON file of tools, prints a
 *          report, returns the process exit code:
 *            0 — report.ok
 *            1 — findings failed the gate (!ok)
 *            2 — usage / input error (bad flags, unreadable file,
 *                unrecognized JSON shape)
 *
 * ## Embedder & gating honesty
 *
 * The CLI has no way to receive a consumer embedder, so it uses the
 * built-in deterministic mock (char-frequency, offline, dependency-free)
 * for the similarity RANKING — and, by default, does NOT gate on it:
 * without `--threshold`, similarity is report-only (relative ordering +
 * watch hints) and the exit code reflects structural findings alone.
 * Pass `--threshold` to make confusable pairs fail the gate — you own
 * the calibration at that point (start from
 * `MOCK_EMBEDDER_CALIBRATION.confusabilityThreshold` = 0.94). For real
 * embedder gating, use `analyzeToolCatalog` from
 * `agentfootprint/observe` in a small script instead.
 */

import { readFile } from 'node:fs/promises';
import { mockEmbedder } from '../../memory/embedding/mockEmbedder.js';
import { analyzeToolCatalog, MOCK_EMBEDDER_CALIBRATION } from './analyze.js';
import { formatToolCatalogReport } from './format.js';
import type { CatalogTool } from './types.js';

export interface ToolLintCliIO {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const USAGE = `usage: agentfootprint-lint-tools <tools.json> [options]

  <tools.json>          JSON file with your tool catalog. Accepted shapes:
                          [{ name, description, inputSchema? }]          (plain / MCP tool)
                          { tools: [...] }                               (MCP tools/list result)
                          [{ type: 'function', function: {...} }]       (OpenAI)
                          [{ name, description, input_schema }]         (Anthropic)

  --threshold <num>     gate on confusable pairs at this cosine (mock-embedder
                        starting point: ${MOCK_EMBEDDER_CALIBRATION.confusabilityThreshold}). Without it, similarity is
                        REPORT-ONLY and only structural findings gate.
  --watch-band <num>    advisory band below the threshold (default ${MOCK_EMBEDDER_CALIBRATION.watchBand} with --threshold)
  --strict              structural warnings also fail the gate
  --no-similarity       skip the similarity analysis entirely
  --top <n>             ranked pairs to print (default 10)
  --json                print the full report as JSON instead of text

exit codes: 0 ok · 1 findings failed the gate · 2 usage/input error`;

/**
 * Normalize any of the recognized tool-list JSON shapes to the lint's
 * plain catalog. Throws (with a shape description) on unrecognized
 * input — the CLI maps that to exit code 2.
 */
export function coerceCatalog(json: unknown): readonly CatalogTool[] {
  // { tools: [...] } — MCP `tools/list` result envelope.
  const list = Array.isArray(json)
    ? json
    : json !== null &&
      typeof json === 'object' &&
      Array.isArray((json as { tools?: unknown }).tools)
    ? (json as { tools: unknown[] }).tools
    : undefined;
  if (list === undefined) {
    throw new Error('expected a JSON array of tools or { tools: [...] }');
  }
  return list.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`tools[${index}] is not an object`);
    }
    const entry = raw as Record<string, unknown>;
    // OpenAI: { type: 'function', function: { name, description, parameters } }
    const fn =
      entry.type === 'function' && entry.function !== null && typeof entry.function === 'object'
        ? (entry.function as Record<string, unknown>)
        : entry;
    const name = fn.name;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`tools[${index}] has no string 'name'`);
    }
    const description = typeof fn.description === 'string' ? fn.description : undefined;
    // inputSchema (MCP/ours) | input_schema (Anthropic) | parameters (OpenAI)
    const schema = fn.inputSchema ?? fn.input_schema ?? fn.parameters;
    const inputSchema =
      schema !== null && typeof schema === 'object'
        ? (schema as Readonly<Record<string, unknown>>)
        : undefined;
    return {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(inputSchema !== undefined ? { inputSchema } : {}),
    };
  });
}

interface ParsedArgs {
  readonly file: string;
  readonly threshold?: number;
  readonly watchBand?: number;
  readonly strict: boolean;
  readonly similarity: boolean;
  readonly top: number;
  readonly json: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let file: string | undefined;
  let threshold: number | undefined;
  let watchBand: number | undefined;
  let strict = false;
  let similarity = true;
  let top = 10;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const numberFlag = (name: string): number => {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value)) throw new Error(`${name} expects a number`);
      return value;
    };
    if (arg === '--threshold') threshold = numberFlag('--threshold');
    else if (arg === '--watch-band') watchBand = numberFlag('--watch-band');
    else if (arg === '--strict') strict = true;
    else if (arg === '--no-similarity') similarity = false;
    else if (arg === '--top') top = numberFlag('--top');
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') throw new Error(USAGE);
    else if (arg.startsWith('-')) throw new Error(`unknown flag '${arg}'\n\n${USAGE}`);
    else if (file === undefined) file = arg;
    else throw new Error(`unexpected extra argument '${arg}'\n\n${USAGE}`);
  }
  if (file === undefined) throw new Error(USAGE);
  return {
    file,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(watchBand !== undefined ? { watchBand } : {}),
    strict,
    similarity,
    top,
    json,
  };
}

/**
 * Run the lint CLI. Returns the exit code (never calls `process.exit` —
 * the bin wrapper assigns it to `process.exitCode`).
 */
export async function runToolLintCli(
  argv: readonly string[],
  io: ToolLintCliIO = {
    // eslint-disable-next-line no-console
    stdout: (line) => console.log(line),
    // eslint-disable-next-line no-console
    stderr: (line) => console.error(line),
  },
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr((error as Error).message);
    return 2;
  }

  let catalog: readonly CatalogTool[];
  try {
    catalog = coerceCatalog(JSON.parse(await readFile(args.file, 'utf8')));
  } catch (error) {
    io.stderr(`agentfootprint-lint-tools: ${args.file}: ${(error as Error).message}`);
    return 2;
  }

  // Without --threshold the mock-embedder similarity is REPORT-ONLY:
  // rank pairs at an unreachable threshold (no 'confusable'/'watch'
  // verdicts) so only the relative-ordering section prints.
  const gateOnSimilarity = args.threshold !== undefined;
  const threshold = args.threshold ?? Infinity;
  const watchBand = args.watchBand ?? (gateOnSimilarity ? MOCK_EMBEDDER_CALIBRATION.watchBand : 0);

  const report = await analyzeToolCatalog(catalog, {
    ...(args.similarity ? { embedder: mockEmbedder() } : {}),
    confusabilityThreshold: threshold,
    watchBand,
    failOn: args.strict ? 'warn' : 'error',
  });

  if (args.json) {
    io.stdout(JSON.stringify(report, null, 2));
  } else {
    if (args.similarity) {
      io.stdout(
        gateOnSimilarity
          ? '⚠ similarity uses the built-in deterministic mock embedder — you own the ' +
              'calibration of --threshold (cosine ranges are per-embedder; mock compresses ' +
              'prose to ~0.85–0.97). Trust relative ordering first.'
          : 'ℹ similarity is REPORT-ONLY (no --threshold): ranked pairs below are the ' +
              'relative-ordering view from the built-in mock embedder. Pass --threshold ' +
              `(mock starting point ${MOCK_EMBEDDER_CALIBRATION.confusabilityThreshold}) to gate on confusable pairs.`,
      );
      io.stdout('');
    }
    io.stdout(formatToolCatalogReport(report, { topPairs: args.top }));
  }

  return report.ok ? 0 : 1;
}
