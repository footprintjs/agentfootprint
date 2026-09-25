[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / runbookAsTool

# Function: runbookAsTool()

> **runbookAsTool**(`opts`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)

Defined in: [src/core/runbook/runbookAsTool.ts:180](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/runbookAsTool.ts#L180)

Wrap a footprintjs procedure as a `Tool` whose every answer carries the
honesty spine. See the module header for the envelope; see
[RunbookAsToolOptions](/agentfootprint/api/generated/interfaces/RunbookAsToolOptions.md) for the full options bag. The smallest legal
call is `{ name, description, procedure }`.

## Parameters

### opts

[`RunbookAsToolOptions`](/agentfootprint/api/generated/interfaces/RunbookAsToolOptions.md)

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)
