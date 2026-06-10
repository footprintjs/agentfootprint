# Prompt Injection — Posture & Defenses

**The honest position first: agentfootprint does not detect or block prompt
injection in core.** There is no input classifier, no tool-output scanner, no
guard model. What the library gives you is **containment** (capability gating,
argument validation, policy halts, credential scoping) and **evidence** (typed
events, tamper-evident audit export, full traces) — so a hijacked model can do
less damage, and you can prove afterwards exactly what it did.

The key limit to internalize:

> **`PermissionPolicy` gates *which* tools the agent may use — not *why* the
> model called them.** A model hijacked by injected text that operates entirely
> within its allowed toolset stays within policy. Capability gating bounds the
> blast radius; it does not restore the model's intent.

Detection and intent-validation are deliberately delegated to the application
layer (and to dedicated guard services) — buyers in regulated niches should
plan for that explicitly. The rest of this guide maps where untrusted text
enters an agent, which built-in layers contain it, and what to add yourself.

---

## Threat model — where untrusted text enters

| Entry point | Kind | Notes |
|---|---|---|
| `agent.run({ message })` | Direct injection | The user message IS untrusted input. |
| Tool results | **Indirect injection** | Any tool that ingests third-party content (web pages, emails, tickets, DB rows) carries that content into the conversation. See Greshake et al. 2023, cited in [security.md](security.md). |
| Persisted memory | **Stored injection** | Causal-memory snapshots replay STORED tool output into FUTURE prompts (the `DECISIONS` projection includes tool evidence — `src/memory/causal/loadSnapshot.ts` documents this surface in code). A poisoned tool result can outlive the run that ingested it. |
| Instructions / Skills / Steering you define | Trusted by definition | They ARE the prompt. Review them like code. |

Two injection-engine surfaces deserve explicit attention:

- **`on-tool-return` / `rule` triggers evaluate predicates over
  `ctx.lastToolResult` — untrusted content.** A poisoned tool result can be
  crafted to satisfy a loose predicate and activate a skill (and, with it,
  that skill's tools). Keep trigger predicates narrow: match on `toolName`
  and structured fields you control, not on free-text `result` scans.
- **`read_skill` is model-initiated activation.** A hijacked model can call
  it like any other tool. It IS subject to the execute-time permission gate
  (every tool call is — `target: 'read_skill'`), so a `PermissionChecker`
  can deny or halt skill activation just like any other capability.

---

## Containment layers in core (what exists today)

Each layer below is implemented in source; references are to the modules that
own them.

1. **Visibility gating — `gatedTools`** ([security.md](security.md#tool-gating--gatedtools)).
   The LLM never sees blocked tools; the list is recomputed every iteration.
   A model can't be talked into calling a tool it doesn't know exists.

2. **Execute-time gate — `PermissionChecker` / `PermissionPolicy`**
   ([security.md](security.md#centralized-permissions--permissionpolicy)).
   Runs before every `tool.execute()` (`src/core/agent/stages/toolCalls.ts`).
   The checker receives the full conversation `history`, the in-flight tool
   `sequence` (derived from history — `src/security/extractSequence.ts`),
   `iteration`, `identity`, and the call's `args` — enough to write
   sequence-aware policies (forbidden chains like "read-secrets then
   http-post", idempotency limits, cost guards). A checker that **throws is
   treated as deny** (fail-closed). Three outcomes: `allow`, `deny`
   (synthetic refusal lands in history, run continues), `halt` (turn
   terminates via `PolicyHaltError`; the synthetic tool_result and
   `permission.halt` event are committed BEFORE the break, so the audit
   trail is complete).

3. **Tool-args validation** (`src/core/agent/toolArgsValidation.ts`).
   LLM-produced args are validated against the tool's declared `inputSchema`
   before dispatch (`enforce` by default). Security property: issues name the
   PATH and TYPE, **never the supplied value** — injected arg values are not
   echoed into events, traces, or the model-visible retry message.

4. **Credential scoping — declare-and-push** (`defineTool({ needs })`).
   A tool receives only its declared credential, resolved at execute time
   into `ctx.credential`; secret fields are non-enumerable and resolution is
   fail-closed. A hijacked call to tool A cannot read tool B's credential,
   and credentials never transit the prompt.

5. **Evidence channel.** Every gate above emits typed events
   (`permission.check`, `permission.halt`, `validation.args_invalid`,
   `credential.*`) and `auditExport` produces a tamper-evident, hash-chained
   bundle ([security.md](security.md#tamper-evident-audit-export--auditexport--verifyauditbundle)).
   You may not block an injection in real time — you can always reconstruct
   it.

What core deliberately does NOT do: scan tool output for instructions,
classify user input, or second-guess model intent. **Redaction is also opt-in**
— the Agent sets no `RedactionPolicy` by default (footprintjs's
`RedactionPolicy` and the memory adapters' `MemoryRedactionPolicy` exist, but
you must configure them).

---

## Recommended external guards (what to add yourself)

- **Sanitize at the tool boundary.** Tools that ingest third-party text are
  the #1 indirect-injection vector. Return structured JSON instead of prose
  where possible; strip or label embedded instructions; record provenance.
  This is also the right place to protect persisted memory — snapshot stores
  are treated as prompt-trusted on replay, so what you let a tool return is
  what a future run will trust.
- **Validate user input at the application layer** before `agent.run()` —
  length caps, format checks, and (where the posture requires) a dedicated
  injection classifier or guard model in front of the agent.
- **Least privilege everywhere.** Per-identity `gatedTools` predicates +
  `PermissionPolicy.fromRoles` keep the visible toolset minimal; a halting
  sequence-aware checker turns "suspicious chain" into a terminated turn.
- **Make mutating tools idempotent** (idempotency keys on stable call
  content). Injection aside, the model can re-issue calls after errors and on
  `resumeOnError` replay — see the resume idempotency notes on
  `agent.resumeOnError()`.
- **Keep trigger predicates structural.** For skill routing, prefer
  `skillGraph().tree()` decision predicates over `ctx` fields you control
  (user intent, iteration) rather than free-text matching on tool results.

A first-class `inputValidator` hook (a pre-run / pre-prompt guard seam in
core) is tracked in the backlog as a candidate for a future major — it is not
in core today.

---

## See also

- [security.md](security.md) — tool gating, `PermissionPolicy`, permission
  audit events, tamper-evident audit export, provider resilience.
- [instructions.md](instructions.md) — the injection (slot × trigger) model
  that skills and steering compile to.
- `src/memory/causal/loadSnapshot.ts` — the in-code callout for the persisted
  (memory replay) injection surface.
