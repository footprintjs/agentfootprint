/**
 * Shared helpers for example CLI entry points.
 *
 * Every example file exports a `run(input, provider?)` factory plus a `meta`
 * object. When executed directly via `npx tsx examples/...`, the file's
 * bottom-of-file guard calls `run(meta.defaultInput)` so humans can try it
 * with zero ceremony. When imported (by the playground, by tests, or by
 * another example), the guard skips and the caller invokes `run()` with
 * whatever provider they've selected.
 */

/**
 * True if the current module is being executed directly (e.g. `npx tsx file.ts`)
 * rather than imported. Compare the resolved file path rather than the raw
 * `import.meta.url` because the URL carries a `file://` scheme and
 * `process.argv[1]` is a plain filesystem path.
 *
 * In the browser (where `process` doesn't exist) this always returns `false`
 * so examples can be imported as modules in playgrounds and bundlers without
 * pulling in Node's `url` module.
 */
export function isCliEntry(importMetaUrl: string): boolean {
  // Browser-safe guard: bail out before touching `process` or `url`.
  if (typeof process === 'undefined' || !process.argv) return false;
  try {
    // Dynamic require so bundlers don't hoist `url` into a browser graph.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fileURLToPath } = require('url') as typeof import('url');
    return fileURLToPath(importMetaUrl) === process.argv[1];
  } catch {
    return false;
  }
}

/** Minimal pretty-printer for CLI output — stringifies objects, passes strings through. */
export function printResult(result: unknown): void {
  if (typeof result === 'string') {
    console.log(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

/** Standard shape every example's `meta` export declares. */
export interface ExampleMeta {
  /** Stable id — matches the folder-relative path, e.g. `concepts/02-agent`. */
  readonly id: string;
  /** Human-readable title shown in the playground catalog. */
  readonly title: string;
  /** Folder name — `concepts`, `patterns`, `providers`, etc. */
  readonly group: string;
  /** One-line description for tooltips. */
  readonly description: string;
  /** Default user input — used by the CLI guard and as placeholder in the playground. */
  readonly defaultInput: string | null;
  /**
   * Which provider slots the example exposes.
   *  - `['default']`  — single provider (most examples)
   *  - `['planner', 'executor']` — multi-provider composition (e.g. planExecute)
   *  - `[]`           — example doesn't use an LLM (e.g. tool registry)
   */
  readonly providerSlots: readonly string[];
  /** Concepts / features this example demonstrates — drives the playground catalog filters. */
  readonly tags: readonly string[];
}
