**Mixed** — the LLM ledger: one numbered, append-only log per session of what an agent read,
what it noted and how each claim checked against those reads.
Trace: the log and its stores (`store.ts`, `memoryStore.ts`, `fileStore.ts`). Fold: the report
(`report.ts`, `rules/`). Lens: what the agent and a person are served (`serve.ts`, `mcp.ts`).

It is not `src/context-ledger/`, which counts which context pieces earned their tokens across runs,
and it is not `src/integrity/`, the run's own context checks, which will register here later as rules.
Its receipt is one read. It is not `core/agent/receipt/`, which records what the model was handed.
It imports `footprintjs` and `foottrace` only, so moving it to its own package is a file move.

# `llm-ledger/` — the log a session's claims are checked against

**Status.** This folder holds the log (the entries, their caps, the token reader, the window
validator, the session id, the store port and its two adapters) and the calls (the rules, the
report, the one serving funnel, the chart per call, the queue and the facade `createLedger`). The
MCP server, the command line and the published door come in a later pull request. Nothing outside
this folder imports it yet, and no `package.json` door reaches it.

## Files

| File | Owns |
|---|---|
| `types.ts` | the nine entry shapes and every closed word (`LedgerBy`, `LedgerHow`, `LedgerKind`, the dispositions, verdicts and refusals). Declarations only |
| `limits.ts` | `LEDGER_LIMITS`, the one frozen table of the ledger's caps (sizes, counts, the key's length, the lock's waits); no other file restates one. Grammars (a rule name's length) and the canonical-JSON bounds of a line (`store.ts`) are not caps and live with their owners |
| `entries.ts` | `entryFault`, the one check of an entry's shape (context-free: every reference is to an EARLIER seq); `isIncomplete`, the one answer to "was this receipt cut, holding numbers with thousands separators or pieces that read two ways, masked or limited?"; `citeProblem`, the cite check a note is admitted with |
| `build.ts` | the record-time builders, one per kind text enters through (`receiptEntry`, `suppliedEntry`, `noteEntry`, `withdrawalEntry`, `submitEntry`, `deliveredEntry`, `openedEntry`). Each drops the text it was handed once it has the tokens or the digest it keeps, and refuses with `bad-input`, `too-large` or `bad-window` |
| `tokens.ts` | which tokens of a text are values (rules 1–3 of the evidence extractor's header, as a closed copy; a token is a literal piece of the text, below), the receipt's capped reading (`readTokens`, and `readTokensUpTo` under another cap) and `utf8Bytes` |
| `window.ts` | the ledger's one instant validator (`instantMs`) and the window on it (`readWindow`) |
| `digest.ts` | the folder's one door to Web Crypto: `digestOf` (`sha256:<hex>`) and `randomBytes` |
| `session.ts` | the session id (`ls_` + 26 Crockford base32 characters, 128 random bits): `isSessionId`, `sessionIdOf`, `mintSessionId` |
| `store.ts` | the `LedgerStore` port, `LedgerStoreError` and its closed codes, the admission both adapters share (`admitBatch`, `lineBytesOf`, `lineOverheadBytes`), and `withHighWater` (bounded, least recently used out) |
| `memoryStore.ts` | `memoryLedgerStore()`: a `Map` of admitted, deep-frozen entries, under the file store's caps |
| `fileStore.ts` | `fileLedgerStore({ dir, key, uid })`: one MAC-chained JSON-lines file per session, every line marked with its batch's end. The only file here that imports Node |
| `rules/` | the checks port and the three built-in rules (`rules/README.md`) |
| `reader.ts` | `readerOf`: one loaded log, indexed by seq and kind; held in a stage's closure, never in a run's scope |
| `report.ts` | `foldReport`: the last submit's checks as AgentFootprint's standing (`ask`, `not-sure`, `consistent`, `not-assessed`) and its reasons. It never trusts that the value law ran: a subject with no value-law record reads at most `open`, and a submit with no value-law record for its draft reads `not-assessed` at best |
| `serve.ts` | the one funnel everything served passes through (`serveReport`, `serveReceipts`, `serveRefusal`); receipt tokens, queries and supplied content are never read by it |
| `stages.ts` | the stage functions of a call's chart, over one `CallFrame` (the call's closure) |
| `calls.ts` | `runCall`: the chart of one call, one fresh `FlowChartExecutor`, input `{ call }`, and the one pause |
| `queue.ts` | `sessionQueue`: one FIFO per session in one process; `busy` past 8 waiting |
| `ledger.ts` | `createLedger({ store, rules?, redaction?, confirm?, clock?, runs? })` → `{ host, agentFor(session) }` |

