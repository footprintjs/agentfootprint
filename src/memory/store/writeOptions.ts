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
 *
 * One limit, stated: a store written before this existed ignores a third
 * argument it never knew about. `defineMemory` checks the declaration before
 * it ever passes one; a caller passing options to `put` directly should check
 * `store.writeOptions` the same way (`refuseUnhonouredWriteOptions`).
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
 * sentence, so every such store refuses in the same words, remedy included.
 */
export const NO_SERVER_EXTRACTION =
  'it keeps exactly the entries it is given and derives no long-term records from ' +
  'them — there is no extraction to skip and no derived namespace to scope (its ' +
  'tenant boundary is the identity tuple). Leave the option off for this store, or ' +
  'use a store that declares it in `writeOptions`';

/**
 * Thrown when a write asks for an option the store does not honour.
 *
 * Carries the store and the option by name; never a value — a namespace scope
 * names a tenant, and an error message is the one place a tenant id must not
 * travel. The remedy is in the store's own reason.
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
        'that honoured it.',
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
    assertExtraction(options.extraction);
    asked.push('extraction');
  }
  if (options.namespaceScope !== undefined) {
    assertScopeShape(options.namespaceScope);
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
 * @param why      why this store cannot honour what it does not declare, and
 *                 what to do instead
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
   * The namespace scope of every write: one computed from the identity the
   * write is for — `(identity) => ({ tenantid: … })`, the multi-tenant shape —
   * or a fixed object, which is right only for a deployment that serves ONE
   * tenant. Keep the function one-to-one (see
   * {@link MemoryWriteOptions.namespaceScope}); a store may ship an encoder
   * into its own alphabet (`agentCoreNamespaceValue` for AgentCore). A write
   * whose scope comes back empty or malformed is refused, never sent without it.
   */
  readonly namespaceScope?:
    | Readonly<Record<string, string>>
    | ((identity: MemoryIdentity) => Readonly<Record<string, string>>);
}

/**
 * Refuse a memory's write options at DEFINITION time when its store does not
 * declare them, or when a fixed one is malformed — the first turn should not be
 * where a configuration that can never work is discovered.
 *
 * @throws {UnsupportedMemoryWriteOptionError} naming the store and the option
 * @throws {TypeError} for a malformed option
 */
export function assertStoreHonours(
  store: MemoryStore,
  config: MemoryWriteOptionsConfig,
  caller: string,
): void {
  const asked: MemoryWriteOptionName[] = [];
  if (config.extraction !== undefined) {
    assertExtraction(config.extraction);
    asked.push('extraction');
  }
  if (config.namespaceScope !== undefined) {
    if (typeof config.namespaceScope !== 'function') {
      assertScopeShape(config.namespaceScope);
      assertNonEmptyScope(config.namespaceScope, caller);
    }
    asked.push('namespaceScope');
  }
  for (const option of asked) {
    if (!(store.writeOptions ?? []).includes(option)) {
      throw new UnsupportedMemoryWriteOptionError(
        storeName(store),
        option,
        `it does not declare \`${option}\` in \`writeOptions\` (checked by ${caller}, before ` +
          'any turn ran). A store that declares it can take it; otherwise leave the option off',
      );
    }
  }
}

/**
 * The store with the memory's write options applied to every write it makes.
 *
 * Reads, declarations and everything else pass straight through, so the
 * pipeline cannot tell the difference — except that `put`, `putMany` and
 * `putIfVersion` now carry the options. A call's own option overrides the
 * bound one only where it asks for something: an `undefined` field or an empty
 * scope never erases what the memory was configured with.
 *
 * @throws (at a write) a `TypeError` when the configured scope function returns
 *   an empty or malformed scope — the write is refused rather than sent with
 *   its derived records outside every tenant's namespace.
 */
export function bindWriteOptions(
  store: MemoryStore,
  config: MemoryWriteOptionsConfig,
): MemoryStore {
  const resolve = (identity: MemoryIdentity, own?: MemoryWriteOptions): MemoryWriteOptions => {
    const scope = boundScope(config, identity);
    return {
      ...(config.extraction !== undefined && { extraction: config.extraction }),
      ...(scope !== undefined && { namespaceScope: scope }),
      ...(own?.extraction !== undefined && { extraction: own.extraction }),
      ...(own?.namespaceScope !== undefined &&
        Object.keys(own.namespaceScope).length > 0 && { namespaceScope: own.namespaceScope }),
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
    ) =>
      // The port's empty-batch law: no write, so nothing to resolve or refuse.
      entries.length === 0
        ? store.putMany(identity, entries)
        : store.putMany(identity, entries, resolve(identity, own)),
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

// ── Checks ─────────────────────────────────────────────────────────────

/** The configured scope for this identity — present, plain, non-empty, or refused. */
function boundScope(
  config: MemoryWriteOptionsConfig,
  identity: MemoryIdentity,
): Readonly<Record<string, string>> | undefined {
  if (config.namespaceScope === undefined) return undefined;
  const scope =
    typeof config.namespaceScope === 'function'
      ? config.namespaceScope(identity)
      : config.namespaceScope;
  assertScopeShape(scope);
  assertNonEmptyScope(scope, 'this write');
  return scope;
}

function assertExtraction(value: unknown): void {
  if (value !== 'skip') {
    throw new TypeError(
      "[memory] the write option `extraction` takes one value, 'skip' — got " +
        `${typeof value === 'string' ? JSON.stringify(value) : typeof value}.`,
    );
  }
}

function assertScopeShape(value: unknown): asserts value is Readonly<Record<string, string>> {
  if (!isStringRecord(value)) {
    throw new TypeError(
      '[memory] the write option `namespaceScope` must be a plain object of string values ' +
        '(variable name → value). The value given is not quoted here: it names a tenant.',
    );
  }
}

function assertNonEmptyScope(scope: Readonly<Record<string, string>>, where: string): void {
  if (Object.keys(scope).length === 0) {
    throw new TypeError(
      `[memory] the memory's \`namespaceScope\` came back EMPTY for ${where}. It is refused ` +
        'rather than sent without one: a write with no scope files its derived records outside ' +
        'every tenant’s namespace. Return the scope for every identity, or refuse the identity ' +
        'yourself.',
    );
  }
}

/** The store's own name for a refusal — its class, or what the caller holds. */
function storeName(store: MemoryStore): string {
  const ctor = (store as { constructor?: { name?: string } }).constructor?.name;
  return ctor !== undefined && ctor !== 'Object' && ctor !== '' ? ctor : 'the store you passed';
}

/** A PLAIN object (no class, no Map, no Promise) whose own values are all strings. */
function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}
