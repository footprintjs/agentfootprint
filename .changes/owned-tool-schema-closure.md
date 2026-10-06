---
type: fixed
---
**`read_skill` and `run_code` reject undeclared arguments.** Their owning schema factories now declare `additionalProperties: false`: `read_skill` permits `id`, and `run_code` permits `code` plus its configured `wants` names. The full skill catalog, graph teaching refusals, optional artifact inputs, custom code-tool names, and runtime-enabled `_findings` remain supported.

Compatibility: with default argument enforcement, remove previously tolerated extra fields from calls or middleware-added arguments. The public `readSkillDescriptor` schema also exposes this restriction to external hosts. Agent `warn` and `off` policies and direct `execute` calls are unchanged; direct execution does not gain a validator.