## The store port

```ts
interface LedgerStore {
  load(session: string): Promise<{ readonly seq: number; readonly entries: readonly LedgerEntry[] }>;
  append(session: string, expectedSeq: number, entries: readonly LedgerEntry[]): Promise<number | 'conflict'>;
}
```

- `seq` is the number of entries; every kind shares one sequence 1…n. An unknown session loads as
  `{ seq: 0, entries: [] }`. A session starts with `append(s, 0, [opened])`: seq 1 is the session's
  `opened`, and no other entry is.
- `append` takes entries numbered `expectedSeq + 1 …` and returns the new last seq, or `'conflict'`
  — writing nothing — when the stored seq is not `expectedSeq`.
- Every integrity failure is THROWN as a `LedgerStoreError` with one closed code: `mac-mismatch`,
  `torn-line`, `malformed`, `unsafe-file`, `too-large`, `locked-timeout`, `lock-lost` (the file
  store's append wrote its batch but lost its lock before it finished: the batch may or may not
  stand, so the caller reloads), and `rolled-back` (thrown only by `withHighWater`). The later
  stages turn it into the refusal `store-refused`. A store that cannot vouch for its bytes has no
  seq to give: it is refused, never repaired.
- A malformed batch is refused before the seq is compared — by `withHighWater` too — and caps are
  checked after it. One contract suite (`store.contract.test.ts`) runs every case on both adapters.

## The file format

`<dir>/<session>.jsonl`, one canonical-JSON line per entry, keys exactly `end`, `entry`, `mac`:

```
{"end":<the last seq of the batch this line was appended in>,"entry":{…},"mac":"<64 lower-case hex>"}
```

The MAC is HMAC-SHA-256 under the host's key over

```
canonicalizeJson({ session, seq, prev, end, entry })
```

(`foottrace/canonical-json`), where `seq` is the line's position, `prev` is the previous line's MAC
and `''` for seq 1, and `end` is the line's own `end`. Putting `session` in the input refuses a line
or a whole file copied from another session; `prev` refuses a removed or reordered line; `end`
refuses an unfinished batch. Three canonical forms nest — an entry as admitted, its line, the MAC
input — and each one's bounds (bytes, nodes, fields, depth, sort work) sit a little inside the next
one's, so an entry admitted at an edge still makes a line that reads back, and a forged line at an
edge is refused, never a raw error.

A wrong MAC on ANY line refuses the whole session (`mac-mismatch`); nothing is loaded in part. A
batch starts where the last one ended and every one of its lines names the same `end`; a line whose
MAC verifies but whose `end` breaks that is `malformed` (an `end` that is not a whole number of at
least 1 is not a line of this store at all, and is refused as `mac-mismatch` before the MAC is
computed). A file that does not end with a newline,
whose last line is not JSON, that is empty, or whose last batch is unfinished (it ends before the
seq its last lines name) is `torn-line`: the adapter never truncates it and has no repair command,
so the host inspects the file and opens a new session. So a loaded log is always whole batches, and
`append` refuses to write after an unfinished one: a half batch can never become permanent.

Across processes, `append` takes `<session>.lock` with `wx`, reads the last line, compares seqs,
writes the batch with one append, calls `fsync` and removes the lock. It waits at most 2 s
(`locked-timeout`); a lock older than 30 s is removed and taken again through the same `wx`. A
`load` takes no lock; when it meets a torn tail or an unfinished batch it waits while a writer holds
the lock and reads once more, so an append still being written is never refused as torn.

