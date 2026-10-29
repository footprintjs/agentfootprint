---
title: sandboxPath
---

# Function: sandboxPath()

> **sandboxPath**(`path`): `string`

Defined in: [src/provider-contract/codeSandbox.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/codeSandbox.ts#L110)

One session path, checked and put in canonical form — THE path rule every
adapter applies before it reads a file.

Refused, by name, before anything is sent:
  - an empty path, and one that names the working directory itself (`.`);
  - an absolute path (`/etc/passwd`) and a drive (`C:…`);
  - a leading `~`, which a shell would read as a home directory;
  - any backslash — a separator on one platform and an ordinary character
    on another, so `a\..\..\x` cannot be judged the same way everywhere;
  - a NUL, which ends a path early in the operating system's own calls;
  - a `..` that climbs above the working directory (`../x`, `a/../../x`).

A `..` that stays inside is resolved here (`a/../b` → `b`), `.` and empty
segments are dropped (`./out//a.csv` → `out/a.csv`), and the result never
contains `..` at all — so no backend is ever handed a parent hop to
interpret. Lexical, not physical: on the caller's own machine a symbolic
link can still point elsewhere, which `localCodeRunner` checks separately.

## Parameters

### path

`string`

## Returns

`string`

## Throws

CodeSandboxError with reason `'path-refused'`.
