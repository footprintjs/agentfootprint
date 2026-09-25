# `.changes/` — one file per change

Every pull request that touches `src/` adds ONE fragment here. The release folds
all fragments into `CHANGELOG.md`, picks the version, and deletes them. **Never
edit `CHANGELOG.md` or `package.json`'s version by hand, and never write a
version number** into a fragment, a capability row or a commit subject — the
release fills it in.

```md
---
type: fixed
---
**One-line headline a user would search for.** Then what changed and why they
care, in plain words. Markdown is fine; this text lands in the CHANGELOG as-is.
```

| `type` | Goes under | Bumps |
|---|---|---|
| `breaking` | Breaking (must include a `Migration:` paragraph) | major |
| `added` | Added — a new capability | minor |
| `changed` | Changed — existing behaviour, compatible | patch |
| `deprecated` / `removed` / `fixed` / `security` | the section of that name | patch |
| `internal` | nothing — refactors, tests, tooling (git log keeps them) | patch |

Optional `bump: minor` (or `major`) raises the bump; it can never lower it.

- Name the file anything descriptive: `.changes/findings-stream-leak.md`.
- `npm run changes:preview` prints the entry the next release would write.
- `npm run changes:check` validates every fragment (CI runs it on every PR).
- A capability added to `CAPABILITIES.md` writes `unreleased` in its Since
  column; the release replaces it with the version.