**Two writers and one lock — what is closed, and the gap that remains.** The stale rule reads the
wall clock, so a writer that is still running can look dead (the machine slept in the middle of an
append, the process was stopped, the clock stepped forward, an fsync was slow), and two waiters on
one dead writer's lock can both take it. So the lock carries a random token, written when it is
taken: a lock is this append's own only while its device, inode AND token match (a file system may
hand a freed inode number straight to the next file, so the inode alone cannot tell a lock from the
one that replaced it). An append checks this right before its write: if the lock is not its own, it
writes nothing and answers `locked-timeout`. After its fsync it checks again: if the lock was lost
by then, it answers `lock-lost`, never a seq. Its release removes the lock only while it is still
its own, and the stale takeover re-checks the lock it is about to remove, token included. If the
token cannot be written (a full disk), the append removes the lock it just made before it fails, so
the next append does not wait for an empty lock to look stale.

**What remains, and what it costs:** a takeover that lands between that last check and the write
system call lets two batches reach one seq. That loses the SESSION: the next `load` refuses it
(`mac-mismatch`) — refused, never forged — and the one writer that was told a seq was told one that
does not read back. Closing this gap needs a lock the kernel holds, which this release does not
take.

**`lock-lost` is not `conflict` — a rule for the next part's `append` stage.** On `conflict`,
nothing was written: reload, re-check, re-stamp at the new seq and try again. On `lock-lost`, the
batch was written and may stand: reload, and compare the canonical form of this call's own entries
with the log at `expectedSeq + 1 … end`. If they are there, the append stood; if not, it did not.
Never re-stamp and append the same entries on `lock-lost`: if the batch stood, that appends it
twice.

The directory is created 0700 and refused when it is a link, another user's, or writable by group
or others. Files are opened with `O_NOFOLLOW` and created 0600, checked with `fstat` on the open
descriptor, and refused when they are a symbolic link or a hard link, another user's, or carry any
group or other permission bit — the rule `footprintjs/sinks` follows for its record file. The
adapter runs on POSIX only and refuses at construction elsewhere. The folder never reads `process`,
so the host passes its own `uid`.

## The calls

`createLedger` returns `{ host, agentFor(session) }`. The host calls `open`, `record`, `supply`,
`deliver` and `report`; the agent's calls `note`, `withdraw`, `ask` and `submit` are bound to one
session and take no session argument. Every reply is `{ ok: true, … }` or
`{ ok: false, refused: <word> }`, with `store` beside `store-refused`. A session opened without
`rules` runs the three built-ins. Every session runs `traceable-values@2` for new checks and preserves earlier `@1` records. It runs on every
claim and on the draft, whatever it pins: `open` adds it to `opened.rules` and its reply lists the rules.

Each call is ONE short FootprintJS run: a fresh `FlowChartExecutor`, a chart built for the call, and
the input `{ call }` and nothing else. Stage closures hold the call's input and the attempt's reader
(`reader.ts`); scope holds only names, numbers, verdict words and decision records, so no result
text, draft text, note text or key reaches a run record. The frame: `read-call` (the input against its
caps, built once with the log's builders) → `load-log` (this attempt's one `store.load`) → the decider
`admit` (one `decide()` over flat facts; the first refusal wins) → the call's own stages → `append`
(one batch) → the decider `after-append`: `appended`; `conflict` loops to `load-log`, at most 3
attempts, then `busy`; a store refusal is terminal. A `submit` appends its `submit` entry and all its
`check` entries as one batch, so a conflict reruns its checks on the new log.

**`lock-lost` is not `conflict`.** On `lock-lost`, `append` reloads once and compares the call's own
entries at `expectedSeq + 1 … end`. If they stand, the call is appended; if not, it is refused with
`store-refused` and `store: 'lock-lost'`. It never re-stamps and appends the same entries again.

**`ask`** runs no rule and appends nothing: it reports the last submit's checks, with the 64 newest
receipts (number, source, how, at, window, nothingFound, incomplete, externalId). In a session opened
with `askRunsRules: true` it is a dry run of the rules over every live claim (`preview: true`), still
appending nothing.

**The only pause** is `await-person`, for a session opened with `confirm: true`. Its payload is
`{ submit, standing, counts }`, with no values. The host's `confirm` port answers and the run resumes
in this process; the checkpoint is never stored or sent. The resumed leg appends `released`. Without a
port, or when the port fails, the answer is `withhold` with `why: 'no-person-channel'`. If the process
dies while waiting, no `released` entry exists, and the report reads `ask`. The answer is never lost and
never reported as written when it is not: a store error while appending `released` replies
`store-refused` with its code, three conflicts reply `busy`, and in both the report still reads waiting
for a person. Both refusals carry `submit`, the submit's seq: its batch stands, so the caller asks the
person again and never submits again. No path replies `ok` unless the entry is in the log.

