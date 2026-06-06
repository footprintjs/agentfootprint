[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SurfaceMode

# Type Alias: SurfaceMode

> **SurfaceMode** = `"auto"` \| `"system-prompt"` \| `"tool-only"` \| `"both"`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:58](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/injection-engine/factories/defineSkill.ts#L58)

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

**v2.5 runtime dispatch (Block C):** modes now route differently:
  - `'system-prompt'` → body in system slot, tool result is confirmation
  - `'tool-only'`     → body SUPPRESSED from system slot, tool result IS the body
  - `'both'`          → body in system slot AND in tool result
  - `'auto'`          → keeps v2.4 behavior (body in system slot, tool result is confirmation)
    The Block A4 cascade resolves `'auto'` against provider/model context
    at a future runtime layer (Claude ≥ 3.5 → `'both'`; else `'tool-only'`).
