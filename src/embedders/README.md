**Support** — five interchangeable `Embedder` adapters behind one shape, each
lazily importing its optional peer dependency.

## What it reads / what it writes

Text in, vectors out, with no scope or events. The private response-shape
helper supplies the existing adapter errors with a response kind, array length
or object key names, never a response value.

## The one law here

An embedding is a numeric substrate, never a verdict. Every claim built on one
is stated as a proxy by the fold that builds it (`src/influence-core/`).

## Files

- `index.ts` — the built-in embedders and their lazy peer loading.
- `describeShape.ts` — the existing response-shape description for adapter errors.
