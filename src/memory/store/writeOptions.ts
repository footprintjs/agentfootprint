/**
 * Write options — what a write asks a MANAGED memory service to do with an entry
 * after it is stored, in names that belong to no vendor.
 *
 * Pattern: port vocabulary + guard clauses over a declared capability.
 * Role:    memory/store layer, beside the port it extends.
 * Emits:   N/A.
 *
 * ── Why these exist ──────────────────────────────────────────────────────────
 * A managed memory service does more than keep what it is handed: it EXTRACTS
 * long-term records from it — facts, summaries, preferences — and files them
 * under namespaces. Two things about that are the caller's to decide, per write:
 *
 *   `extraction: 'skip'`  keep this entry where it was written, and derive
 *                         nothing long-term from it (a turn that must not
 *                         become a remembered "fact", a scratch note).
 *   `namespaceScope`      the values the service substitutes into the
 *                         namespaces its DERIVED records are filed under — the
 *                         per-tenant scope of what it learns.
 *
 * ── The law: honoured, or refused by name — never ignored ────────────────────
 * A store DECLARES the options it honours (`MemoryStore.writeOptions`); every
 * other option is refused by name, at the call, with the reason. Ignoring one
 * is the failure this exists to prevent: a write that silently dropped
 * `namespaceScope` files one tenant's derived records where another tenant's
 * are read, and a dropped `'skip'` turns a turn the caller kept out of
 * long-term memory into a remembered fact. Both look exactly like working.
 *
 * Absence of the declaration means "honours none" — the opposite of the
 * `supportsVectorSearch` default — because there an undeclared store changes
 * nothing, and here an undeclared store would quietly drop what was asked.
 */
import type { MemoryEntry } from '../entry/index.js';
import type { MemoryIdentity } from '../identity/index.js';
import type { ListOptions, MemoryStore, ScoredEntry, SearchOptions } from './types.js';

/** What one write asks of the store, beyond keeping the entry. */
export interface MemoryWriteOptions {
  /**
   * `'skip'` — store the entry, but keep it out of long-term extraction: the
   * service must derive nothing (no fact, summary or preference) from it. It
   * stays readable where it was written (`get`, `list`).
   */
  readonly extraction?: 'skip';
  /**
   * The values a store substitutes into the namespaces its DERIVED long-term
   * records are filed under — one tenant's scope, typically
   * `{ tenantid: 'acme' }`. Which keys exist is the store's configuration.
   *
   * Keep the mapping from your tenant to these values ONE-TO-ONE: a mapping
   * that lowercases, trims or truncates a tenant id files two tenants' derived
   * records under one namespace. An empty object asks for nothing.
   */
  readonly namespaceScope?: Readonly<Record<string, string>>;
}

/** The name of one write option — what a store declares it honours. */
export type MemoryWriteOptionName = keyof MemoryWriteOptions;

/** Every write option, in the order refusals name them. */
export const MEMORY_WRITE_OPTION_NAMES: readonly MemoryWriteOptionName[] = [
  'extraction',
  'namespaceScope',
];

/**
 * The reason a store with NO server-side extraction gives — the shared
 * sentence, so every such store refuses in the same words.
 */
export const NO_SERVER_EXTRACTION =
  'it keeps exactly the entries it is given and derives no long-term records from ' +
  'them — there is no extraction to skip and no derived namespace to scope (its ' +
  'tenant boundary is the identity tuple)';

/**
 * Thrown when a write asks for an option the store does not honour.
 *
 * Carries the store and the option by name; never a value — a namespace scope
 * names a tenant, and an error message is the one place a tenant id must not
 * travel.
 */
export class UnsupportedMemoryWriteOptionError extends Error {
  readonly code = 'ERR_UNSUPPORTED_MEMORY_WRITE_OPTION' as const;
  /** The store that refused, e.g. `'InMemoryStore'`. */
  readonly store: string;
  /** The option it cannot honour. */
  readonly option: MemoryWriteOptionName;

  constructor(store: string, option: MemoryWriteOptionName, why: string) {
    super(
      `[memory] ${store} cannot honour the write option \`${option}\`: ${why}. It is ` +
        'refused rather than ignored — a write that dropped it would look exactly like one ' +
        'that honoured it. A store that declares it in `writeOptions` can take it ' +
        '(AgentCoreStore honours both); for this store, leave the option off.',
    );
    this.name = 'UnsupportedMemoryWriteOptionError';
    this.store = store;
    this.option = option;
  }
}

/**
 * The options this write actually asks for, its values checked.
 *
 * A field that is `undefined` is not asked for; an empty `namespaceScope` asks
 * for nothing either. A value of the wrong shape is a programming error, so it
 * throws a `TypeError` naming the option — and never echoes the value.
 */
export function requestedWriteOptions(options?: MemoryWriteOptions): MemoryWriteOptionName[] {
  if (options === undefined || options === null) return [];
  const asked: MemoryWriteOptionName[] = [];
  if (options.extraction !== undefined) {
    if (options.extraction !== 'skip') {
      throw new TypeError(
        "[memory] the write option `extraction` takes one value, 'skip' — got " +
          `${
            typeof options.extraction === 'string'
              ? JSON.stringify(options.extraction)
              : typeof options.extraction
          }.`,
      );
    }
    asked.push('extraction');
  }
  if (options.namespaceScope !== undefined) {
    if (!isStringRecord(options.namespaceScope)) {
      throw new TypeError(
        '[memory] the write option `namespaceScope` must be an object of string values ' +
          '(variable name → value). The value given is not quoted here: it names a tenant.',
      );
    }
    if (Object.keys(options.namespaceScope).length > 0) asked.push('namespaceScope');
  }
  return asked;
}

