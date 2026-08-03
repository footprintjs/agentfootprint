---
name: Instruction — rule-based system-prompt guidance
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: I'm really frustrated about my refund
---

# Instruction — rule-based guidance, on the turns it applies

`defineInstruction` is the most flexible **Instruction-style** flavor:
a predicate runs once per iteration. When it matches, the instruction's
`prompt` text joins the system-prompt slot for that iteration — tagged
with `source: 'instructions'` so observability surfaces (Lens, recorders)
show one chip per active instruction.

## Where it lands — one slot, narrowed by the predicate

```ts
// Default: system-prompt slot — always available, lower attention
defineInstruction({
  id: 'calm-tone',
  activeWhen: (ctx) => /upset/.test(ctx.userMessage),
  prompt: 'Acknowledge feelings before facts.',
});

// Predicate-scoped: still the system-prompt slot, but only on the turn
// right after the tool ran — the trigger does the narrowing, not the slot
defineInstruction({
  id: 'urgent-redact',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'CRITICAL: use the redacted text only. Do not paraphrase the original.',
});
```

`slot: 'system-prompt'` is the only placement an Instruction has. `slot: 'messages'`
was accepted until 7.19.1 and never delivered — the request's message list is built
from the conversation, so an instruction placed there was recorded as injected and
never sent. Declaring it now throws, and names what to use instead.

**Want the rule read at maximum recency?** Return it from the tool it is about.
A tool result IS a recent message, so `return 'Done. Use the redacted text only.'`
puts the words exactly where a messages-slot injection was aiming — and this one
actually reaches the model.

## When to use

- **Conditional persona / tone** — "be calm if user is upset"
- **Iteration-scoped guidance** — "first iteration only: stay brief"
- **Tool-result follow-ups** — "after `redact_pii` ran, don't restate
  emails or phone numbers" (uses `ctx.lastToolResult` in the predicate)
- **History-aware nudges** — "if conversation has 5+ assistant turns,
  summarize before continuing"

## What the predicate sees

```ts
interface InjectionContext {
  iteration: number;          // 1-based
  userMessage: string;        // current turn's user input
  history: ReadonlyArray<{ role; content; toolName? }>;
  lastToolResult?: { toolName; result };  // previous iteration's last tool
  activatedInjectionIds: readonly string[]; // Skills the LLM has activated
}
```

Predicates are synchronous + side-effect-free. If a predicate throws
it's caught and reported via `agentfootprint.context.evaluated.skipped[]`
(never propagates — the run continues with the instruction silent).

## Key API

```ts
import { Agent } from 'agentfootprint'
import { defineInstruction } from 'agentfootprint/injection-engine';

defineInstruction({
  id: string;
  activeWhen?: (ctx) => boolean;        // predicate; omit for always-on
  prompt: string;                        // the instruction text
  slot?: 'system-prompt';                // the only placement; default
  description?: string;                  // for observability
});
```

## What it emits

- `agentfootprint.context.evaluated` — engine subflow exit, summary of
  active/skipped per iteration
- `agentfootprint.context.injected` — slot subflow per-injection record
  with `source: 'instructions'`, `sourceId: 'calm-tone'`, `reason: ...`
- `agentfootprint.context.slot_composed` — final system-prompt slot
  composition

## Related

- **[Steering](./03-steering.md)** — same shape, always-on (no predicate)
- **[Skill](./02-skill.md)** — LLM-activated body + tools
- **[Fact](./04-fact.md)** — context-style: data, not behavior
- **[Dynamic ReAct](./05-dynamic-react.md)** — instructions that morph
  prompt across iterations based on tool results
