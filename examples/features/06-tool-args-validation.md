---
name: Tool-args validation — model-visible retry
group: features
guide: ../../README.md#features
defaultInput: echo the word hello three times
---

# Tool-args validation — model-visible retry

The LLM writes tool args as free-form JSON; nothing used to guarantee they
match the schema the tool advertised. With `toolArgValidation` (default
`'enforce'`), args are validated against the tool's `inputSchema` BEFORE
dispatch:

- a mismatch **rejects the call** — the tool never executes;
- the model receives a **structured retry message** as the tool result
  (paths + expected shapes + received TYPES — never the supplied values,
  which can carry PII or injection payloads);
- the model **corrects its args on the next ReAct iteration**;
- `agentfootprint.validation.args_invalid` is emitted with the issues.

Modes: `'enforce'` (default) · `'warn'` (event only, executes anyway) ·
`'off'` (skip validation).

Validation is an honest JSON-Schema subset — `type` (incl. unions),
`required`, nested `properties`/`items`, primitive `enum`, and
`additionalProperties: false` only when explicitly set. Unsupported
keywords (`pattern`, `oneOf`, `$ref`, …) are ignored, never
false-rejecting.

Ordering: the permission gate sees every attempted call first; validation
runs only on calls that would dispatch, and a rejected call never resolves
credentials.
