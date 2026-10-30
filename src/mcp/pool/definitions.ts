/**
 * definitions — the tool lists a pool serves, and when each stops being served.
 *
 * Pattern: one list type, two owners — a client incarnation, or a shared entry.
 * Role:    § 6 of the design. A definition is what one `tools/list` entry says:
 *          name, description, input schema, and the declarations its `_meta`
 *          carries. The executable half (the connection) is never shared.
 *
 *   - PER CLIENT (the default): a conversation's list is its own client's, and
 *     it belongs to that client INCARNATION alone — a replacement client, even
 *     one opened from the same plan, is a new session whose list may differ,
 *     so it lists again.
 *   - SHARED, only under the app's declared contract: one entry per context
 *     (`plan.ts`), listed on the client of whichever conversation needs it,
 *     bounded at `MAX_DEFINITION_ENTRIES` entries; a list longer than
 *     `MAX_SHARED_TOOLS` is used by its own client and not shared.
 *
 * A list stops being served in four ways, plus a time limit: the configuration
 * (a new context is a new list), the server's tools-changed notice, the app's
 * `permissionsChanged`, and `toolsChanged`. Invalidation moves the list's
 * GENERATION at once — every tool bound to an older one is refused — and marks
 * it to be listed again. A lapsed time limit lists again at the next list, and
 * moves the generation only if the new list differs. A generation counts within
 * one list: a replacement client and a new entry start counts of their own, and
 * a binding names the list it came from, so no number of an old list can match
 * a new one. A listing still in flight when its list's generation moved is
 * discarded, never written.
 *
 * Every list is a frozen plain-data copy (`mcp/plainData.ts` · `copyJsonObject`),
 * written once per generation, by one listing at a time.
 */

import { canonicalJson } from '../../lib/canonicalJson.js';
import type { Tool } from '../../tools/tools.js';
import { copyJsonObject } from '../plainData.js';
import type { McpListedTool } from '../types.js';
import { MAX_DEFINITION_ENTRIES } from './options.js';

/** One definition, frozen, and its canonical JSON — what "the same definition" compares. */
export interface Definition {
  readonly listed: McpListedTool;
  readonly canonical: string;
}

/** A frozen copy of `listed`, or `undefined` when it is not plain JSON data. */
export function definitionOf(listed: McpListedTool): Definition | undefined {
  const copy = copyJsonObject(listed);
  if (copy === undefined || typeof copy['name'] !== 'string') return undefined;
  return { listed: deepFreeze(copy) as unknown as McpListedTool, canonical: canonicalJson(copy) };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Sequence for list ids: a binding names the list it came from. */
let lists = 0;

/**
 * One list: an incarnation's own or a shared entry. Its `id` is stable for its
 * life; its `generation` moves on invalidation, and on a time-limit relisting
 * that changed it.
 */
export class DefinitionList {
  readonly id = `list-${++lists}`;
  private current: ReadonlyMap<string, Definition> = new Map();
  private tools: ReadonlyMap<string, Tool> = new Map();
  /** Has any listing been written? */
  private written = false;
  /** 0 until the first listing is written. */
  generation = 0;
  /** Invalidated: listed again before it is served. */
  stale = false;
  /** When it was last written, on the pool's clock. */
  listedAt = 0;
  /** The listing in flight, joined by anyone who needs the same list. */
  listing: Promise<void> | undefined;

  /** Can it be served at `now`, as it stands? */
  servable(now: number, ttlMs: number): boolean {
    return this.written && !this.stale && now - this.listedAt < ttlMs;
  }

  /**
   * Invalidate: every older binding is refused, the next list lists again, and
   * a listing in flight is discarded — even a first one, before anything was
   * written. Generations only ever increase.
   */
  invalidate(): void {
    this.generation += 1;
    this.stale = true;
  }

  /** The definition named `name`, at the current generation. */
  definition(name: string): Definition | undefined {
    return this.current.get(name);
  }

  /** The client's own wrapped tool named `name` (per-client lists only). */
  tool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Every definition, in listing order. */
  all(): readonly Definition[] {
    return [...this.current.values()];
  }

  /**
   * Write a listing that began at generation `began`. Refused — `false`, nothing
   * written — when the generation moved while it ran. A first write moves the
   * generation to a number no binding has seen; a write after invalidation keeps
   * the moved one; a time-limit rewrite moves it only when the list differs.
   */
  write(
    began: number,
    definitions: readonly Definition[],
    tools: readonly Tool[] | undefined,
    now: number,
  ): boolean {
    if (this.generation !== began) return false;
    const next = new Map(definitions.map((d) => [d.listed.name, d]));
    if (!this.written) this.generation += 1;
    else if (!this.stale && differs(this.current, next)) this.generation += 1;
    this.current = next;
    this.tools = new Map((tools ?? []).map((t) => [t.schema.name, t]));
    this.written = true;
    this.stale = false;
    this.listedAt = now;
    return true;
  }
}

function differs(a: ReadonlyMap<string, Definition>, b: ReadonlyMap<string, Definition>): boolean {
  if (a.size !== b.size) return true;
  for (const [name, definition] of a) {
    if (b.get(name)?.canonical !== definition.canonical) return true;
  }
  return false;
}

/** A shared entry: a list and the tenant its context carries. */
export interface SharedEntry {
  readonly list: DefinitionList;
  readonly tenant: string;
}

/**
 * The shared definition entries, by context — bounded at
 * `MAX_DEFINITION_ENTRIES`, the least recently used dropped first. A dropped
 * entry's bindings are refused as stale: the entry they name is gone.
 */
export class SharedDefinitions {
  private readonly entries = new Map<string, SharedEntry>();

  constructor(private readonly maxEntries: number = MAX_DEFINITION_ENTRIES) {}

  get size(): number {
    return this.entries.size;
  }

  /** The entry for `context`, created empty when there is none; most recently used. */
  entryFor(context: string, tenant: string): SharedEntry {
    let entry = this.entries.get(context);
    if (entry !== undefined) this.entries.delete(context);
    else entry = { list: new DefinitionList(), tenant };
    this.entries.set(context, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return entry;
  }

  /** The entry for `context` if it still exists — never created. */
  peek(context: string): SharedEntry | undefined {
    return this.entries.get(context);
  }

  /** Invalidate every entry `matches` selects. */
  invalidate(matches: (entry: SharedEntry) => boolean): void {
    for (const entry of this.entries.values()) if (matches(entry)) entry.list.invalidate();
  }
}
