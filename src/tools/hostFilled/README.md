**Lens** — copies the model-visible tool schema and preserves its existing field-hiding refusals. A field is refused when another schema position would expose it.

# Host-filled schema helpers

This sealed folder owns only the schema helpers used by [the hostFilled facade](../hostFilled.ts). It reads schema data and returns predicates or a shallow schema copy; it performs no credential lookup, tool execution, registry mutation or result scrubbing.

## Files and roles

- `schema.ts`: `mentionsElsewhere` walks every other schema position; `declaresAtRoot` walks only root combinators and definitions. `refuseNested` keeps their existing refusal. `withoutFields` copies root properties and required names for the model's view.
- `schema.test.ts`: adjacent controls for the two traversal meanings, dependency forms, cyclic graphs, exact refusal text, nonmutation and retained references.

The facade imports these four internal helpers. The only child dependency is the canonical `Tool` type from `../tools.ts`; the child never imports its facade. No public export or package door is added.

## Scope and preserved behavior

This is Stage A, step 1: four whole private units moved with their comments and blank lines unchanged. Their traversal order, own-property checks, cycle handling, required-list behavior and refusal text stay the same. This split does not add schema validation or reference resolution.

The facade keeps the public types, factories, errors and overloads, the single `DECLARED_FILLS` registry, wrapping and dispatch, value resolution and all result/error scrubbing. Those remaining responsibilities fit below the file-size limit; later structural changes are outside this split.

## Behavior checks

- [Adjacent schema controls](schema.test.ts).
- [Public host-filled behavior and security boundaries](../../../test/tools/host-filled.test.ts).
- [Declaration and search composition](../../../test/tools/host-filled-search.test.ts).
