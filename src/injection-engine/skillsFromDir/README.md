# Skill-file frontmatter

This sealed folder parses one authored `SKILL.md` into data. Only
`../skillsFromDir.ts` and files in this folder import its implementation.
It reads no directory, resolves no tool implementation and evaluates no code.

| File | Responsibility |
| --- | --- |
| `frontmatter.ts` | The existing scalar/list grammar, skill-name check and private parsed-file shape; exports only the parser and its result type for the facade. |
| `frontmatter.test.ts` | Adjacent behavior checks for the grammar and its named refusals. |
| `../skillsFromDir.ts` | Public declarations, local-path admission, lazy filesystem reads, stable ordering, collisions and caller-owned tool resolution. |
| `../skillsFromDirRoutes.ts` | Existing route grammar and graph-edge resolution; its implementation stays in place. |

The parser's decisions retain their original owners:

| Decision | Owner |
| --- | --- |
| Fences, required scalars, skill-name charset and nonempty body | `parseSkillFile` |
| Comments, blank lines, quoted scalars and block-list line numbers | `parseFrontmatterFields`, `readScalar`, `unquote` |
| Declared names, duplicate tools, ordered steps and skip policy | `readToolNames`, `readSteps`, `readOnSkip` |
| Routes must be a list; guards remain data | `readRoutes` delegates to `readDeclaredRoutes` in the existing route module |

This is Stage A / step 1: twelve private declarations moved whole, with their
comments and blank lines. The public declarations and directory/tool boundaries
stay in the facade. There is no new API, grammar, flow or compatibility path.
Both source files are below the 600-line limit, so the facade's old size-baseline
entry is removed. The shared parent README is outside this change.

Integration coverage stays in `test/injection-engine/skillsFromDir.test.ts` and
`test/injection-engine/skillsFromDirRunbook.test.ts`; it exercises both public
doors, directory loading, tool identity and runbook graph composition.
