/** A detached copy with one state key gone from every log and every base. */
export function stripKey<T>(recording: T, key: string): T {
  type Bundle = { trace: { path: string }[]; overwrite: Record<string, unknown> };
  type Log = { commitLog?: Bundle[]; history?: Bundle[]; initialState?: Record<string, unknown> };
  const copy = JSON.parse(JSON.stringify(recording)) as T & {
    subflowResults?: Record<string, { treeContext?: Log }>;
  };
  const scrub = (log: Log | undefined): void => {
    if (!log) return;
    for (const bundle of [...(log.commitLog ?? []), ...(log.history ?? [])]) {
      bundle.trace = bundle.trace.filter((t) => t.path !== key);
      delete bundle.overwrite[key];
    }
    if (log.initialState) delete log.initialState[key];
  };
  scrub(copy as Log);
  for (const entry of Object.values(copy.subflowResults ?? {})) scrub(entry?.treeContext);
  return copy;
}

/**
 * A detached copy with one state key REWRITTEN wherever the log wrote it.
 *
 * The other half of `stripKey`, and the crafted damage the second cause needs:
 * no run produces a recording whose receipt key holds a non-receipt, because
 * the mint either runs or does not. A truncated file, a hand-edited log or a
 * consumer that wrote its own value under the key does — and that is the case
 * the read refuses, so it is the case a test has to construct.
 */
export function rewriteKey<T>(recording: T, key: string, value: unknown): T {
  type Bundle = { trace: { path: string }[]; overwrite: Record<string, unknown> };
  type Log = { commitLog?: Bundle[]; history?: Bundle[]; initialState?: Record<string, unknown> };
  const copy = JSON.parse(JSON.stringify(recording)) as T & {
    subflowResults?: Record<string, { treeContext?: Log }>;
  };
  const rewrite = (log: Log | undefined): void => {
    if (!log) return;
    for (const bundle of [...(log.commitLog ?? []), ...(log.history ?? [])]) {
      if (bundle.trace.some((t) => t.path === key)) bundle.overwrite[key] = value;
    }
    if (log.initialState && key in log.initialState) log.initialState[key] = value;
  };
  rewrite(copy as Log);
  for (const entry of Object.values(copy.subflowResults ?? {})) rewrite(entry?.treeContext);
  return copy;
}

/** A detached copy with every fold base gone — `getSnapshot({ redact: true })`
 *  hands back this shape, and so does any recording that travelled without it. */
export function stripBases<T>(recording: T): T {
  type Log = { initialState?: unknown };
  const copy = JSON.parse(JSON.stringify(recording)) as T & {
    subflowResults?: Record<string, { treeContext?: Log }>;
  };
  delete (copy as Log).initialState;
  for (const entry of Object.values(copy.subflowResults ?? {})) {
    if (entry?.treeContext) delete entry.treeContext.initialState;
  }
  return copy;
}
