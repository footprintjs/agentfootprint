# Skill-graph guide — moved

This file used to be a 460-line adopter guide, current as of **`agentfootprint@8.5.0`**.
It is no longer maintained, because keeping a third copy of the same chapters in a
repo-internal file is how documentation rots: nothing type-checked its snippets, nothing
gated its links, and it drifted eleven minor releases behind the code it described.

**The reader-facing documentation is on the docs site**, where every code block is
type-checked against the shipped types at build time and every cross-reference is gated
in CI.

| What you came for | Where it lives now |
|---|---|
| the architecture — three surfaces, the authority rule, the nine cursor causes, the three-way `read_skill` design, a worked refusal from a real run | `docs-next/content/docs/build/skill-graph-architecture.mdx` → `/docs/build/skill-graph-architecture` |
| the 5-minute version — three skills, one graph, the picture | `docs-next/content/docs/build/skill-graph-quickstart.mdx` |
| the full API — `defineSkill`, `skillGraph`, `checkup()`, `scopeTools`, `surfaceMode`, `steps`, `SkillRegistry`, `skillsFromDir`, `autoActivate` | `docs-next/content/docs/build/skills.mdx` |
| why skills exist at all (the concept essay) | `docs-next/content/docs/build/skills-explained.mdx` |
| the maintainer's map — module boundaries, import zones, seams | `src/lib/injection-engine/README.md` |
| the design spec | [`design/skill-graph-spec.md`](./design/skill-graph-spec.md) |

**Runnable, tested counterparts** for every snippet live under `examples/features/`
(`15-skill-graph.ts`, `23-skill-graph-scoped-read-skill.ts`,
`24-skill-graph-entry-relevance.ts`, `25-skill-graph-checkup.ts`,
`26-skill-graph-route-recorder.ts`, `27-skill-graph-relevance-hint.ts`,
`28-skill-graph-entry-read.ts`, `31-skill-graph-keyword-scorer.ts`,
`42-skill-graph-model-pick.ts`, `43-skill-graph-tree-pick.ts`,
`44-skill-graph-read-skill-offer.ts`, `46-skill-graph-checkup-deepens.ts`,
`47-skills-from-dir-graph.ts`, `54-skill-graph-front-door.ts`). They run in the
`test:examples` suite, so they cannot silently drift — prefer them over any prose when
the two disagree, and prefer the code over both.
