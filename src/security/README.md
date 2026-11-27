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
- `extractSequence.ts` — the sequence given to a permission checker uses the
  result paired by position with each recorded proposal. Unanswered proposals,
  explicit `LLMMessage.notDispatched` settlements, and results whose
  `toolResultOrigin` says `not-entered` or `input-cancelled` stay out of the
  sequence. A result marked `outcome-unknown` stays in as a possible dispatch
  because the record leaves entry uncertain.

  - `[assistant: read_palette#k1] [tool k1: settled] [assistant: lookup_swatch#k1] [tool k1: 'ok']` gives `[lookup_swatch]`.
  - `[assistant: read_palette#k1] [tool k1: refused] [assistant: lookup_swatch#k1] [tool k1: 'ok']` gives `[lookup_swatch]`.

  Here `settled` is a recorded settlement and `refused` is a recorded non-entry.
  The regular and resumed dispatch paths write non-entry with findings enabled.
  Without a result origin, the reader uses the legacy synthetic denial prefix.
  A custom refusal without that prefix or an origin can still appear in the
  sequence. A hosting input cancellation without its origin also stays in.
  The sequence describes recorded dispatch history. Completion and the source
  history's trustworthiness require separate evidence.

  A call a tool made through `ctx.tools.call` whose function was entered
  rides its outer call's result message (`LLMMessage.calls`) and follows that
  call in the sequence, marked `inner: true`. Example: `[assistant: compose#c1]
  [tool c1: 'ok', calls: [read_secret]]` gives `[compose, read_secret
  (inner)]`. Until the outer call's result lands, the next inner call's
  checker gets the same entries from the run's `innerToolCalls` rows
  (`core/agent/stages/toolCalls/access/innerCallGates.ts`).
  The writer groups the inner rows by the outer call's ID and iteration.
  When two outer calls share one ID within a batch, their own inner rows
  cannot be distinguished from that grouping.
- `skillTarget.ts` — one spelling, one owner.
- `thinkingRedaction.ts` — the deliberate two-view split: unredacted to the
  provider for signature round-trip, redacted into `scope.history`.
- `index.ts`.

Saved skill catalog results are projected for the current recipient before model delivery. Version-1 conversation history is admitted with unknown provenance for old unmarked catalog results. A role change that would alter a frozen native-thinking prefix ends replay with a refusal, since the saved prefix cannot safely be served or rewritten.

**Rolling upgrades.** Older runtimes refuse version-2 conversation checkpoints, including those in hosted session envelopes. Finish the upgrade across all runtimes before resuming sessions across versions. Wait until all sessions saved by the upgraded runtime are closed before rolling back.