**Served.** `serve.ts` builds every reply that carries a log's content. With a host `redaction` policy,
every string is served as `{ masked: '[REDACTED]', span }` unless it is a ledger word, a rule id, a
digest, an instant or a host name; the policy also goes to every executor. Without one, the agent's own
note text and the missing tokens are quoted.

## Trust: what the log is, and what it cannot see

- **The log is the trusted side, kept on the host, unredacted.** The checks run on its real values.
  The MAC protects INTEGRITY, not secrecy: there is no encryption at rest, so the host keeps the
  store and the key where the agent cannot read or write them.
- **The key** is a `Uint8Array` of at least 32 bytes the host hands in. The adapter never makes or
  stores it: it copies it once, and never logs or returns it. This release has no rotation: a new
  key means new sessions.
- **Restoring an earlier copy cannot be detected across processes.** `withHighWater` refuses, per
  ledger instance, a load below the highest seq that instance has seen (`rolled-back`). A saved
  earlier copy of the store restored between processes verifies: detecting it needs a trusted
  counter, which this release does not have. The same holds for a file cut at a batch boundary, and
  for a deleted session file, which reads as an unknown session (seq 0). The mark remembers at most
  10,000 sessions (`maxHighWaterSessions`), least recently used out: a forgotten session is as
  unguarded in that instance as in a fresh one.
- **Whoever can write the store's parent directory** can delete, hide or swap the store directory
  between the check and an open — denying service — but cannot make the store read or write a file
  it would refuse: every file is opened without following links and checked on its descriptor.
- **What is never stored:** the text of a read or of a supplied value (only its tokens, its byte
  count and, for a supplied value, its digest); the draft and the delivered text (digests only); the
  key or its path; environment values. A note's text and values, and a withdrawal's reason, are the
  agent's own words and are stored as written: a secret pasted into a note is kept, because no name
  reaches it.
- **What a host with the key can do:** anything. An agent that runs commands as the host's user and
  can read the key file can forge receipts; the ledger cannot detect this.
- **What a load costs.** `load` verifies every line: a full session of 2,048-token receipts (about
  1,100 lines, 32 MiB) took about 4 s on a loaded machine. Reading that log once per call is the
  next part's reader to plan for; this part states it.

## Tokens and windows

A receipt keeps a capped token set and a pointer, never the result text. `readTokens` reads at most
1 MiB of the host's text. Past it, each character is counted once — its UTF-8 bytes, for `bytes`
and `cut.bytesUnread` — and never copied, split or looked at to decide anything: a 64 MiB text
costs one counting pass and the 1 MiB it reads. The last piece before the cap is kept only when a
separator follows it within the bytes read, and a backslash right at the cap (its meaning is the
character after it) is left unread with the piece before it. It keeps the first 2,048 distinct
tokens in first-seen order and counts the rest — and any token longer than 64 characters — in
`cut.tokensDropped`. Nothing read is dropped uncounted. A receipt is incomplete when it is cut, when
it holds numbers written with thousands separators (`groupedNumbers`) or pieces next to a backslash
that read two ways (`escapedPieces`), when `hidden > 0` or when `limit.hit` (`isIncomplete`, the one
predicate every rule asks).

The token rule is a closed copy of rules 1–3 of the evidence extractor's header: a token contains a
digit and is an identifier of at least 4 characters or a number of at least 4 digits; a number with
a unit glued on is judged by its number. A token is always a literal piece of the text: a run of
`A–Z a–z 0–9 : _ - / . % + @ # $` between separators. Every other character separates — a
backslash too — and so does every comma. A leading `$ # @ + :` and a trailing `. : %` are
decoration, so `{"total":1200}` gives `1200`. Nothing is folded, joined, decoded or respelled but
for lower case, so every token is a whole piece of the lower-cased text — for prose, CSV, JSON,
JSON Lines, a path and any part of one alike. No text is recognised as JSON first: one rule reads
them all. `1200,9750` gives `1200` and `9750`, and `host-a,1200,9750,ok` gives both values.

