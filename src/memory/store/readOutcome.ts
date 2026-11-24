/** Select one store read. A reported timeout does not trigger a legacy read. */
import type { MemoryIdentity } from '../identity/types.js';
import type {
  ListOptions,
  ListResult,
  MemoryReadOutcome,
  MemoryStore,
  SearchOptions,
  SearchResultEntry,
} from './types.js';

function settled<T>(outcome: MemoryReadOutcome<T>, signal?: AbortSignal): MemoryReadOutcome<T> {
  if (!outcome.ok) {
    signal?.throwIfAborted();
    if (outcome.code !== 'timeout') throw new TypeError('Unknown memory store read outcome.');
  }
  return outcome;
}

export async function readMemorySearch<T>(
  store: MemoryStore,
  identity: MemoryIdentity,
  query: readonly number[],
  options: SearchOptions,
  signal?: AbortSignal,
): Promise<MemoryReadOutcome<readonly SearchResultEntry<T>[]>> {
  if (store.searchWithOutcome !== undefined) {
    signal?.throwIfAborted();
    return settled(await store.searchWithOutcome<T>(identity, query, options), signal);
  }
  if (store.search === undefined) throw new TypeError('The memory store does not support search.');
  return { ok: true, value: await store.search<T>(identity, query, options) };
}

export async function readMemoryList<T>(
  store: MemoryStore,
  identity: MemoryIdentity,
  options: ListOptions,
  signal?: AbortSignal,
): Promise<MemoryReadOutcome<ListResult<T>>> {
  if (store.listWithOutcome !== undefined) {
    signal?.throwIfAborted();
    return settled(await store.listWithOutcome<T>(identity, options), signal);
  }
  return { ok: true, value: await store.list<T>(identity, options) };
}

export function supportsRecallSearch(store: MemoryStore): boolean {
  return store.searchWithOutcome !== undefined || store.search !== undefined;
}
