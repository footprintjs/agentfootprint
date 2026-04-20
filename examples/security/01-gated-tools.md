---
name: Permission-gated tools
group: security
guide: ../../docs/guides/security.md
defaultInput: Search for AI news.
---

# Permission-gated tools

Filter the tool list **before** the LLM sees it. The LLM can't hallucinate a call to a tool it never knew existed. Defense-in-depth: even if a prompt-injection attempt tries to invoke a blocked tool, the call is rejected at execute time and the error flows back into the conversation.

## Why this is novel

MCP allow-lists and OpenAI's tool filtering exist; they operate at a single layer (typically execute-time). Permission-gated tools enforce at **both** layers (resolve **and** execute), wire permission events into the recorder system for audit, and recompute per loop iteration so policies that depend on conversation state work without restarting the agent.

## When to use

- Multi-tenant agents where users have different capability tiers.
- Production safety guardrails — never expose `delete_user`-class tools to non-admins.
- Compliance — a verifiable audit trail of which tools were available to which user.

## What you'll see

The user has permissions for `search` and `run-code` but not `delete-user`. The agent only sees what it's permitted to see:

```
{
  content: 'I searched for AI news. I cannot delete users as I do not have admin access.',
  blocked: [{ id: 'delete-user', phase: 'resolve' }],
  permissions: ['search', 'run-code'],
}
```

## Key API

- `gatedTools(toolProvider, checker, { onBlocked? })` — wraps any `ToolProvider`. `checker(toolId, ctx)` returns boolean; throws are treated as DENY (fail-closed).
- `PermissionPolicy.fromRoles({ user: [...], admin: [...] })` — centralized role-based policy.
- `PermissionRecorder` — captures every block / allow / deny event for audit.

## Related

- [security guide](../../docs/guides/security.md) — full primitives, role-based policies, audit trail.
- [resilience/02-provider-fallback](../resilience/02-provider-fallback.md) — provider-level resilience pairs with tool gating.
