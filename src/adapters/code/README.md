**Support** — adapters behind the `CodeRunner` port: somewhere to execute code
that is not this process.

## What it reads / what it writes
Reads the code, commands, files and limits handed to it; returns the result. No
scope, no policy, no sentence for a model — `src/core/codeRunnerTool.ts`
composes what the model reads about a run.

## The one law here
Vendor (or OS) shape stops at these files, and a result says only what the
backend reported.

## Files in and out — the rules, and why

**1. A result says only what the backend reported; unknown stays unknown.**
`CodeResult.ok` is `true` or `false` only when the backend said which (an exit
status, or its own error verdict) and is ABSENT otherwise. A command's
`exitCode` is the reported one or absent — never read off an error flag, never
defaulted. *Why:* `agentCoreCodeRunner` used to fill `ok: true` when AgentCore
reported neither an exit status nor an error, and `localCodeRunner` reported an
exit code of 1 for a child the OS killed. Both were success or failure made up
from silence, and the model and the run record believed them. A `false` says
which kind it is: `exitCode` (a program that exited), `serviceError` (the
backend flagged an error with no exit status, so the run is unconfirmed), or
`terminatedBy` (the signal that ended a process before it exited), and
`codeRunnerTool` prints `[exit N]` only when N was supplied.

**2. Bytes travel as bytes; a file comes back whole or not at all.**
`stageInputs` sends text as `text` and bytes as AgentCore's `blob` — never base64
inside text with a decode step. `readFile(path, { maxBytes })` returns the file
the backend returned, paired to the path by the URI the backend put on it; a
missing or different URI, two files, or a file with both text and bytes is
refused (`CodeSandboxError`), and a file over `maxBytes` is refused, never cut.
Text or bytes is decided by which field the backend filled, never by the file's
extension. *Why:* pairing by position hands back somebody else's file when a
backend answers out of order, and a cut file read as the whole file is the
silent success this port refuses everywhere else. The URI is read ONE way, as a
`file:///` URI: each segment percent-decoded, a raw `?` or `#` refused as the
query or fragment it is (a name holding one arrives as `%3F` / `%23`), an
encoded `/` never a separator — so `file:///report.csv#old` never answers a
read of `report.csv#old`.

**3. One path rule, both adapters.** `provider-contract/codeSandbox.ts` ·
`sandboxPath` refuses an absolute path, a `..` that climbs above the working
directory, a backslash, a leading `~` and a NUL before anything is read or
sent, and sends the canonical form (`./out//a.csv` → `out/a.csv`).
`localCodeRunner` also checks the file's REAL location, because on the caller's
own machine a symbolic link can lead anywhere. *Why:* two copies of a path rule
are two rules, and the first difference between them is the escape.

**4. Bounded, and the bound is stated.** Output is cut at `maxOutputChars` per
stream and the cut reported on `truncated` (`output.ts`, shared). A staging call
whose request body would pass AgentCore's 100 MB per-call limit is refused before
it is sent (`request-too-large`), measured exactly as the SDK serializes it. A
deadline is a real bound: one per verb (AgentCore's setup call and the code share
it). On POSIX `localCodeRunner` runs each command and each code run in a process
group of its own, and whenever IT ends a run — at the deadline, on an abort, at
the output ceiling — it stops that owned group with SIGKILL, which cannot be
ignored, at that moment (never after the pipes close), and never reports a run
it stopped as a success. That is cleanup, not containment: a descendant that
starts a session or group of its own is outside the owned group, and a host
killed without running its exit handlers stops nothing — the local runner is
not a sandbox. On Windows only the process itself can be stopped, and the error
says work it started may still run. Output past the local runner's 32 MiB buffer
is a stated cut with no exit status. A local read never opens anything that
could make it wait: a named pipe is refused, not read. *Why:* review probes
showed a command's Node child writing a file 300 ms after the caller was told
the command had been killed, and a child holding the inherited pipes writing one
while an over-the-ceiling run waited for those pipes to close.

**5. Commands are opt-in.** `runCommand` runs arbitrary shell, so a session has
it only when the runner is built with `commands: true` (`canRunCodeCommands`).
A printed `checkpoint` proves the command reached that line — nothing about how
it exited.

**6. A gone session is one error — on evidence that names the session.**
`agentCoreCodeRunner` turns a service error naming the session as "not active",
or a `ResourceNotFoundException` on a call that addresses nothing but the session
(code, a command, a write), into `SessionExpiredError`. On a READ the same
exception may mean the file, so it is `'file-not-returned'`, naming both
possibilities. Nothing reconnects: a session name is not an address.

**6b. The manifest is set before every run.** AgentCore takes no environment, so
`AF_STAGED_INPUTS` is set by a setup call before EVERY execution once anything is
staged, inside the same deadline, and its printed line is checked each time.
*Why:* the runtime keeps state the code can change, and a review probe cleared
the variable in one run and found `{}` in the next while the adapter skipped the
setup because it had sent the same JSON before.

**7. Nothing sent is repeated.** No command text and no file contents in an
error, a log or an event. A modelled AgentCore error from a file or command call
names the exception and drops the service's message, which can quote the request.

```ts
import { canReadCodeFiles, canRunCodeCommands } from 'agentfootprint';
import { agentCoreCodeRunner } from 'agentfootprint/providers';

const runner = agentCoreCodeRunner({ identifier: 'aws.codeinterpreter.v1', commands: true });
const session = await runner.start({ key });
await session.stageInputs?.([{ name: 'rows', fileName: 'rows.csv', data: csvText }]);
const step = canRunCodeCommands(session)
  ? await session.runCommand('python3 make_report.py && echo REPORT_DONE', {
      timeoutMs: 120_000,
      checkpoint: 'REPORT_DONE',
    })
  : undefined;
// `step.exitCode` is present only when AgentCore reported one.
if (canReadCodeFiles(session)) {
  const report = await session.readFile('out/report.csv', { maxBytes: 5_000_000 });
}
```

## Files
- `local.ts` — run code (and, opted in, commands) in a child process on this
  machine; read a file back from its working directory.
- `agentcore.ts` — the AgentCore Code Interpreter runner and its session verbs.
- `agentcoreClient.ts` — the client seam and its one mapping onto the AWS SDK
  (the only file here that loads it), including the stream drain.
- `agentcoreWire.ts` — AgentCore's wire rules as pure functions: request size,
  pairing a returned file, the staged-input manifest, which errors mean "gone".
- `output.ts` — the bounded output, a command's result and its option checks.
- `fileName.ts` — the one injective encoder a staged input's name lands under.
