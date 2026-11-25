# `.capabilities/` — one file per capability waiting for a release

A pull request that adds a public capability adds ONE file here, holding its
row for the [capability index](../CAPABILITIES.md):

```md
| what a reader would call it, in the words THEY would search for | `symbol` | `src/path/to/it.ts` | unreleased |
```

- Name the file anything descriptive: `.capabilities/covering-look-back.md`.
- The last cell is the word `unreleased`. Never write a version number; the
  release moves the row to the top of the table in `CAPABILITIES.md`, writes
  the version, and deletes the file.
- `npm run changes:check` validates every file (CI runs it on every pull
  request), and `test/docs/capability-index.test.ts` holds a waiting row to
  the same truth as a released one: its path exists and its symbol is there.
- Looking for what already exists? Search `CAPABILITIES.md` AND this folder.
- A row that a pull request adds straight to the table in `CAPABILITIES.md` with
  `unreleased` is refused on that pull request (`npm run changes:check -- --base …`), and the
  message names this folder.
- Known limit: a release candidate packs `CAPABILITIES.md` as it stands, so its
  package does not list rows still waiting here. The release that follows does.

Why a folder: every pull request used to add its row at the same line of the
table, so any two open pull requests conflicted with each other and one had to
be refreshed after the other merged. One file per row cannot conflict. It is
the same pattern as [`.changes/`](../.changes/README.md).
