**Support** — The existing UTF-16 string-prefix projection.

## The one law here

Keep the original cut boundary: a high surrogate immediately before the boundary shortens the prefix by one code unit.

## Files

- `cutAt.ts` — The existing UTF-16 string-prefix projection.
