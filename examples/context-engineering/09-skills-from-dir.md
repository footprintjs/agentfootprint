---
name: Skills from a directory of SKILL.md files
group: context-engineering
guide: ../../src/lib/injection-engine/
defaultInput: I want a refund for order 5512.
---

# Skills from a directory of SKILL.md files

A skill body is prose — a playbook, a policy, a checklist. Prose belongs in a file a support lead can edit and a reviewer can read as a diff, not in a template literal three imports deep.

`skillsFromDir('./skills')` reads a directory of `SKILL.md` files and hands each to `defineSkill`. It is a **loader, not a second mechanism**: the frontmatter `description` is still all the model sees until it calls `read_skill(<id>)`, and the body still arrives only after it does.

## The file convention

```
skills/
  billing/SKILL.md
  shipping/SKILL.md
```

```md
---
name: billing
description: Use for refunds, disputed charges, invoices and any billing question.
---

Before anything else, confirm the customer's identity …
```

The skills this example loads live next to it, in [`skills/`](./skills/). Open them — that IS the API. It is the same convention Claude Code made familiar, so a skill folder is portable between the two.

## Anatomy

```typescript
import { Agent } from 'agentfootprint';
import { skillsFromDir } from 'agentfootprint/context';

const skills = await skillsFromDir('./skills');

const agent = Agent.create({ provider, model })
  .system('You are a support agent. Open a skill when one applies.')
  .skills({ list: () => skills })
  .build();
```

Two layouts are accepted and can be mixed: `dir/<anything>/SKILL.md` (prefer this — the folder can hold the skill's other assets) and `dir/SKILL.md` (the directory *is* one skill). The result is sorted by skill name, so the chart is stable regardless of filesystem order.

## What it refuses

A skill body is *instructions to a model*, so where it came from is a security property. The loader reads a local directory and nothing else — a URL is **refused by name** rather than fetched, because "these files are mine" is a claim you can only make about a path on your own disk at build time.

| Problem | The message names |
|---|---|
| Malformed frontmatter, missing `name`/`description`, empty body, unusable name | the file |
| Two files claiming the same skill name | both files |
| A URL, a UNC path, a missing directory | the argument |

A directory with no `SKILL.md` is an error, not an empty array: pointing at the wrong folder should not look like "you have no skills yet".

## Node-only, safely

`skillsFromDir` reads the filesystem, but importing `agentfootprint/context` in a browser bundle stays safe — `node:fs` is imported lazily inside the call, never at module load.

## Related

- **[Skill](./02-skill.md)** — the same mechanism, authored inline with `defineSkill`
- **[Mixed flavors](./06-mixed-flavors.md)** — skills alongside steering, instructions and facts
