**Support** — one adapter behind the `BrowserRunner` port: a managed browser an
agent can drive and a person can watch.

## What it reads / what it writes
Reads the caller's session configuration; writes nothing on scope. Every fact a
run keeps about a browser session travels through the events the recorders own.

## The one law here
Vendor shape stops at this file. The port stays the library's own.

## Files
- `agentcore.ts` — a managed Chrome in a cloud account, as a `BrowserRunner`.
