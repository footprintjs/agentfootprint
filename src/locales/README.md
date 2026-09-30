**Support** — message catalogs: the key → sentence bundles the human-facing
commentary and thinking surfaces render.

## What it reads / what it writes
- Reads nothing at runtime; a catalog is data.
- Writes nothing. A composer picks a key; voice and locale are one merged map
  away.

## The one law here
A catalog holds sentences a HUMAN reads. Model-facing text is composed at the
seam where its facts are known, never looked up by key here.

## Files
- `index.ts` — the catalogs and the merge.
- `timeAsk.ts` — the time ask's sentences (`defaultTimeAskMessages`): a refused
  time answer's reason, the ask's questions, the label on a reading to confirm.
  A PERSON reads them on a re-ask; an app overrides keys through
  `.time({ messages })`.
