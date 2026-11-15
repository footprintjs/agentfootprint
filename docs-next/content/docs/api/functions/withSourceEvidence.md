---
title: withSourceEvidence
---

# Function: withSourceEvidence()

> **withSourceEvidence**\<`TArgs`, `TResult`\>(`tool`, `descriptor`): [`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>

Defined in: [src/tools/sourceEvidence.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L105)

Declare an exact historical source association without wrapping tool execution.
Only an opted-in native Agent can retain a governed observation. Direct execute,
model-authored JSON and application artifacts cannot append its trusted index.

## Type Parameters

### TArgs

`TArgs`

### TResult

`TResult`

## Parameters

### tool

[`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>

### descriptor

[`SourceEvidenceDescriptor`](/docs/api/interfaces/SourceEvidenceDescriptor)\<`TResult`\>

## Returns

[`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>
