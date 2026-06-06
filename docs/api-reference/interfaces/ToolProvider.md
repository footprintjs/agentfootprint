[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolProvider

# Interface: ToolProvider

Defined in: [src/tool-providers/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L121)

The provider interface. A `ToolProvider` answers ONE question per
iteration: "what tools should the LLM see right now?"

Implementations are PURE — given the same context, return the same
tool list (no observable mutation; reentrant; safe under concurrent
calls).

**Sync vs async.** Most providers (`staticTools`, `gatedTools`,
`skillScopedTools`) compute the answer synchronously and return
`readonly Tool[]` — the agent's hot path skips the await microtask
entirely via a runtime `instanceof Promise` check. Discovery-style
providers (MCP catalog fetch, registry pull, dynamic skill resolution)
may return `Promise<readonly Tool[]>`; the agent awaits only when
the value is actually a Promise. Sync providers pay zero overhead.

**Caching.** The agent calls `list(ctx)` once per iteration. For
expensive lookups (network calls, hub queries), the provider is
responsible for caching — typically TTL- or iteration-keyed. The
framework deliberately does NOT cache for you because the cache
key depends on which fields of `ctx` matter to your provider
(e.g., per-skill vs per-tenant vs per-iteration).

**Errors.** A throwing or rejecting provider emits
`agentfootprint.tools.discovery_failed` and aborts the iteration —
the run continues only if a configured `reliability` rule routes
the error (`fail-fast`, `retry`, etc.). Discovery failure is loud
by design; silently dropping tools mid-conversation produces
non-deterministic agent behavior that's harder to debug than a
crash.

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/tool-providers/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L139)

Optional: stable id for observability / debugging. Defaults to
`'static'` for `staticTools`, `'gated'` for `gatedTools`. Custom
implementations should set their own id — surfaces on
`agentfootprint.tools.discovery_failed.providerId` so consumers
can route alerts to the right hub adapter.

## Methods

### list()

> **list**(`ctx`): readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[] \| `Promise`\<readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]\>

Defined in: [src/tool-providers/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L130)

Return the tool list visible to the LLM for the current iteration.
Sync return is the fast path; Promise return is supported for
discovery-style providers. The returned array MUST be a NEW
reference each call (the agent compares for change detection).
Order is preserved — the LLM may use position as a hint when tool
descriptions are ambiguous.

#### Parameters

##### ctx

[`ToolDispatchContext`](/agentfootprint/api/generated/interfaces/ToolDispatchContext.md)

#### Returns

readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[] \| `Promise`\<readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]\>