A run of digits and commas that matches `\d{1,3}(,\d{3})+` and is not glued to a letter before it
(`41,200`, `$1,234.50`, `1,234ms`, `{"ids":[1,234]}`, `[100,200,300`) may be one number or a list
of values, and no reading of its pieces can tell which. It is counted in `groupedNumbers`, and its
groups — the pieces after its first comma — are never read (`1,234.5` gives no `234.5`; the piece
before the first comma is read as written, so `10:00:00,123` gives `10:00:00`). A receipt that
counted one is incomplete, so a claim value missing from it is `open` ("a value may be in a part of
a receipt this rule cannot read"), never `unsupported`. The same reader reads a claim or a draft:
there, such a number is no visible token either. Two differences from the extractor, on purpose:
numbers are not respelled (`98304.0` stays `98304.0`), and nothing is folded — the extractor reads
`5,100` as `5100` and one JSON value through its literals. The differential test against it,
planned for the plugin adapter, lists both as known differences.

A backslash raises the same question. After it, a piece that opens with `b f n r t u` or `/` is a
JSON escape's letter and what follows, or a path's next name: `D:\logs\node1234.log` holds
`node1234.log`, or a newline and `ode1234.log`. The reader never decodes, and keeps neither: it
counts such a piece in `escapedPieces` when it holds a digit (a piece without one is no value either
way), so a receipt that counted one is incomplete. So is the piece right before `\/`, which JSON
joins to the next one with `/`. An escape's own characters (`n`, `u00e9`) neither start nor glue a
grouped run. Backslashes pair from the left: `\\` and `\"` are an escaped backslash and an
escaped quote, plain separators with nothing ambiguous after them, and a piece after any other
character is read as written (`\logs`, `C:\\new1234`). JSON with many escapes before values is
therefore often incomplete: a claim value missing from it is `open`, never `unsupported`.

What the rule cannot see: all-letter names; numbers under 4 digits; respellings (`1.2 s` against
`1200ms`); numbers written with thousands separators; and a piece right after a backslash that may
open an escape (`\node1234.log`, `\t5678`), or right before `\/`.

A window is `{ from, to }`, half-open, `from < to`, both RFC 3339 instants with an upper-case `T`,
`Z` or `±hh:mm`, seconds required, 0–3 fraction digits and no leap second (`window.ts`). It is a
validator, not a second grammar: `test/llm-ledger/window-differential.test.ts` pins that every
string it accepts, `time/instant.ts` · `instantOf` accepts in its strict profile, with the same
epoch milliseconds.

## The fence

The folder is a closed leaf (`scripts/layering.config.cjs`: L0 and `CLOSED_FOLDERS`): no relative
import leaves it, not even by type. `test/architecture/llm-ledger-fence.test.ts` sees every import
form and holds each file's bare-specifier allowance: every file may import `footprintjs` and
`foottrace/canonical-json`; `fileStore.ts` also `node:fs`, `node:fs/promises`, `node:path` and
`node:crypto`. Web Crypto appears only in `digest.ts`, as `globalThis.crypto` and no other
`globalThis.` access; `process`, `require`, `import()`, `import.meta`, `eval`, the `Function`
constructor, the network (`fetch`, `WebSocket`, `XMLHttpRequest`) and decorators appear nowhere,
nor does a `.constructor` or `['constructor']` read (the Function constructor's two common reaches
without its name) or a triple-slash `/// <reference …>` directive (a type-level edge out); no file
runs code at module evaluation. A fence over source text cannot stop every call built at run time:
a property name put together from pieces, `Reflect.get(…, 'construc' + 'tor')`, a destructured
`{ constructor } = []`, a function a host hands in; review is the boundary for those. What it stops: every import
form, the Node and network globals and `eval` by name, the Function constructor by name and by those
two reaches, `import.meta`, decorators, code at module evaluation, and Web Crypto outside its file. Tests beside the code import only the folder,
`vitest`, `footprintjs`, `foottrace` and `node:` builtins; tests that need repository helpers live
in `test/llm-ledger/`.
