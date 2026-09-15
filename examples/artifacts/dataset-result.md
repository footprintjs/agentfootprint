# Publish a dataset, then follow its reference

[Run this example](dataset-result.ts) when a tool returns a materialized dataset
that later tools should use without sending all its rows to the model.

```sh
npm run example examples/artifacts/dataset-result.ts
```

The default provider is an offline scripted mock. It produces:

```text
Loaded 3 rows by reference.
Total 30 over 3 rows.
Source reads: 1. Synthetic data only.
```

## Configure storage on the backend

This is a chatbot-only example: no dashboard, browser or renderer is required.
The consuming application supplies the store and producer adapter explicitly.
Using the example's `provider`, `lookup`, `adapter` and `total`, its configuration
can set a per-scope retention budget:

```ts
import { Agent, inMemoryArtifacts, withDatasetArtifacts } from 'agentfootprint';

const store = inMemoryArtifacts({
  retention: { ttlMs: 3_600_000, maxBytesPerScope: 8_388_608, maxCountPerScope: 100 },
});
const agent = Agent.create({ provider, artifacts: store })
  .tool(withDatasetArtifacts(lookup, adapter))
  .tool(total)
  .build();
```

The store belongs to the host; the tool receives a capability bound to the
current run's scope. Memory storage forgets on restart. Existing alternatives
include `fileArtifacts({ directory })`, `sqliteArtifacts({ file })`,
`s3Artifacts({ bucket })` and `gcsArtifacts({ bucket })`; the host configures
their credentials and retention. Custom storage implements the same scoped
[`ArtifactStore` port](../../src/artifacts/README.md), without changing the tool
or teaching the model a filesystem path or bucket URL.

The producer still owns its result shape. Its `DatasetResultAdapter.describe`
explicitly identifies `rows` and optional source metadata. `withDatasetArtifacts`
stores them through the real tool invocation's scoped artifact capability, then
calls `project` with publication receipts. The model receives a small ticket;
the row artifact keeps the source artifact as a parent reference.

On the second turn, `sum_ledger` declares `wants: { dataset: 'dataset/rows' }`.
The model supplies the ticket, and native dispatch resolves it before execution.
The sum runs on all three stored rows, including the zero value, without calling
the producer again. A missing, expired, foreign-scope or wrong-kind reference
does not reach the consumer. The host must provide the correct conversation and
authenticated identity where applicable; a reference itself grants no access.

The wrapper works around an ordinary `Tool`, including an HTTP-backed tool or
an MCP tool explicitly decoded with `resultMode: 'structured'`. It does not infer
rowsets, validate business claims, perform remote queries or stream large inputs.
The producer supplies the schema, units, provenance and projection policy.

Each publication states whether its artifact and optional source are available.
A failed source write can leave the rows readable without a source parent; this
example reports that absence. It refuses to return a usable dataset ticket when
the row write fails. Publications are rechecked after the batch, but independent
writes are not a transaction and retention can later expire a reference.

Without an artifact store, the wrapper returns the original result and does not
call the adapter. That preserves existing behavior; it does not by itself keep
rows out of the model. Hosts that need that guarantee must configure a store and
their normal output policy.

## Optional browser resolution

A frontend is configured with the application's endpoint, not the storage
location. For an agent served through the existing hosting wire, the separate
`agentfootprint-lens` package provides:

```ts
import { httpArtifactResolver } from 'agentfootprint-lens/core';

const resolver = httpArtifactResolver({ url: '/invoke', sessionId });
```

It posts `artifact-head` and `artifact-get` requests. The host resolves the ref
under the request's identity/session scope. Configure identity verification for
shared deployments: a session identifier alone is not authentication, and the
ref alone does not authorize access. See the
[hosting wire documentation](../../docs-next/content/docs/infrastructure/hosting-and-runtime.mdx).
These operations read metadata or a complete stored payload. They are not a
paged row-query API, and this example's `wants` consumer also loads the stored
payload. A large-data UI needs its own bounded query/window adapter over its
backend. The artifact port has optional streaming operations, but this wrapper
does not stream source data or resolve remote MCP resource handles.

The mock proves the execution path and arithmetic in this fixture. It does not
measure whether a live model selects the right tool or interprets the source
correctly.
