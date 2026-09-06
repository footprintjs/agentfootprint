**Support** — where a document gets cut, and why there.

## What it reads / what it writes
- Reads a loaded document and its offsets.
- Writes chunks that still carry their source coordinates.

## The one law here
A cut may not lose provenance. Defaults live in one file (`constants.ts`) so
strategies cannot drift apart on the numbers.

## Files
- `byHeading.ts` — cut where the author said a section starts.
- `byParagraph.ts`, `fixedWithOverlap.ts`, `wholeDocument.ts` — the other three.
- `constants.ts`, `shared.ts`, `index.ts`.
