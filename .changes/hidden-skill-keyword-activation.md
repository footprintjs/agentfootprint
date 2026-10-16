---
type: security
---
**A skill hidden by `skill_read` can no longer be activated by a keyword rule, or by any other path.** A start rule (`match: { keywords }`, a RegExp or `when`) could put the skill-graph cursor on a skill the caller's role may not read, and the skill's body reached the model. This happened in plain runs, through the declaration-order cold walk, and in the turn-start cascade's tier 1. That let user text surface a hidden skill. Hidden now means hidden on every activation path.

- The Injection Engine resolves the caller's hidden skills first on every iteration, before anything decides. The tools slot reads that same answer, so a menu and an activation are never judged by two different policy calls.
- The cursor never moves onto a hidden skill. This covers a keyword or other start rule, the cascade's verdict, a declared route, a tool's `propose-transition`, a `read_skill` pick, and a cursor restored from a conversation the caller may no longer read. A graph whose start is hidden enters through its visible entries instead.
- The evaluator never activates a hidden skill, whatever its trigger or a `require-instruction` lease says. `context.evaluated` records the skip with the new reason `'hidden'`.

`InjectionContext` gains an optional `hiddenSkillIds` field, and `InjectionEngineConfig` gains an optional `hiddenSkillIds` resolver. Code that switches exhaustively over `skippedDetails[].reason` must handle `'hidden'`.
