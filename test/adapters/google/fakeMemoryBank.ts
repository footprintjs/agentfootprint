/**
 * A faithful-enough Memory Bank double, shared by the memory-bank tests.
 *
 * Moved out of memory-bank-store.test.ts so a second test file can hold its
 * scope tests against the same double instead of a copy of it: a double that
 * drifts between two files would let one file pass against a bank the other
 * no longer models.
 */

/** A row as the service holds one. */
export interface Row {
  name: string;
  fact?: string;
  scope: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * A faithful-enough Memory Bank: rows in a map keyed by resource NAME, created
 * under a caller-supplied `memoryId`, **patched by name with no question about
 * whose row it is**, and retrieved by exact scope match.
 *
 * That one italicised behaviour is the service's, not a simplification — it is
 * why an adapter that addresses two identities' memories to one name silently
 * merges them, and why the addressing law is tested against a double that holds
 * state rather than against a recorder that lists calls.
 */
export function fakeBank() {
  const rows = new Map<string, Row>();
  const memories = {
    create: ({ parent, memoryId, requestBody }: Record<string, never>) => {
      const name = `${String(parent)}/memories/${String(memoryId)}`;
      if (rows.has(name)) throw { code: 409 };
      rows.set(name, { ...(requestBody as unknown as Row), name });
      return Promise.resolve({ data: { done: true } });
    },
    get: ({ name }: Record<string, never>) => {
      const row = rows.get(String(name));
      if (row === undefined) throw { code: 404 };
      return Promise.resolve({ data: row });
    },
    patch: ({ name, requestBody }: Record<string, never>) => {
      const row = rows.get(String(name));
      if (row === undefined) throw { code: 404 };
      // The service writes what it was told, to the row it was named. It never
      // checks the caller's scope against the row's — that is our job.
      rows.set(String(name), { ...row, ...(requestBody as unknown as Row) });
      return Promise.resolve({ data: { done: true } });
    },
    delete: ({ name }: Record<string, never>) => {
      if (!rows.delete(String(name))) throw { code: 404 };
      return Promise.resolve({ data: { done: true } });
    },
    list: () => Promise.resolve({ data: {} }),
    retrieve: ({ requestBody }: Record<string, never>) => {
      const wanted = (requestBody as unknown as { scope: Record<string, string> }).scope;
      const hits = [...rows.values()].filter((row) => exactScope(row.scope, wanted));
      return Promise.resolve({ data: { retrievedMemories: hits.map((memory) => ({ memory })) } });
    },
    operations: { wait: () => Promise.resolve({ data: { done: true } }) },
  };
  const client = { projects: { locations: { reasoningEngines: { sessions: {}, memories } } } };
  return {
    client: client as never,
    rows,
    names: () => [...rows.keys()],
    /** The one row there is, when a test means to assert on exactly one. */
    only: (): Row => {
      if (rows.size !== 1) throw new Error(`expected one row, found ${rows.size}`);
      return [...rows.values()][0]!;
    },
  };
}

/** Scope matching as the service does it: same keys, same values, no subsets. */
export function exactScope(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
