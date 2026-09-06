**Support** — one adapter per format, each doing one job: turn bytes into text
plus the positions that text came from.

## What it reads / what it writes
- Reads a file's bytes.
- Writes a document plus offsets. No scope, no events.

## The one law here
Positions are not optional. A chunk must be able to say which document and which
characters it came from, which is only possible if the loader kept them.

## Files
- `text.ts`, `markdown.ts`, `html.ts`, `pdf.ts` — one format each.
- `mock.ts` — no filesystem, for tests.
- `index.ts`.
