**Support** — adapters behind the `CodeRunner` port: somewhere to execute code
that is not this process.

## What it reads / what it writes
Reads the code and limits handed to it; returns the result. No scope, no policy,
no sentence for a model — `src/core/codeRunnerTool.ts` composes what the model
reads about a run.

## The one law here
Vendor (or OS) shape stops at this file.

## Files
- `local.ts` — run code in a child process on this machine.
- `agentcore.ts` — run code in a managed cloud sandbox.
