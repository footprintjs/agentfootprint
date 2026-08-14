# `SessionLifecycle` conformance

A shared test battery every session store runs against, in-tree or out.

## Why this exists

In August 2026 a live field trial found a split-brain ownership bug: two writers
signing the same fresh session left `ownerOf(session)` naming the first writer
and the stored envelope carrying the second writer's whole conversation. The
first writer listed the session, opened it, and read the second writer's
conversation.

It was then found, by inspection, in **every** store implementing the ownership
contract — the in-memory one, the file-backed one, and both service-backed
ones. All four were tested. None of the tests could see it, because **every store
was tested against its own doubles**, so a flaw in the PORT's semantics was
invisible to all of them at once.

That is the gap this battery closes. It is written once, against the port, and
run against every store. It would have failed four adapters on the same day.

## Using it

```ts
import { runSessionLifecycleConformance, formatConformanceReport } from 'agentfootprint/hosting';

const report = await runSessionLifecycleConformance({
  name: 'ourOwnSessions',
  createStore: () => ourOwnSessions({ pool }),
  disposeStore: (store) => store.close(),
});

if (!report.ok) throw new Error(formatConformanceReport(report));
```

One assertion per case, in whatever framework you use — the shape you want in a
suite, because a battery that fails as one blob tells you a store is broken and
not which promise it broke:

```ts
import { sessionLifecycleConformance, runSessionLifecycleCase } from 'agentfootprint/hosting';

for (const testCase of sessionLifecycleConformance) {
  it(testCase.name, async () => {
    const outcome = await runSessionLifecycleCase(testCase, harness);
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
somebody else's fixtures), and a store that has been closed cannot be reset in
place. One store per case, disposed after it, is the only shape that holds for a
`Map`, a file, a distributed transaction and a managed service at once.

| field                 | for                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                | what the store is called in a report                                                                                                                   |
| `createStore()`       | a fresh, empty store. Sync or async — stores differ                                                                                                    |
| `disposeStore(store)` | release it. Called even when the case failed                                                                                                           |
| `corrupt(store, id)`  | replace one session's stored bytes with something unreadable, behind the store's back. There is no portable way to do this, so it is the harness's job |
| `declared`            | cases this store cannot satisfy, **by name**, each with the reason                                                                                     |

## Not-applicable, declared, failed

Three ways a case does not simply pass, and they mean different things:

- **`'not-applicable'`** — the case is about an OPTIONAL port member
  (`listByUser`, `ownerOf`) or a common extra (`forget`) this store does not
  implement. That is feature detection, which is the port's own rule; a
  key/value store owes nobody a secondary index.
- **`'declared'`** — the store implements the member and still cannot satisfy
  the case, for a stated reason. A managed service whose owner field is
  immutable at creation genuinely cannot fill one in on turn two. **The case is
  run anyway**: if it passes, the report marks the declaration `STALE`, because
  a suppression nobody revisits is how a fixed defect keeps its exemption and a
  real one inherits it later.
- **`'failed'`** — including _"this case needed a harness hook nobody supplied
  and nobody declared"_. An undeclared skip is a pass with the evidence removed,
  which is the same shape as every defect above.

There is deliberately no way to make a case quietly disappear.

## The cases

| case                                            | the law                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `absent-session-hydrates-undefined`             | only a session that was never written hydrates as `undefined`                      |
| `persist-hydrate-round-trip`                    | what went in comes back; the last write wins for the payload                       |
| `unreadable-is-not-absent`                      | present-and-unreadable is refused by name, never answered as absent                |
| `forget-removes-the-conversation`               | deletion deletes, index included, and is idempotent                                |
| `ownership-is-derived-from-the-envelope`        | the owner comes from the stored conversation, never from a caller                  |
| `ownership-fills-in-on-a-later-signed-turn`     | the first turn that SIGNS owns it                                                  |
| `ownership-survives-a-leaner-turn`              | a turn claiming nobody is stored and erases nobody                                 |
| `ownership-is-not-taken-by-a-different-signer`  | a foreign signer is refused WHOLE — index and conversation both                    |
| `contested-write-leaves-no-split-brain`         | however two writers interleave, index and conversation never name different people |
| `owner-of-is-undefined-for-missing-and-unowned` | missing and unowned are one answer                                                 |
| `list-by-user-pages-with-a-stable-tie-break`    | every owned row once, nobody else's ever, cursor only when more exist              |
| `awkward-session-ids-round-trip`                | an id is opaque, and the mapping to a backend key is injective                     |
| `optional-members-are-feature-detected`         | present as functions or absent; `ownerOf` ships beside `listByUser`                |

## Files

- `types.ts` — the harness, the case, the outcome. The case-name union is
  closed on purpose: a declaration naming a case that was renamed would go on
  suppressing nothing.
- `cases.ts` — the battery. One law each, stated in the case's `law` field so a
  failure reads as a broken promise.
- `run.ts` — the three not-run decisions, the report, the formatter.
