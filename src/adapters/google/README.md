# `adapters/google` — the Vertex AI layer

One file, `aiPlatform.ts`, and three adapters that sit on it. Nothing else in
this package builds a Vertex client, names a Vertex resource, waits on a Vertex
operation, or describes a Vertex failure.

| adapter               | port                 | lives in                                                          |
| --------------------- | -------------------- | ----------------------------------------------------------------- |
| `agentEngineSessions` | `SessionLifecycle`   | `adapters/hosting/googleAgentEngine.ts`                           |
| `memoryBankStore`     | `MemoryStore`        | `adapters/memory/memoryBank.ts`                                   |
| `googleIdentity`      | `CredentialProvider` | `adapters/identity/google.ts` (its own SDK — see below)           |
| `firestoreSessions`   | `SessionLifecycle`   | `adapters/hosting/firestoreSessions.ts` (its own SDK — see below) |

The first two share `aiPlatform.ts`. `googleIdentity` does not: it loads
`google-auth-library` directly, because vending a token is a different job from
calling a data plane and coupling them would make the identity adapter drag in
27 MB it has no use for.

`firestoreSessions` does not either, and for a stronger reason than size: it is
not a Vertex adapter at all. Firestore is a different product on a different
protocol, and the two facts `aiPlatform.ts` is built on do not hold there — a
Firestore error's numeric `code` is a **gRPC status**, not an HTTP one, so
`httpStatusOf` would read a `NOT_FOUND` as "HTTP 5" and a missing index as
"HTTP 9". Sharing the sanitizer would have been a smaller diff and a wrong one.
It lives on this column's table because it is a Google adapter and this is where
the Google column's status is recorded.

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
error thrown from an adapter reaches the model as a tool result _and_ rides the
event stream to every sink. The original is never attached as `cause` — that
travels into every serializer that walks own properties.

**A refusal is reported once.** `awaitOperation`'s refusals carry
`OPERATION_ERROR_NAME`; `isSanitizedGoogleError` is how a caller's `catch` tells
"already diagnosed" from "still needs sanitizing". Wrapping twice replaces a
precise diagnosis ("did not finish within 30000ms") with a generic one, which is
its own kind of silently wrong.

## Adding another Google adapter

1. Scratch-pin the SDK surface first — read the installed `.d.ts`, do not trust
   a doc page. Steps 2 and 4 apply only if you are on Vertex.
2. Add the calls to `AiPlatformClientLike` here, not in your adapter.
3. Add a row to `GOOGLE_SURFACE_PINS`. The completeness assertion fails the build
   for any `src/**` file that loads a Google package without one. Pick the
   `kind` that matches how the surface is really reached — `'rest'` for a
   discovery resource tree, `'chain'` for a factory chain, `'class'` for an SDK
   that exports its classes and can be read off prototypes.
4. Every write that returns an Operation goes through `awaitOperation`, outside
   the `try` that sanitizes transport failures.
5. If the SDK is not REST — Firestore is gRPC — write its own failure sanitizer
   rather than reusing `googleSdkFailure`. The numeric `code` means something
   different, and a sanitizer that misreads it reports the wrong failure with
   full confidence.

## The fourth adapter, and the one line of its status that matters

`firestoreSessions` is **contract-shaped and tested — NOT field-validated.**
Nothing in this repository has run it against a live Firestore. What HAS been
done is the surface pin: the 18 members it calls were hand-verified against a
real install of `@google-cloud/firestore` 9.0.0 in a scratch project outside this
repository — seventeen read off `types/firestore.d.ts` before a line was written,
and `DocumentSnapshot.id` verified afterwards, when a review found the row had
pinned the sibling `DocumentReference.id` (real, but never read here) in place of
the member the listing cursor actually reads.

Say the rest plainly, because this row is the one exception to the column's own
doctrine. `@google-cloud/firestore` is **not** a devDependency here: it depends
on `@opentelemetry/api`, and installing it hoists that package to the root and
disarms `test/observability-providers/otel.test.ts`, which proves
`otelObservability()` refuses by name when `@opentelemetry/api` is absent. So
the `firestoreSessions` row carries a `notInstalled` exemption, and **the
reality assertion SKIPS in this repository.** It runs in full for anyone who
installs `@google-cloud/firestore` locally, on the machine where a mismatch can
still be fixed. What is machine-checked in CI is the **shape** pin — the adapter
dispatches exactly the members the row names and no others — not the reality
pin. (The row is `kind: 'class'`: Firestore exports the whole chain, so where
the check does run it reads the surface off prototypes, with nothing constructed
and no credential involved.)

