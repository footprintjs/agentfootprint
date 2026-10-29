---
type: fixed
---
**Code runners stop waiting on time and report a killed process as it was.** `agentCoreCodeRunner`'s `execute` now honours `timeoutMs` and `signal`; it ignored both, so an aborted run kept waiting on the sandbox. The wait ends at the deadline with a `CodeSandboxError` (`reason: 'timed-out'`, saying the code may still be running in the session) or with the caller's own abort reason. `localCodeRunner` no longer reports an aborted child as a missing interpreter ("could not run … (ABORT_ERR)"): the abort comes back as the caller's reason. A child the operating system ended with a signal now has no `exitCode` instead of a made-up `1`; `ok` is still `false`.
