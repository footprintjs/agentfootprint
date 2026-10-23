---
title: hostFilled
---

# Function: hostFilled()

## Call Signature

> **hostFilled**\<`T`\>(`tool`, `fills`): [`Tool`](/docs/api/interfaces/Tool)

Defined in: [src/tools/hostFilled.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L173)

Declare tool arguments as filled by the host.

One tool: every named argument must be a property of its `inputSchema`.
A list (e.g. `mcpClient().tools()`): each tool takes the fills for the
arguments IT declares and is returned unchanged when it declares none; an
argument no tool in the list declares is refused (a typo would otherwise
hide nothing).

### Type Parameters

#### T

`T` *extends* [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>

### Parameters

#### tool

`T`

#### fills

`Readonly`\<`Record`\<`string`, [`HostFill`](/docs/api/type-aliases/HostFill)\>\>

### Returns

[`Tool`](/docs/api/interfaces/Tool)

### Throws

TypeError at build — an unknown argument, a fill that is not one,
  a credential fill with no service on a tool that declares no `needs`, a
  service that disagrees with the tool's own `needs`, or an argument the
  tool also declares under `wants` / `askOrAssume`.

## Call Signature

> **hostFilled**(`tools`, `fills`): readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

Defined in: [src/tools/hostFilled.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L177)

Declare tool arguments as filled by the host.

One tool: every named argument must be a property of its `inputSchema`.
A list (e.g. `mcpClient().tools()`): each tool takes the fills for the
arguments IT declares and is returned unchanged when it declares none; an
argument no tool in the list declares is refused (a typo would otherwise
hide nothing).

### Parameters

#### tools

readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

#### fills

`Readonly`\<`Record`\<`string`, [`HostFill`](/docs/api/type-aliases/HostFill)\>\>

### Returns

readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

### Throws

TypeError at build — an unknown argument, a fill that is not one,
  a credential fill with no service on a tool that declares no `needs`, a
  service that disagrees with the tool's own `needs`, or an argument the
  tool also declares under `wants` / `askOrAssume`.
