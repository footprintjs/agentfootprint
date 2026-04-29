---
name: Permissions — tool-call gating
group: features
guide: ../../README.md#features
defaultInput: delete the test record
---

# Permissions — tool-call gating

Supply a `permissionChecker` to the Agent. Before every `tool.execute`,
the Agent calls `checker.check({capability: 'tool_call', target: <tool>, context: <args>})`
and emits `permission.check` with the decision. On `deny`, the tool is
skipped and the LLM sees a synthetic denial string so the conversation
stays coherent. A throwing checker is treated as **deny by default**
(fail-closed) — the thrown error lands in the `rationale`.

## When to use

- **Compliance policies** — read-only mode, destructive-op allowlist,
  per-role gating.
- **External policy engines** — wrap OPA, Cerbos, or your own service
  in a `PermissionChecker` adapter.
- **Rate / cost gating** — return `deny` when a per-user quota is exceeded.

## Key API

```ts
const checker: PermissionChecker = {
  name: 'my-policy',
  check: async (req) => {
    if (isAllowed(req)) return { result: 'allow' };
    return { result: 'deny', rationale: 'policy X forbids Y' };
  },
};

const agent = Agent.create({ provider, model, permissionChecker: checker }).build();
```

## Decision shape

```ts
PermissionDecision = {
  result: 'allow' | 'deny' | 'gate_open';
  rationale?: string;
  policyRuleId?: string;
  gateId?: string;
}
```

`gate_open` is treated as `allow` by the Agent but emits a
distinct marker so the consumer can log that this allow went through
a human gate.

## Related

- **[Pause / Resume](./01-pause-resume.md)** — interactive human
  approval alternative
