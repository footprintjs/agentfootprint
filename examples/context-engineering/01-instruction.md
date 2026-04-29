---
name: Instruction — rule-based system-prompt guidance
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: I'm really frustrated about my refund
---

# Instruction — rule-based, lands in the slot YOU choose

`defineInstruction` is the most flexible **Instruction-style** flavor:
a predicate runs once per iteration. When it matches, the instruction's
`prompt` text lands in the slot you specified (`system-prompt` by default,
or `messages` for recency-weighted attention) — tagged with
`source: 'instructions'` so observability surfaces (Lens, recorders)
show one chip per active instruction.

## Where it lands — recency vs system-prompt

Two choices, same primitive:

```ts
// Default: system-prompt slot — always available, lower attention
defineInstruction({
  id: 'calm-tone',
  activeWhen: (ctx) => /upset/.test(ctx.userMessage),
  prompt: 'Acknowledge feelings before facts.',
});

// Recency-weighted: messages slot, role='system' — higher attention
// because LLMs read recent messages more carefully than system-prompt text
defineInstruction({
  id: 'urgent-redact',
  slot: 'messages',                    // ← lands in messages slot
  role: 'system',                       // ← optional; default 'system'
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'CRITICAL: use the redacted text only. Do not paraphrase the original.',
});
```

**Choose `slot: 'messages'` when**:
- The instruction MUST be salient on this turn (post-tool-result reminder,
  urgent correction, safety nudge after a sensitive operation)
- System-prompt is already crowded and you want recency weight
- The instruction is short-lived (only relevant for 1-2 iterations)

**Choose `slot: 'system-prompt'` (default) when**:
- The instruction is invariant for the turn ("be calm if user is upset")
- You want it always available without consuming message tokens
- Multiple instructions can layer cleanly without bloating messages

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
import { Agent, defineInstruction } from 'agentfootprint';

defineInstruction({
  id: string;
  activeWhen?: (ctx) => boolean;        // predicate; omit for always-on
  prompt: string;                        // the instruction text
  slot?: 'system-prompt' | 'messages';   // default 'system-prompt'
  role?: 'system' | 'user' | 'assistant' | 'tool';  // for slot='messages'; default 'system'
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
