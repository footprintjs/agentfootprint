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
- `extractSequence.ts` — the in-flight sequence, from history: the calls that
  really dispatched. A call denied at the gate is left out (by its synthetic
  prefix), and so is a call a paused batch never dispatched (9.113.0, by its
  `LLMMessage.notDispatched` marker) — a "verify before transfer" policy is
  never met by a verify that did not run. The marker settles the ONE proposal
  it answers, paired by POSITION (`settledProposals`), because an id alone
  cannot say which: providers may reuse ids, and the library's own fallback
  ids are minted per provider instance, so a restarted process mints the
  settled call's id again for a call that really runs. Example: history
  `[assistant: verify#k1] [tool k1: settled] [assistant: lookup#k1] [tool k1:
  'ok']` gives the sequence `[lookup]` — the lookup ran, the verify did not.
  The deny and in-flight checks still pair by id, as they always have, so a
  history with no marker reads exactly as it did before — limits included: a
  call denied at the gate still counts once a later call that runs reuses its
  id, and a call that ran drops out once a later reuse of its id is denied.
- `skillTarget.ts` — one spelling, one owner.
- `thinkingRedaction.ts` — the deliberate two-view split: unredacted to the
  provider for signature round-trip, redacted into `scope.history`.
- `index.ts`.
