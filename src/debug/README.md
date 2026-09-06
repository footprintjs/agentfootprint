**Support** — a re-export-only barrel that gives the context-error finders a
shorter public name. It holds no code of its own.

## What it reads / what it writes
Nothing. One `export *`.

## The one law here
A barrel may rename; it may not imply a move that did not happen. The finders
still live at `src/observability/contextError/finders/`, and the header in
`finders.ts` calling this a "collapsed home" describes an intention, not the
tree.

## Files
- `finders.ts` — one `export *` over the finders folder.
