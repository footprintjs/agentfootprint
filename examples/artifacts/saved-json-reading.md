# Read a placed JSON result a page at a time

Run with the scripted mock; no provider key or external source is used:

```sh
npm run example examples/artifacts/saved-json-reading.ts
```

The producer returns 25 synthetic samples. Placement saves the exact result text,
and the agent follows the ticket's `detail` action. It reads 20 child actions,
then the remaining five, then opens sample 20. The example checks that the saved
text is unchanged and the producer ran only once:

```text
sample-20: 30 ms. LOCAL SEED; reading the sample does not establish a cause.
Source reads: 1. Fresh viewer admissions: 3. Synthetic data only.
```

`artifacts.reading` mounts the existing `artifactDetailTool` with a session-bound
admission. Each request uses fresh scoped `head`/`get` reads, an exact kind
allowlist and a byte ceiling. The optional `check` sees a frozen record and must
return exactly `true`; it can narrow access but cannot replace the admitted data.
The automatic read boundary decodes declared JSON text once without changing its
stored representation.

The example supplies a fixed local session. A deployed host must authenticate
the caller and bind that session using its existing ownership policy. The helper
does not certify a producer, current-run origin, source truth or a causal claim.
Omitting `reading` keeps the existing catalog and placement tickets unchanged.

Paging bounds what the model receives. Each request still loads an admitted
snapshot up to the configured ceiling, at most 1 MiB; this is not random access
over an arbitrarily large source. The ceiling bounds what admission accepts and
copies; file/SQLite metadata paths may load a payload before that check, so it
does not bound adapter I/O or total process memory. See [artifact-detail](artifact-detail.md) for a
custom domain admission callback and provenance context.
