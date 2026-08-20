# dangling-reference — offered without its evidence

**Why.** In a recorded run, a `whats_here` result carrying the valid screen ids was evicted by the
window strategy while the tool that FIRES at those ids stayed on the wire. The model assembled a
plausible id from an entity name it remembered, was refused, and spent actions on it — and nothing
in the run said the evidence had gone. 9.57.0 made the DROP speak (`WindowRecord.droppedObservations`
plus the wire notice); this makes the next COMPOSITION answerable for it.

**Declared, never inferred.** The library cannot know that one tool's arguments come from another
tool's results — only the author does. The edge is `Tool.argumentsFrom` (`defineTool({ name:
'screen_fire', argumentsFrom: ['whats_here'] })`), refused at the definition door when blank, empty,
or self-referential. A tool that declares nothing is never this check's subject — the whole
zero-delta story.

**Where it checks.** `callLLM`, at request assembly, before the call — the composition defect exists
whether or not the call lands. For each served tool with declared grounds: a ground that is in the
union of every window visit's `droppedObservations` AND has no fresh result in the assembled
messages is dangling. One finding per tool naming every missing ground; the shared seen-list rail
dedups to one `integrity.context_error` per defect per run.

**The two fences** (they are the check's honesty):
- a ground **never dropped** is silent even with no result in the window — the model simply has not
  called it yet, and offering the dependent tool ahead of that is legitimate sequencing;
- a **re-fetched** ground (fresh result present) is silent, however many drops preceded it.

The defect is exactly the third state: was grounded, evidence evicted, nothing re-established,
capability still offered.

**Relation to the last-tool-result pin.** The pin (9.57.0, default on) is the shipped FIRST line of
defense — each tool's most recent result refuses to leave, so the simplest version of this failure
never happens under defaults. The check covers what the pin cannot: agents that switched it off,
and grounds older than the pin's ceiling. Detection and retention policy stay separate mechanisms
on purpose — one keeps evidence, the other says out loud when it is gone anyway.

**Runnable example.**

```ts
import { danglingReferencesOf } from './check.js';

const findings = danglingReferencesOf(
  [{ name: 'screen_fire', argumentsFrom: ['whats_here'] }],
  new Set(['whats_here']), // dropped this run (window ledger)
  new Set(),               // nothing re-established in the current frame
  4,
);
// → one 'dangling-reference' at seam 'compose'; the message tells the model
//   the honest fix: call whats_here again. Nothing withholds the tool.
```
