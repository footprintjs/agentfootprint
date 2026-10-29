---
type: fixed
---
**Code runners stop on time, and say what happened to a process they stopped.**

- `agentCoreCodeRunner`'s `execute` now honours `timeoutMs` and `signal`. It ignored both, so an aborted run kept waiting on the sandbox. The wait ends at the deadline with a `CodeSandboxError` (`reason: 'timed-out'`), which says the code may still be running in the session, or with the caller's own abort reason. One deadline covers the whole execution, including the setup call that exposes staged inputs.
- `localCodeRunner`'s timeout is now a real bound. The runtime's own timeout sent SIGTERM and then waited, so a child that ignored SIGTERM ran on, and if it then exited 0 the run came back as a success with its output cut at the deadline. Now the child is killed with SIGKILL at the deadline and the run fails with `CodeSandboxError` (`reason: 'timed-out'`); the message for `execute` is unchanged. A timeout past about 24.8 days no longer fires after 1 ms.
- `localCodeRunner` no longer blames a missing interpreter for an aborted child ("could not run … (ABORT_ERR)"); the abort comes back as the caller's reason.
- Output past the 32 MiB buffer is no longer blamed on a missing interpreter either. It is a result: the output kept so far, the cut stated on `truncated`, and no exit status.
- A child the operating system ended with a signal now has no `exitCode` instead of a made-up `1` (`ok` is still `false`).
- A failed child whose stderr was empty used to get the runtime's message ("Command failed: <the whole command line>") as its stderr, so the code itself reached the tool result. Now its stderr stays empty; the exit status line already says it failed.
