# AgentBuilder setup owners

The public `AgentBuilder` facade keeps its constructor, fluent method signatures,
public documentation and existing object/prototype shape. Internal setup units
are grouped by the layer they configure. This folder is L9 orchestration; it
uses existing lower-layer ports rather than moving agent configuration into them.

## Responsibility and dependency map

| Owner                                                   | One rule                                                                                                | Dependencies                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `graph/`                                                | Skill-graph mount vocabulary and later mount consistency checks                                         | existing skill-brain and graph types                         |
| `observers/`                                            | A repeated observer reference is allowed; different references under one id are refused                 | watcher port                                                 |
| `consent/`                                              | Configured check-in has a possible declaring tool, unless a dynamic provider makes it unknowable        | tool registry, injection and provider ports                  |
| `tools/`                                                | Collect each known inner-run store once in registration order                                           | inner-run store port, static/skill tool declarations         |
| `skills/`                                               | Activation uses the real read-skill door; optional diagnostics describe inert or redundant declarations | injection metadata, dev-mode flag, scoped-tool target reader |
| `output/`                                               | Output retry counts are valid integers within the existing stated ceiling                               | no runtime dependency                                        |
| `prompt/`, `recipes/`, `settings/`, `thinking/`         | Validate one declaration and preserve provenance, conflict order and request settings                   | existing prompt, recipe and provider ports                   |
| `act/`, `window/`, `memory/`                            | Validate posture and summarizer coherence before attaching configuration                                | existing posture, window and memory contracts                |
| `injections/`, `maps/`, `claims/`                       | Register context and resolve graph-member and claim declarations                                        | existing injection, graph and engagement ports               |
| `evidence/`, `answer/`, `scripts/`, `honesty/`, `time/` | Resolve each explicit honesty arm through its existing rule owner                                       | existing evidence, script, assessment and clock resolvers    |
| `findings/`, `toolChoice/`, `ontology/`, `selfExplain/` | Mount declared governance and explanation capabilities without replacing another declaration            | existing lower-layer declarations and self-explain port      |
| `middleware/`                                           | Refuse a named link with no applicable hook                                                             | existing middleware hook grammar                             |
| `assembly/`                                             | Run ordered whole-agent validation, construction and observer attachment                                | existing Agent constructor and self-explain port             |

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

## Configuration and assembly design (steps 2 and 3)

Plain configuration functions receive live accessor ports over the actual
builder. Fields, initialization order, constructor dispatch, method declarations,
default expressions and public comments remain on the original class. Helpers
read live properties and call the original methods in their original order;
they do not copy state or introduce a superclass or another runtime context.
The facade's stateless accessors retain the original private field reads without
unused-field suppressions. `livePort.ts` defines lexical-arrow accessors without
reading any builder property at port creation. Delegated-method getters capture the method before
its arguments are evaluated and invoke it with the original receiver. Fluent
functions return that original receiver, never the accessor port.

Recipe application invokes a facade-bound callback at the original configure
line, after the application stack is pushed. Final assembly checks contracts,
stepped skills and deferred skill contracts at their original positions. The
facade retains the original Agent constructor argument expressions; assembly
passes only the existing local values at that point. Observer attachment and
self-explain binding remain after construction. Tests cover Proxy receivers,
subclass dispatch, callback timing, refusal order and unarmed reference identity.

The retained documented facade needs its own measured size disposition. It is
not complete merely because the business functions moved out, and no earlier
Agent facade ruling supplies this disposition.