Its **design was informed by a field trial of a different Firestore adapter**,
and it is worth being precise about what that buys, because "informed by a field
trial" is the kind of phrase that quietly becomes "validated". That trial ran
against a real Firestore and passed eight ownership and history checks — so the
ownership and history SEMANTICS are known to survive a real service. It also
named its own defect: it read every document for one owner, sorted them in the
client, and applied an offset cursor. That works until somebody has a lot of
conversations, and then a page costs a full read of all of them.

So this adapter does the opposite — a server-side `where` + `orderBy`, paged with
a real Firestore cursor — and the trial proves **nothing** about that query, its
cursor, its transaction or its composite index, because the adapter that was
tried had none of them. Three things follow, all of them still unproven here:

- the composite index (`owner ASC, savedAt DESC, __name__ DESC`) has never been
  created against a real project, so the `FAILED_PRECONDITION` refusal is built
  on documented behaviour rather than on a measured one;
- the write-once ownership transaction has never been contended by two real
  containers — it is contended by a double that models the SDK's documented
  retry;
- the 1 MiB document ceiling is refused locally, before the wire, so the
  service's own refusal has never been seen.

## Status

All three Vertex adapters were **field-validated on 2026-08-14** — an independent trial
ran this code against live Agent Runtime resources, not a double. Two of them
came back with a defect, and both are fixed in 9.30.0:

| Adapter               | What the live run proved                                                                                                                                                                                                                                        | What it found, and what changed                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentEngineSessions` | create · hydrate through a fresh instance · owners preserved · paged `listByUser` · `ownerOf` · unknown envelope format refused before storage · idempotent `forget`                                                                                            | **The second write to a session was impossible.** 9.29.0 patched `sessionState`; the service refuses that and says so (`HTTP 400 — you can only update it by appending an event`). 9.30.0 appends an event, the repair the same trial verified on the wire              |
| `memoryBankStore`     | honest `supportsVectorSearch` / `ranksBy` · cross-conversation recall under a widened scope · two identities, one entry id, no collision · JSON values · pagination · tier filter · similarity ordered correctly · scoped delete · `forget` · the five refusals | **Entries were not preserved whole**: `source` and caller `metadata` went in and did not come back. 9.30.0 carries them (plus `decayPolicy`), refuses a caller key that collides with a generated one, and refuses an oversized carried field rather than truncating it |
| `googleIdentity`      | a real bearer from ADC authorized a Vertex call (HTTP 200) · `bearer` kind · ~3,599 s expiry · re-vend without reconstruction · `mode: 'user'` and a disallowed service both failing **closed** · `JSON.stringify` leaking nothing but `{"kind":"bearer"}`      | Nothing to fix. **Still unproven:** an expiry-triggered refresh — the run did not span an hour                                                                                                                                                                          |
| `firestoreSessions`   | **Nothing. This adapter has not been run live by us**                                                                                                                                                                                                           | Contract-shaped and tested only — see the section above for what a trial of a DIFFERENT adapter did and did not establish                                                                                                                                               |

Neither repair has itself been re-run in a live project. Both are built on
service behaviour that trial measured, and both are held by tests here: the
session double now **refuses a patch exactly as the service does**, and the pin
row for sessions carries no `patch` at all.

### What an earlier field trial established about the services underneath

An earlier round ran the raw GCP data planes these adapters wrap, before any of
this code existed. It is evidence about **Google** rather than about these
adapters, and three of its findings are load-bearing here:

- **A retrieved memory name is not the name you wrote.** Create and list echoed
  caller-chosen ids; similarity retrieval answered with generated numeric
  resource names for the same facts. `memoryBank.ts` reads entry ids from
  metadata and never from `memory.name` — see its module header.
- **`Session.userId` is metadata, not authorization.** The project's ordinary
  ADC principal read two different users' sessions by name without presenting
  either user's identity. The ownership check belongs above the port; see the
  header of `adapters/hosting/googleAgentEngine.ts`.
- **Exact-scope semantics and distance-ranked retrieval are real.** A partial
  scope retrieved nothing, and similarity came back as Euclidean distances —
  the two behaviours `memoryBankStore` already refuses to paper over.

Two neighbours on this column have live evidence of their own: `gcsArtifacts()`
(field-validated) and `gemini()` on Vertex — the latter now including a live
`gemini-3.1-flash-lite` tool loop through the thought-signature round trip.
