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
 * rather than imported. Compare the resolved file path against `process.argv[1]`.
 *
 * Browser-safe: returns `false` when `process` is unavailable (e.g. when the
 * playground bundles examples for in-browser execution). The dynamic require
 * pattern keeps Vite from eagerly bundling Node's `url` module — Vite's
 * static analyzer can't follow `Function('return require')`, so the import
 * stays Node-only.
 */
export function isCliEntry(importMetaUrl: string): boolean {
  if (typeof process === 'undefined' || !process.argv?.[1]) return false;
  try {
    // Lazy + dynamic so Vite's static analyzer doesn't try to bundle 'url'.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fileURLToPath } = (Function('return require'))()('url');
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
