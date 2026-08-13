# `adapters/google` — the Vertex AI layer

One file, `aiPlatform.ts`, and three adapters that sit on it. Nothing else in
this package builds a Vertex client, names a Vertex resource, waits on a Vertex
operation, or describes a Vertex failure.

| adapter | port | lives in |
|---|---|---|
| `agentEngineSessions` | `SessionLifecycle` | `adapters/hosting/googleAgentEngine.ts` |
| `memoryBankStore` | `MemoryStore` | `adapters/memory/memoryBank.ts` |
| `googleIdentity` | `CredentialProvider` | `adapters/identity/google.ts` (its own SDK — see below) |

The first two share `aiPlatform.ts`. `googleIdentity` does not: it loads
`google-auth-library` directly, because vending a token is a different job from
calling a data plane and coupling them would make the identity adapter drag in
27 MB it has no use for.

## Why this directory exists

The AWS column learned it expensively: a shim duplicated across three adapters
is three places for one wire fact to go stale, and only one of them gets fixed.
So the connection, the resource-name grammar, the long-running-operation wait
and the failure sanitizer live here once.

## The four facts this layer is built on

All read off a real install of `@googleapis/aiplatform` 31.0.0, before any
adapter code was written. The scratch pin that produced them is reproducible:
install the package, enumerate the prototype chain, read `build/v1.d.ts`.

1. **The client is the SPLIT package.** `@googleapis/aiplatform` (27 MB), not
   `googleapis` (209 MB) which carries every Google API for the same generated
   code. `@google-cloud/aiplatform` (the gax/proto client, 78 MB) was rejected
   on a fact rather than on size: its Memory Bank surface is **v1beta1 only**,
   while REST **v1** has `memories.purge` and `memories.rollback`.
   `@google-cloud/vertexai` is past its own removal date and is never loaded.

2. **The default host is the WRONG one.** The generated client defaults to
   `https://aiplatform.googleapis.com/` — global. Reasoning engines, their
   sessions and their memories are regional. `buildAiPlatformClient` therefore
   always sets `rootUrl: https://{location}-aiplatform.googleapis.com/`. A
   default accepted here is a 404 that reads exactly like "your resource does
   not exist". The surface pin asserts the package's default really is the
   global one, so this paragraph cannot go stale quietly.

3. **Half the writes are long-running operations.** `sessions.create`,
   `sessions.delete`, `memories.create`, `memories.patch` and `memories.delete`
   answer with an Operation; `get`, `list`, `retrieve` and `sessions.patch`
   answer with the resource. Every write goes through `awaitOperation` and does
   not return until the service reports `done`. A write that returned early,
   followed by a read, is a race whose failure mode is "no data" — which nobody
   can tell from the truth.

4. **Both collections take caller-supplied ids.** `sessions.create` accepts a
   `sessionId`, `memories.create` accepts a `memoryId`. So our ids ARE the
   resource ids: no mapping table, and a read is a `get` by name rather than a
   listing.

## Two laws every file here follows

**Secrets never in errors.** `googleSdkFailure` withholds the SDK's own message
and reports the operation plus the HTTP status. Not because a Vertex error
always contains a secret, but because a REST client echoes the request into its
failure text, our requests carry conversation state and an access token, and an
error thrown from an adapter reaches the model as a tool result *and* rides the
event stream to every sink. The original is never attached as `cause` — that
travels into every serializer that walks own properties.

**A refusal is reported once.** `awaitOperation`'s refusals carry
`OPERATION_ERROR_NAME`; `isSanitizedGoogleError` is how a caller's `catch` tells
"already diagnosed" from "still needs sanitizing". Wrapping twice replaces a
precise diagnosis ("did not finish within 30000ms") with a generic one, which is
its own kind of silently wrong.

## Adding a fourth adapter

1. Scratch-pin the SDK surface first — read the installed `.d.ts`, do not trust
   a doc page.
2. Add the calls to `AiPlatformClientLike` here, not in your adapter.
3. Add a row to `GOOGLE_SURFACE_PINS` (`kind: 'rest'`, dotted method paths).
   The completeness assertion fails the build for any `src/**` file that loads a
   Google package without one.
4. Every write that returns an Operation goes through `awaitOperation`, outside
   the `try` that sanitizes transport failures.

## Status

All three adapters are **contract-shaped and tested; awaiting field use**. Every
call is exercised through an injected `_client` and pinned against the
really-installed SDK on every test run. None has yet answered a request from
Google in a real project.
