[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SurfaceMode

# Type Alias: SurfaceMode

> **SurfaceMode** = `"auto"` \| `"system-prompt"` \| `"tool-only"` \| `"both"`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:55](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L55)

Where the Skill's body lands when activated.

- `'system-prompt'` — body appended to the system slot on the
  iteration after activation. Best on Claude ≥ 3.5 (training-time
  adherence to system-prompt instructions is strong).
- `'tool-only'` — body delivered ONLY via the `read_skill` tool's
  result. Recency-first by protocol; doesn't rely on the model's
  training to honor system-prompt anchoring. Default for every
  non-Claude provider.
- `'both'` — body lands in both the system slot AND the tool result.
  Belt-and-suspenders for high-stakes Skills on long-context runs.
- `'auto'` — the library picks per provider via `resolveSurfaceMode`.
  `'both'` on Claude ≥ 3.5; `'tool-only'` everywhere else.

**Today's behavior:** all four modes route through the recency-first
path the essay describes as cross-provider-correct (the activation +
next-iteration injection pattern). Full per-mode routing diversity
(suppress system-prompt for `'tool-only'`, e.g.) is a v2.5 polish.
Consumers express intent today; runtime behavior tightens later
without API change.
