---
name: Dynamic ReAct — context morphs each iteration
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: My account is alice@example.com — please refund $42
---

# Dynamic ReAct — the marquee pattern

> **Static ReAct (LangChain default):** system prompt + tools fixed at
> build time. Every iteration sends the same prompt; only history changes.
>
> **Dynamic ReAct (agentfootprint default):** system prompt + tools +
> facts re-composed each iteration. The LLM sees a *different* context
> on iteration N than on iteration N-1 — driven by what the LLM and
> tools just did.

This example combines all four flavors of Injection in one agent to
show how the InjectionEngine produces dynamism.

## The 4-iteration walkthrough

```
Turn starts: "My account is alice@example.com — please refund $42"

Iteration 1
  Active injections:                            Why
  ─────────────────────                         ───
  • safety       (steering)                     always-on
  • user-profile (fact)                         always-on
  • postPii      (instruction, predicate false) lastToolResult undefined
  • billingSkill (skill, not yet activated)     id NOT in activatedIds
  • focus        (instruction, predicate false) iteration < 3

  Slot composition:
    system-prompt: base + safety + user-profile
    tools:         read_skill   ← only the activation tool
  
  LLM responds → calls read_skill('billing')
  Agent intercepts → activatedInjectionIds = ['billing']

Iteration 2
  Active injections:                            What changed
  ─────────────────────                         ────────────
  • safety       (steering)                     same
  • user-profile (fact)                         same
  • billingSkill (skill)                        ✓ NEW — id activated
  • postPii      (predicate false)              still no PII tool ran
  • focus        (predicate false)              still iteration < 3

  Slot composition (DIFFERENT from iter 1):
    system-prompt: base + safety + user-profile + billing-skill-body  ← NEW
    tools:         read_skill + redact_pii + process_refund            ← NEW

  LLM responds → calls redact_pii({ text: 'alice@example.com ...' })

Iteration 3
  Active injections:
  ─────────────────────
  • safety, user-profile, billingSkill            still active
  • postPii      (predicate TRUE)                 ✓ NEW — lastToolResult.toolName === 'redact_pii'
  • focus        (predicate TRUE)                 ✓ NEW — iteration === 3

  Slot composition (DIFFERENT from iter 2):
    system-prompt: base + safety + user-profile + billing-body
                   + post-pii-reminder + focus-reminder              ← TWO NEW
    tools:         same

  LLM responds → calls process_refund({ amount: 42 })

Iteration 4 (final)
  Active injections:
  ─────────────────────
  • safety, user-profile, billingSkill, focus     still active
  • postPii      (predicate FALSE)                lastToolResult is now process_refund

  LLM responds → final answer (uses [EMAIL] from redacted text)
```

**The same agent. Four iterations. Four different system prompts.
Four different active tool sets.** That's Dynamic ReAct.

## Why this is the library's DNA

> *"Other frameworks bury context-engineering decisions in scattered
> places (some in retrievers, some in middleware, some in prompt
> templates). agentfootprint runs ONE engine ONE time per iteration.
> ALL context decisions happen in ONE observable subflow boundary.
> Lens drills into it. A student sees: 'Iteration 3's prompt added X
> because the LLM just called Y.' That's the teaching moment."*

## What you can build with this

- **Self-correcting agents** — instruction fires after low-confidence
  tool returns: "double-check this with another tool"
- **Adaptive personas** — Skill activated based on conversation topic
- **Defensive agents** — `safety` steering + `post-pii` instruction
  ensures redaction policies are reinforced exactly when relevant
- **Cost-aware agents** — `focus` reminder kicks in after iteration N
  to prevent runaway loops

## What it emits

The same events as other Injection examples — but EVERY iteration:
- `agentfootprint.context.evaluated` × 4 (one per iteration)
- `agentfootprint.context.injected` × 12+ (per active injection per iteration)
- `agentfootprint.context.slot_composed` × 12 (3 slots × 4 iterations)
- `agentfootprint.stream.tool_*` × 6 (3 tool calls in/out)
- `agentfootprint.agent.iteration_*` × 8 (4 starts + 4 ends)

Lens shows the morph as a sequence of slot states — each iteration's
chip grid different from the last.

## Related

- **[Injection Engine README](../../src/lib/injection-engine/README.md)**
  — full architecture
- **[Mixed flavors](./06-mixed-flavors.md)** — same idea, simpler scenario
- **[Instruction](./01-instruction.md)**, **[Skill](./02-skill.md)**,
  **[Steering](./03-steering.md)**, **[Fact](./04-fact.md)** — individual
  flavors covered in their own examples
