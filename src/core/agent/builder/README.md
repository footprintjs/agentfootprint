# AgentBuilder setup owners

The public `AgentBuilder` facade keeps its constructor, fluent method signatures,
public documentation and existing object/prototype shape. Internal setup units
are grouped by the layer they configure. This folder is L9 orchestration; it
uses existing lower-layer ports rather than moving agent configuration into them.

## Responsibility and dependency map

| Owner | One rule | Dependencies |
| --- | --- | --- |
| `graph/` | Skill-graph mount vocabulary and later mount consistency checks | existing skill-brain and graph types |
| `observers/` | A repeated observer reference is allowed; different references under one id are refused | watcher port |
| `consent/` | Configured check-in has a possible declaring tool, unless a dynamic provider makes it unknowable | tool registry, injection and provider ports |
| `tools/` | Collect each known inner-run store once in registration order | inner-run store port, static/skill tool declarations |
| `skills/` | Activation uses the real read-skill door; optional diagnostics describe inert or redundant declarations | injection metadata, dev-mode flag, scoped-tool target reader |
| `output/` | Output retry counts are valid integers within the existing stated ceiling | no runtime dependency |
| later configuration owners | Window/memory, recipes, governance and honesty setup retain their existing ordering and live references | existing layer resolvers and narrow setup capabilities |
| later final assembly | Ordered build validation, agent construction and observer attachment remain one wiring path | existing Agent constructor and self-explain port |

The existing Agent-to-builder runtime cycle is delayed until create/build.
Helpers never import the facade back. The existing type-only self-explain seam
must not spread into new owners. Sibling owners do not import one another in
both directions. No new barrel or public package door is introduced.

## Split order and limits

Step 1 moves the standalone options interface, seven footer helpers and the
retry constant as whole units. Original bodies, comments, refusal strings and
blank lines stay intact; only internal export/import wiring changes. Tests
reading a moved unit's source follow its new owner. Public builder method
readers keep their existing facade path.

Steps 2 and 3 then extract configuration/business units before cross-cutting
assembly, leaving documented wiring. They require an exact structural review;
step 1 is not completion of this oversized file. Public documentation alone
exceeds the normal file-size limit, so a retained facade above that limit needs
its own explicit disposition. No other facade's exception applies here. The
limit is never met by shortening comments, deleting blank lines, inventing a
superclass or changing the public type chain.

Hosted CI supplies the full gates. Adjacent tests pin the moved rules; existing
public behavior and golden fixtures remain unchanged.