/**
 * Refuse, by name, every write option `options` asks for that `honoured` does
 * not contain. Call it first thing in `put`, `putMany` and `putIfVersion` —
 * before anything is written.
 *
 * @param store    the store's name, as the refusal should say it
 * @param honoured the store's own declaration (`MemoryStore.writeOptions`)
 * @param options  what this write asked for
 * @param why      why this store cannot honour what it does not declare
 * @throws {UnsupportedMemoryWriteOptionError} for the first option not honoured
 */
export function refuseUnhonouredWriteOptions(
  store: string,
  honoured: readonly MemoryWriteOptionName[] | undefined,
  options: MemoryWriteOptions | undefined,
  why: string,
): void {
  for (const option of requestedWriteOptions(options)) {
    if (!(honoured ?? []).includes(option)) {
      throw new UnsupportedMemoryWriteOptionError(store, option, why);
    }
  }
}

// ── Binding options to a memory's writes (`defineMemory({ writeOptions })`) ──

/**
 * Write options for every write a memory makes — fixed, or per identity for
 * the namespace scope, which is usually one tenant's.
 */
export interface MemoryWriteOptionsConfig {
  /** `'skip'` keeps every write of this memory out of long-term extraction. */
  readonly extraction?: 'skip';
  /**
   * The namespace scope of every write — a fixed one, or one computed from the
   * identity the write is for (`(identity) => ({ tenantid: tenantSlug(identity.tenant) })`).
   * Keep that function one-to-one; see {@link MemoryWriteOptions.namespaceScope}.
   */
  readonly namespaceScope?:
    | Readonly<Record<string, string>>
    | ((identity: MemoryIdentity) => Readonly<Record<string, string>>);
}

/**
 * Refuse a memory's write options at DEFINITION time when its store does not
 * declare them — the first turn should not be where a configuration that can
 * never work is discovered.
 *
 * @throws {UnsupportedMemoryWriteOptionError} naming the store and the option
 */
export function assertStoreHonours(
  store: MemoryStore,
  config: MemoryWriteOptionsConfig,
  caller: string,
): void {
  const asked: MemoryWriteOptionName[] = [];
  if (config.extraction !== undefined) {
    requestedWriteOptions({ extraction: config.extraction });
    asked.push('extraction');
  }
  if (config.namespaceScope !== undefined) asked.push('namespaceScope');
  for (const option of asked) {
    if (!(store.writeOptions ?? []).includes(option)) {
      throw new UnsupportedMemoryWriteOptionError(
        storeName(store),
        option,
        `it does not declare \`${option}\` in \`writeOptions\` (checked by ${caller}, before ` +
          'any turn ran)',
      );
    }
  }
}

/**
 * The store with the memory's write options applied to every write it makes.
 *
 * Reads, declarations and everything else pass straight through, so the
 * pipeline cannot tell the difference — except that `put`, `putMany` and
 * `putIfVersion` now carry the options. An option a call passes itself wins
 * over the bound one.
 */
export function bindWriteOptions(
  store: MemoryStore,
  config: MemoryWriteOptionsConfig,
): MemoryStore {
  const resolve = (identity: MemoryIdentity, own?: MemoryWriteOptions): MemoryWriteOptions => {
    const scope =
      typeof config.namespaceScope === 'function'
        ? config.namespaceScope(identity)
        : config.namespaceScope;
    return {
      ...(config.extraction !== undefined && { extraction: config.extraction }),
      ...(scope !== undefined && { namespaceScope: scope }),
      ...own,
    };
  };
  const bound: MemoryStore = {
    ...(store.supportsVectorSearch !== undefined && {
      supportsVectorSearch: store.supportsVectorSearch,
    }),
    ...(store.ranksBy !== undefined && { ranksBy: store.ranksBy }),
    ...(store.writeOptions !== undefined && { writeOptions: store.writeOptions }),
    get: <T>(identity: MemoryIdentity, id: string) => store.get<T>(identity, id),
    put: <T>(identity: MemoryIdentity, entry: MemoryEntry<T>, own?: MemoryWriteOptions) =>
      store.put(identity, entry, resolve(identity, own)),
    putMany: <T>(
      identity: MemoryIdentity,
      entries: readonly MemoryEntry<T>[],
      own?: MemoryWriteOptions,
    ) => store.putMany(identity, entries, resolve(identity, own)),
    putIfVersion: <T>(
      identity: MemoryIdentity,
      entry: MemoryEntry<T>,
      expectedVersion: number,
      own?: MemoryWriteOptions,
    ) => store.putIfVersion(identity, entry, expectedVersion, resolve(identity, own)),
    list: <T>(identity: MemoryIdentity, options?: ListOptions) => store.list<T>(identity, options),
    delete: (identity, id) => store.delete(identity, id),
    seen: (identity, signature) => store.seen(identity, signature),
    recordSignature: (identity, signature) => store.recordSignature(identity, signature),
    feedback: (identity, id, usefulness) => store.feedback(identity, id, usefulness),
    getFeedback: (identity, id) => store.getFeedback(identity, id),
    forget: (identity) => store.forget(identity),
    // Present exactly when the store's is: `if (store.search)` is how callers
    // feature-detect it, so the bound store must not grow or lose one.
    ...(store.search !== undefined && {
      search: <T>(
        identity: MemoryIdentity,
        query: readonly number[],
        options?: SearchOptions,
      ): Promise<readonly ScoredEntry<T>[]> =>
        (store as Required<Pick<MemoryStore, 'search'>>).search<T>(identity, query, options),
    }),
  };
  return bound;
}

/** The store's own name for a refusal — its class, or a generic word. */
function storeName(store: MemoryStore): string {
  const ctor = (store as { constructor?: { name?: string } }).constructor?.name;
  return ctor !== undefined && ctor !== 'Object' && ctor !== '' ? ctor : 'this store';
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}
