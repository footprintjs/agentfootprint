---
title: validateMessages
---

# Function: validateMessages()

> **validateMessages**(`catalog`, `requiredKeys`, `opts?`): `void`

Defined in: [src/locales/index.ts:146](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/locales/index.ts#L146)

Assert that every key in `requiredKeys` is present in `catalog`.
Throws an Error listing every missing key — batched so consumers
fix all at once instead of error-by-error.

Useful at boot to catch drift between a consumer's locale pack and
the framework's required key set.

Empty-string values are VALID by default — the framework's default
catalogs use `''` to signal "render nothing for this event."
Pass `{ forbidEmpty: true }` to also reject empty values.

## Parameters

### catalog

`Readonly`\<`Record`\<`string`, `string`\>\>

The (composed) message catalog to validate.

### requiredKeys

readonly `string`[]

The keys consumers must define. Typically
                     `Object.keys(defaultCommentaryMessages)` or
                     `Object.keys(defaultThinkingMessages)`.

### opts?

`string` \| `ValidateMessagesOptions`

Optional `{ label, forbidEmpty }` (or a bare
                     string label for back-compat with simple use).

## Returns

`void`

## Throws

Error when any required key is missing (or empty under
              `forbidEmpty`).
