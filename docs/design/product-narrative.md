# The product narrative — what agentfootprint is, in business terms

> Status: canon. This document is the source for the homepage's business lens, the
> README's "why a skill graph" section, and the research hypothesis. Public copy is
> derived from it; claims here follow the same honesty rules as the code.

## The one-sentence statement

**Agentfootprint helps AI-product teams achieve equal or better response quality
with lower-cost models by dynamically loading the right procedures and tools — and
provides the infrastructure to deploy, debug, and scale that behavior.**

## The value chain

| Layer | The customer's situation |
|---|---|
| End-customer benefit | Higher-quality responses |
| Customer's business outcome | Equal or better quality using a lower-cost model |
| Technology mechanism | The skill graph selects the operating procedure and exposes only the relevant tools, instead of showing the model dozens of tools at once |
| Supporting activity | Infrastructure to integrate, deploy, debug, and scale that behavior — roughly 20 lines of declarations instead of hundreds of lines of hand-written orchestration |
| Economic benefit | Lower model spend, less engineering time, lower cognitive load |

## The innovation class: temporal reconfiguration

The customer already performed this activity — they exposed a flat surface of
dozens of tools and compensated for the resulting complexity with a stronger,
more expensive model. Agentfootprint does not add helpful activities *around*
that work; it **takes the activity over and restructures it**:

```text
Before:                                After:
flat ~40-tool surface                  task → relevant skill-graph node
→ frontier model                       → relevant procedure + small tool surface
→ substantial orchestration code       → lower-cost model
→ high inference + engineering cost    → better observed response
```

- The customer no longer manages a flat tool surface by hand.
- The runtime assumes responsibility for procedure selection and tool exposure.
- The customer describes the graph and its rules; the runtime performs the
  per-iteration orchestration — and records why every handoff happened.

The line-count reduction is the demonstration. The value is fewer concepts to
coordinate, less integration time, fewer configuration contradictions, faster
changes, and safer scaling. Observability and debugging surfaces are part of this
reconfiguration — the boundary of responsibility moves, and the evidence moves
with it.

## The technical narrative: a program counter for agents

The skill graph transfers two ideas that every compiler and operating system
relies on into LLM-agent orchestration:

| Systems concept | Skill-graph implementation |
|---|---|
| Program counter | The graph cursor — which skill is executing now |
| Dynamically loaded module | The current skill's body and instructions |
| Local callable operations | The tools owned by the active skill |
| Control-flow transition | A graph edge, fired by a rule or a tool result |
| Reachability | The model can activate only graph-reachable skills |
| Execution trace | Cursor moves, activation causes, superseded skills, tool calls — recorded as they happen |

A program does not treat every function as simultaneously active, and an agent
should not treat every tool and procedure that way either. Reformulated through
the graph, one large global decision — *which of everything, right now?* —
becomes a sequence of smaller, structured local decisions:

- **Skill body** = the perspective: how the current problem should be understood.
- **Skill instructions** = the heuristic: how this kind of problem is solved.
- **Skill tools** = the operations available *here*.
- **The graph** = the meta-heuristic that selects the perspective–heuristic pair.
- **A tool-result transition** = evidence that it is time to change perspective.
- **The trace** = proof of which pair was active, and what caused every change.

The library does not make a smaller model inherently smarter. It changes the
coordinates so the same problem becomes easier — and it can prove, from its own
record, which procedure was operating when the agent acted.

A second transfer in the same spirit already ships: delta-debugging applied to
context. Instead of bisecting code commits to find a bug, the debugger removes or
restores instructions, memories, retrieved passages, and tool evidence to identify
which context source caused an agent failure — an ablation verdict, not a guess.

## The evidence discipline

The claim that structure substitutes for model capability is stated carefully:

> In one customer implementation, replacing a flat ~40-tool agent that required a
> frontier model with the dynamic skill graph enabled a lower-cost model to
> produce better evaluated responses at lower operating cost.

That is a **customer-reported case study** — credible, and honestly bounded. The
general claim requires a controlled comparison, and its design is fixed:

- **The 2×2:** flat tool surface vs. skill graph × small model vs. frontier model,
  on the same evaluation tasks and scoring rubric.
- **The metric:** cost per successful task — success rate, tool-selection
  accuracy, handoff accuracy, unauthorized-call rate, retries, escalation rate,
  and total cost per completed task. Never token cost alone.
- **The hypothesis:** state-scoped selection of perspective, procedure, and tools
  preserves task quality while reducing the model capability and inference cost
  required, compared with flat tool exposure.

Until that comparison is run, public copy uses the case-study phrasing and
nothing stronger.
