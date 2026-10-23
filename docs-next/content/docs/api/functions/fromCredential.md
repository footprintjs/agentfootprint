---
title: fromCredential
---

# Function: fromCredential()

> **fromCredential**(`options?`): [`HostFillFromCredential`](/docs/api/interfaces/HostFillFromCredential)

Defined in: [src/tools/hostFilled.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L76)

Fill the argument from the call's credential. With `service`, the tool's
`needs` is declared for you (a tool that already declares one must name the
same service, or omit `service`).

## Parameters

### options?

`Omit`\<[`HostFillFromCredential`](/docs/api/interfaces/HostFillFromCredential), `"from"`\> = `{}`

## Returns

[`HostFillFromCredential`](/docs/api/interfaces/HostFillFromCredential)
