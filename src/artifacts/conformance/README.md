# `ArtifactStore` conformance

A shared test battery every artifact store runs against, in-tree or out.

## Why this exists

The port's promise is that a tool written against `inMemoryArtifacts` behaves
the same against a bucket. Five stores ship here — a `Map`, a directory, a
SQLite file and two object columns — and until this battery existed the shared
laws lived in a **test file**, which meant they shipped to nobody: `package.json`
excludes `dist/test`, so a sixth store written by somebody else had no way to
run the same checks.

That gap has a known shape. In the sibling port (`SessionLifecycle`) a
split-brain ownership defect was live in FOUR stores at once; all four were
tested, and none of the tests could see it, because **every store was tested
against its own doubles** — so a flaw in the PORT's semantics was invisible to
all of them simultaneously. Five artifact stores, five sets of doubles, same
risk. So the laws live here, against the port, exported beside it.

## Using it

```ts
import { runArtifactStoreConformance, formatArtifactStoreReport } from 'agentfootprint';

const report = await runArtifactStoreConformance({
  name: 'ourOwnArtifacts',
  createStore: () => ourOwnArtifacts({ bucket, clock }),
  disposeStore: (store) => store.close(),
  advanceTime: (store, ms) => clock.tick(ms),
  corrupt: (store, scope, ref) => bucket.overwrite(keyOf(scope, ref), 'tampered'),
  boundedStore: (maxBytesPerScope) =>
    ourOwnArtifacts({ bucket, clock, retention: { maxBytesPerScope } }),
});

if (!report.ok) throw new Error(formatArtifactStoreReport(report));
```

One assertion per case, in whatever framework you use — the shape you want in a
suite, because a battery that fails as one blob tells you a store is broken and
not which promise it broke:

```ts
import { artifactStoreConformance, runArtifactStoreCase } from 'agentfootprint';

for (const testCase of artifactStoreConformance) {
  it(testCase.name, async () => {
    const outcome = await runArtifactStoreCase(testCase, harness);
    expect(outcome.status).not.toBe('failed');
  });
}
```

Nothing here imports a test framework. A case throws to fail — the one
convention every runner already agrees on — so the battery works under vitest,
jest, `node:test` or a plain script.

## The harness

A **factory**, not a store instance. Most of the battery needs a store with
nothing in it (a listing case that saw another case's rows would be asserting on
somebody else's fixtures), and a store that has been closed, or whose directory
was removed, cannot be reset in place. One store per case, disposed after it, is
the only shape that holds for a `Map`, a directory, an embedded database and a
bucket at once.

| field                        | for                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `name`                       | what the store is called in a report                                                             |
| `createStore()`              | a fresh, empty store. Sync or async — stores differ                                              |
| `disposeStore(store)`        | release it. Called even when the case failed                                                     |
| `advanceTime(store, ms)`     | move THIS store's clock forward. Expiry cannot be observed without it, and sleeping for it is how a case gets deleted |
| `corrupt(store, scope, ref)` | replace one artifact's stored payload with different, well-formed bytes, behind the store's back  |
| `boundedStore(maxBytes)`     | the same store with a small per-scope byte budget — a ceiling is configuration, not a verb        |
| `declared`                   | cases this store cannot satisfy, **by name**, each with the reason                                |

The three hooks exist because none of them can be asked for through the port: a
store has no clock verb, no "damage yourself" verb, and no way to be re-created
with a different budget from the inside.

## Not-applicable, declared, failed

Three ways a case does not simply pass, and they mean different things:

- **`'not-applicable'`** — the case is about an OPTIONAL port member
  (`putStream`, `getStream`) this store does not implement. That is feature
  detection, which is the port's own rule: a store that would have to hold a
  payload whole must leave those members ABSENT rather than fake a stream.
- **`'declared'`** — the store implements the member and still cannot satisfy
  the case, for a stated reason. A `Map` closed over by its own factory
  genuinely cannot be corrupted from outside. **The case is run anyway**: if it
  passes, the report marks the declaration `STALE`, because a suppression nobody
  revisits is how a fixed defect keeps its exemption and a real one inherits it
  later.
- **`'failed'`** — including _"this case needed a harness hook nobody supplied
  and nobody declared"_. An undeclared skip is a pass with the evidence removed,
  which is the same shape as every defect above.

There is deliberately no way to make a case quietly disappear.

## The cases

| case                                                      | the law                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `put-mints-a-ticket-head-describes-get-redeems`            | head describes without the payload; get redeems both; a sweep is a fact           |
| `payloads-round-trip-as-the-value-they-were-given`         | JSON, text and binary come back as the values they went in as                    |
| `refs-are-minted-never-derived-from-the-payload`           | identical bytes are two artifacts with two refs; the digest is never the key      |
| `a-ref-alone-opens-nothing`                                | under any other scope a ref heads, gets, lists and deletes as if it never existed |
| `confusable-scopes-are-not-one-scope`                      | tuples a naive encoder spells identically stay two scopes                        |
| `missing-expired-and-foreign-scope-are-one-absence`        | one indistinguishable `null`, never an error and never a different shape         |
| `expiry-is-stated-at-mint-never-sprung`                    | expiry rides the ticket; a store may only TIGHTEN it; born-expired is refused     |
| `delete-removes-and-deleting-an-absence-is-agreement`      | deletion deletes, listing included, and is idempotent                            |
| `list-pages-newest-first-and-carries-no-payload`           | every row once, this scope only, a cursor only when more exist                   |
| `awkward-scope-values-are-names-not-paths`                 | slashes, dots, unicode and long values are data, and never fold into each other  |
| `oversized-payload-is-refused-before-the-write`            | over the whole budget is refused at the door, and nothing partial lands           |
| `parent-refs-are-proven-at-mint`                           | a foreign key cannot dangle at birth, and cannot be proven across scopes          |
| `malformed-puts-are-refused-by-name`                       | blank kind, blank mediaType, unknown digest, a payload JSON cannot carry          |
| `refusals-carry-no-payload-and-no-scope`                   | a refusal teaches without quoting the payload, the tenant or the principal        |
| `digest-is-minted-over-the-payload-and-rides-the-ticket`   | one algorithm, one spelling, same bytes ⇒ same digest, absent unless asked for    |
| `get-refuses-a-payload-that-no-longer-matches-its-digest`  | the verifying read refuses by name; the ticket survives its parcel                |
| `get-stream-does-not-verify-the-digest`                    | the 9.25.0 asymmetry, pinned: bounded memory, NOT bounded integrity               |
| `streamed-put-round-trips-and-declares-its-bytes`          | the other five verbs answer for it; a payload contradicting its `bytes` is refused |
| `streaming-members-are-feature-detected`                   | present as functions or absent — never faked over bytes already held whole         |

## Files

- `types.ts` — the harness, the case, the outcome. The case-name union is closed
  on purpose: a declaration naming a case that was renamed would go on
  suppressing nothing.
- `cases.ts` — the battery. One law each, stated in the case's `law` field so a
  failure reads as a broken promise.
- `run.ts` — the three not-run decisions, the report, the formatter.

The in-tree binding (five harnesses, one `it()` per case per store, plus the
tests that hold the battery's own rules) is
`test/artifacts/store-conformance.test.ts`.
