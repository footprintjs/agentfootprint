---
type: changed
---
**`agentfootprint-check-semantics` reads each catalog row's `search`, and refuses one `defineTool` would refuse.** The command line dropped a row's `search`, so a tool declaring a search and returning `absent({ checked: 'declared' })` failed the gate (exit 1, `declared-without-search`) while `checkSemantics` passed the same row; it now gives the same verdict (exit 0). A `search` that `defineTool` would refuse (`{}`, a string, `complete: 'bogus'` …) now makes `checkSemantics` throw, naming the tool and the field (the command line exits 2), where before it passed the gate or crashed with a `TypeError`. The checks that need the tool's `inputSchema` are not made there; a catalog row carries none.

Migration: dump each row's `search` from the defined tool (`tool.search`), which `defineTool` already accepted.
