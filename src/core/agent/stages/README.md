# `src/core/agent/stages/` — the ReAct loop's stage functions

One file per stage of the Agent chart, mounted by `buildAgentChart` /
`buildDynamicAgentChart` (never imported by consumers):

| file | stage |
|---|---|
| seed.ts | run-start state seeding (history, counters, injection arrays; restores the conversation's skill cursor under `continuity: 'conversation'`) |
| pickEntry.ts | off-loop entry scoring for `.entryBy()` skill graphs (subsumed by routeTurn.ts on cascade graphs) |
| routeTurn.ts | the turn-start routing cascade (SG-C): rules → classifier/scorer → menu, continuity judged, verdict on `scope.turnRoute` + `skill.turn_routed`. Mounts in PickEntry's slot under the SAME id (`STAGE_IDS.PICK_ENTRY`) only when the graph runs the cascade (`classify` or `continuity: 'conversation'`). 9.19.0: the tier-3 DECIDER arm — `SkillGraphOptions.decider` resolves an outstanding menu ∪ {stay} out-of-band via `constrainedEnumPick` (`by: 'decider'`, the sanctioned rails resolver); a decider-RESOLVED verdict (move or stay) writes the scope `TurnRoute` WITHOUT `offered` while the event keeps the full set |
| window.ts | `.window()` compaction (loop head when configured) |
| deliver.ts | messages-slot delivery (role-checked, sequence-checked) |
| callLLM.ts | provider invocation + streaming + reliability retry loop. 9.19.0: ONE `brainFor(nextSkillCursor ?? currentSkillId, skillEscalated)` consult at the top — the cursor picks the brain; precedence escalation > skill brain > `.configure()` > build default; `llm_start.brain` stamps the winning rung (absent = the agent's own config answered) |
| route.ts | the decider: tool-calls / output-retry / step-nudge / evidence-recheck / final. Three judges over a would-be-final answer, in this order: schema (a broken shape is replaced wholesale) → steps (`steps_unfinished` accepted/cut-short) → evidence (9.35.0 — every name and number must appear in a tool result). A DENIED answer is judged by none of them |
| toolCalls.ts | tool dispatch (pausable): permission gate → middleware → validation → credentials → execute; the read_skill gate; the step boundary (9.18.0) — advance/skip at EVERY result-finalization site, the batch loop AND all four resume paths. 9.19.0: the escalation counter (both `skill.rejected` sites feed `skillRefusalsThisTurn`; at `afterRefusals` the flip is committed + `skill.escalated` fires once) and the typed tool-effects judge (`applyToolEffects` — envelope unwrapped at every execute boundary; propose-transition reachability-checked, first-accepted-wins with `route_conflict { source: 'tool-proposal' }`; require-instruction leases granted from the declared catalog — but lease DEATH is owned by the injection engine's Evaluate tenure sweep (`nextInstructionLeases`), which is what keeps a dead lease dead across cyclic re-entry; `status` rides `tool_end` + the batch; a status-only near-miss missing its `effects: []` marker stays data and gets a dev-mode warning naming the fix) |
| outputRetry.ts | `.outputSchema()` re-ask branch |
| stepNudge.ts | the unfinished-steps teaching re-ask (9.18.0): appends the premature answer + the nudge, once per turn, loops like SchemaRetry |
| evidenceRecheck.ts | the evidence correction (9.35.0): names the values that appear in no tool result back to the model, once per turn, loops like SchemaRetry. Mounted only under `posture: 'guard' \| 'rails'`; the check itself lives in ../evidence/ |
| reliabilityExecution.ts | in-loop reliability rules |
| prepareFinal.ts / breakFinal.ts | final answer + `$break` |

## Tool-result wiring (9.16.0)

`toolCalls` maintains TWO scope keys as each result lands (collect during
traversal — a pause mid-batch commits the partial batch, resume paths append):

- `lastToolResult` — the last result; unchanged contract, kept for every
  existing reader (context-bisect's proximate-tool key among them);
- `toolResults` — EVERY result of the iteration's batch, in call order with
  `toolCallId`, reset at dispatch start. This is what `on-tool-return`
  triggers and skill-graph routes read (via the injection-engine mappers), so
  a parallel batch routes on all its calls, not only the last.

Any NEW dispatch path must write both (and apply `capResults` — see the note
on the five `tool_end`-emitting paths in toolCalls.ts).
