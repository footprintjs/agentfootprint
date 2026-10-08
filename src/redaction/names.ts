/**
 * names — the names a run's runner DECLARED, so the served path can tell a
 * declared name from one somebody invented.
 *
 * Pattern: a registry per run (never per module): the runner's build-time
 *          declarations, read-only and shared by its runs, plus what the run
 *          itself declares as it composes (the tools a provider delivered
 *          this iteration, and their arguments).
 * Role:    the data behind the `declaredName` kind (`events/content.ts`). A
 *          structure field of that kind is served only when its value names
 *          something declared; anything else — a tool name the model made up,
 *          an argument key it invented — is content, served as the
 *          placeholder under a policy that keeps the conversation out.
 *
 * Four spaces, each a closed set the app or the library declared:
 *
 *   - `tool`      — tool names: the registry's, a skill's, a provider's, the
 *                   library's own (`read_skill`, `skip_step`);
 *   - `argument`  — the property names in those tools' input schemas, at any
 *                   depth; an argument PATH names something declared when
 *                   every name in it does (indices are positions, not names);
 *   - `skill`     — skill ids;
 *   - `config`    — the names the runner was configured with: runner ids and
 *                   names, providers, models, memory and injection ids,
 *                   middleware, recipes, maps, credential services.
 *
 * It holds NAMES only, never a value of any run — and nothing here is
 * module state: every registry belongs to one run, or to one runner's
 * declarations.
 */

/** The space a declared name belongs to. */
export type NameSpace = 'tool' | 'argument' | 'skill' | 'config';

/** A runner's declarations, as data. */
export type NameDeclarations = { readonly [S in NameSpace]?: readonly string[] };

/** The question the served path asks. */
export interface DeclaredNames {
  /** Whether `name` (for `argument`, a path) names something declared in `space`. */
  has(space: NameSpace, name: string): boolean;
}

/** Nothing declared — every `declaredName` value is content. */
export const NO_DECLARED_NAMES: DeclaredNames = Object.freeze({ has: () => false });

/**
 * One run's names: `fixed` (the runner's build-time declarations) and what
 * the run declares as it goes (`declare`).
 */
export class RunNames implements DeclaredNames {
  private readonly declared: { readonly [S in NameSpace]: Set<string> } = {
    tool: new Set(),
    argument: new Set(),
    skill: new Set(),
    config: new Set(),
  };

  constructor(fixed: NameDeclarations = {}) {
    for (const space of NAME_SPACES) this.declare(space, fixed[space] ?? []);
  }

  /** Record names the run declared (a provider's tools, their argument names). */
  declare(space: NameSpace, names: Iterable<string>): void {
    const set = this.declared[space];
    for (const name of names) if (typeof name === 'string' && name.length > 0) set.add(name);
  }

  has(space: NameSpace, name: string): boolean {
    if (typeof name !== 'string' || name.length === 0) return false;
    const set = this.declared[space];
    if (space !== 'argument') return set.has(name);
    // An argument path names something declared when every NAME in it does.
    const segments = argumentPathNames(name);
    return segments.length > 0 && segments.every((segment) => set.has(segment));
  }
}

const NAME_SPACES: readonly NameSpace[] = Object.freeze(['tool', 'argument', 'skill', 'config']);

/**
 * The names in an argument path — `customer.ssn`, `items[0].pin`,
 * `/customer/ssn` — without the positions (`0`). A path that is ONLY
 * positions names nothing.
 */
export function argumentPathNames(path: string): readonly string[] {
  return path.split(/[.[\]/]+/).filter((segment) => segment.length > 0 && !/^\d+$/.test(segment));
}

/**
 * Every property name a JSON Schema declares, at any depth — `properties`,
 * `items`, `additionalProperties` objects, and the `anyOf` / `oneOf` /
 * `allOf` branches. Bounded by the schema itself; cycles are not followed.
 */
export function schemaPropertyNames(schema: unknown): readonly string[] {
  const names = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    const properties = record['properties'];
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
        names.add(key);
        walk(child);
      }
    }
    for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf']) {
      walk(record[key]);
    }
    const required = record['required'];
    if (Array.isArray(required)) {
      for (const key of required) if (typeof key === 'string') names.add(key);
    }
  };
  walk(schema);
  return [...names];
}

/** Two declarations as one. */
export function unionNames(...all: readonly (NameDeclarations | undefined)[]): NameDeclarations {
  const out: { [S in NameSpace]?: string[] } = {};
  for (const declarations of all) {
    if (declarations === undefined) continue;
    for (const space of NAME_SPACES) {
      const names = declarations[space];
      if (names === undefined || names.length === 0) continue;
      (out[space] ??= []).push(...names);
    }
  }
  return out;
}
