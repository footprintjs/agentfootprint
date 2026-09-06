**Support** — authorization as a guard ON context-engineering operations, not as
part of them.

## What it reads / what it writes
- Reads roles, the in-flight tool-call sequence, and the skill target
  (`skillTarget.ts` is the ONE spelling of "which skill is this check about").
- Writes refusals and halts. It composes no model-facing sentence itself.

## The one law here
Two different things, stated at `index.ts` · "A local allowlist and a remote policy engine differ in one way that matters here": the GATE decides what the model
is SHOWN, the CHECKER decides what actually RUNS. A gate's omission is an
AUTHORITY omission and must be invisible — hidden means unnamed — which is the
opposite discipline from a budget omission, and it is enforced at the composer
(`src/tool-providers/gatedTools.ts`, `src/core/slots/buildToolsSlot.ts`), not
here.

## Files
- `PermissionPolicy.ts` — the role allowlist, usable as an async checker and a
  sync gate predicate.
- `PolicyHaltError.ts` — the typed halt.
- `extractSequence.ts` — the in-flight sequence, from history.
- `skillTarget.ts` — one spelling, one owner.
- `thinkingRedaction.ts` — the deliberate two-view split: unredacted to the
  provider for signature round-trip, redacted into `scope.history`.
- `index.ts`.
