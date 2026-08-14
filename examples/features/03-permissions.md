---
name: Permissions — capability gating, fail-closed, and halt
group: features
guide: ../../README.md#features
defaultInput: save this customer note
---

# Permissions — capability gating, fail-closed, and halt

A `permissionChecker` is an **execution guard**, not tool hiding. Before every
`tool.execute` the Agent calls
`checker.check({ capability, target: <tool>, context: <args> })` and emits
`agentfootprint.permission.check` with the decision. `deny` skips the tool and
the model reads a synthetic denial so the conversation stays coherent. A
throwing checker is **deny by default** (fail-closed), with the thrown error in
the `rationale`.

An independent reviewer (2026-08-13) drove that guard end to end — on a
deterministic local harness, with a mock model and a thrown `Error` for the
"authorizer outage", not against any live authorization service — and reported at
the same time that this example demonstrated only `allow`/`deny`. It now runs
that run's own four scenes.

## The four scenes

| # | Scene | What it proves |
|---|---|---|
| 1 | Read-only role, a tool declaring `memory_write` + `user_data` | The tool NAME passes the allowlist and the tool still executes **zero** times, because a declared capability is refused |
| 2 | Admin role, same tool | `tool_call`, `memory_write` and `user_data` all pass → one execution |
| 3 | A checker that throws `simulated authorizer outage` | Fail-closed: zero executions, the operator's error in the `rationale`, the model carries on without the tool |
| 4 | A `halt` decision | The run ends cleanly with a typed `PolicyHaltError` carrying `reason` (routing) and `tellLLM` (what the model was shown) |

## Enforce-when-both-sides-speak

Capability checks happen only when **both** sides say so:

- `Tool.capabilities` is **declared**, never inferred — the framework has no way
  to know what a tool touches, and guessing would be a security claim built on a
  guess;
- `PermissionChecker.governs` is optional and feature-detected, and **absence is
  NO** — a policy written before capabilities existed is never asked about them.

`PermissionPolicy` **derives** `governs` from its own rules bag, so
"unconfigured" and "never asked" cannot drift apart.

## When to use

- **Compliance policies** — read-only mode, destructive-op allowlist, per-role
  and per-capability gating.
- **External policy engines** — wrap OPA, Cerbos or your own service in a
  `PermissionChecker` adapter. Scene 3 is what happens when it is unreachable.
- **Rate / cost gating** — return `deny` when a per-user quota is exceeded.

## Key API

```ts
import { PermissionPolicy } from 'agentfootprint/security';

const policy = PermissionPolicy.fromRoles(
  { readonly: ['save_note'], admin: ['save_note'] },   // tool allowlist
  'readonly',                                          // active role
  { capabilities: {                                    // capability rules
      readonly: ['memory_read'],
      admin: ['memory_read', 'memory_write', 'user_data'],
  } },
);

const agent = Agent.create({ provider, model, permissionChecker: policy }).build();
```

A hand-written checker is the same shape:

```ts
const checker: PermissionChecker = {
  name: 'my-policy',
  governs: ['memory_write'],           // absence is NO
  check: async (req) => {
    if (isAllowed(req)) return { result: 'allow' };
    return { result: 'deny', policyRuleId: 'rule-7', rationale: 'policy X forbids Y' };
  },
};
```

## Decision shape

```ts
PermissionDecision = {
  result: 'allow' | 'deny' | 'halt' | 'gate_open';
  policyRuleId?: string;   // WHICH rule decided — traceable in the event stream
  rationale?: string;      // human-readable, lands on the event
  reason?: string;         // machine-readable telemetry tag, e.g. 'security:exfiltration'
  tellLLM?: string;        // what the MODEL is shown on deny/halt
  gateId?: string;
}
```

`halt` terminates the run cleanly with `PolicyHaltError` after writing the
synthetic `tool_result` (so tool_use ↔ tool_result pairing stays valid) and
emitting `agentfootprint.permission.halt`. `gate_open` is treated as `allow` but
emits a distinct marker, so a consumer can log that this allow went through a
human gate.

`tellLLM` **never falls back to `reason`**: a routing tag is telemetry, not an
explanation a reader can act on. Omit it and the model gets a deliberately
generic `"Tool '<name>' is not available in this context."`

## Related

- **[Governance & policy](https://agentfootprint.dev/docs/infrastructure/governance-and-policy)** — the full surface
- **[Pause / Resume](./01-pause-resume.md)** — interactive human approval, the
  other answer to "a person must decide this"
- **[Audit export](./19-audit-export.ts)** — the tamper-evident record these
  decisions land in
