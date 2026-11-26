**Mixed** — the LLM ledger: one numbered, append-only log per session of what an agent read,
what it noted and how each claim checked against those reads.
Trace: the log and its stores (`store.ts`, `memoryStore.ts`, `fileStore.ts`). Fold: the report
(`report.ts`, `rules/`). Lens: what the agent and a person are served (`serve.ts`, `mcp.ts`).

It is not `src/context-ledger/`, which counts which context pieces earned their tokens across runs,
and it is not `src/integrity/`, the run's own context checks, which will register here later as rules.
Its receipt is one read. It is not `core/agent/receipt/`, which records what the model was handed.
It imports `footprintjs` and `foottrace` only, so moving it to its own package is a file move.

# `llm-ledger/` — the log a session's claims are checked against

**Status.** This folder holds the LOG only: the entries, their caps, the token reader, the window
validator, the session id, the store port and its two adapters. The rules, the report, the charts,
the facade, the MCP server, the command line and the published door come in later pull requests.
Nothing outside this folder imports it yet, and no `package.json` door reaches it.

## Files

| File | Owns |
|---|---|
| `types.ts` | the nine entry shapes and every closed word (`LedgerBy`, `LedgerHow`, `LedgerKind`, the dispositions, verdicts and refusals). Declarations only |
| `limits.ts` | `LEDGER_LIMITS`, the one frozen table of the ledger's caps (sizes, counts, the key's length, the lock's waits); no other file restates one. Grammars (a rule name's length) and the canonical-JSON bounds of a line (`store.ts`) are not caps and live with their owners |
| `entries.ts` | `entryFault`, the one check of an entry's shape (context-free: every reference is to an EARLIER seq); `isIncomplete`, the one answer to "was this receipt cut, masked or limited?"; `citeProblem`, the cite check a note is admitted with |
| `build.ts` | the record-time builders, one per kind text enters through (`receiptEntry`, `suppliedEntry`, `noteEntry`, `withdrawalEntry`, `submitEntry`, `deliveredEntry`, `openedEntry`). Each drops the text it was handed once it has the tokens or the digest it keeps, and refuses with `bad-input`, `too-large` or `bad-window` |
| `tokens.ts` | which tokens of a text are values (rules 1–3 of the evidence extractor's header, as a closed copy, with the comma rule below), the receipt's capped reading (`readTokens`, and `readTokensUpTo` under another cap) and `utf8Bytes` |
| `window.ts` | the ledger's one instant validator (`instantMs`) and the window on it (`readWindow`) |
| `digest.ts` | the folder's one door to Web Crypto: `digestOf` (`sha256:<hex>`) and `randomBytes` |
| `session.ts` | the session id (`ls_` + 26 Crockford base32 characters, 128 random bits): `isSessionId`, `sessionIdOf`, `mintSessionId` |
| `store.ts` | the `LedgerStore` port, `LedgerStoreError` and its closed codes, the admission both adapters share (`admitBatch`, `lineBytesOf`, `lineOverheadBytes`), and `withHighWater` (bounded, least recently used out) |
| `memoryStore.ts` | `memoryLedgerStore()`: a `Map` of admitted, deep-frozen entries, under the file store's caps |
| `fileStore.ts` | `fileLedgerStore({ dir, key, uid })`: one MAC-chained JSON-lines file per session, every line marked with its batch's end. The only file here that imports Node |

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
its own, and the stale takeover re-checks the lock it is about to remove, token included.

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
1 MiB of the host's text: past it, the bytes are counted in `cut.bytesUnread` and never read, and a
piece of a value the cap falls inside — or one that what follows could still change, such as the
digits of a thousands-grouped number, or a JSON string — is left unread too (never kept as a piece).
It keeps the first 2,048 distinct tokens in first-seen order and counts the rest — and any token
longer than 64 characters — in `cut.tokensDropped`. Nothing read is dropped uncounted. A receipt is
incomplete when it is cut, when `hidden > 0` or when `limit.hit` (`isIncomplete`, the one predicate
every rule asks).

The token rule is a closed copy of rules 1–3 of the evidence extractor's header: a token contains a
digit and is an identifier of at least 4 characters or a number of at least 4 digits; a number with
a unit glued on is judged by its number. Two differences from that extractor, on purpose: numbers
are not re-spelled (`98304.0` stays `98304.0`), and a comma separates values — logs and tools answer
in CSV — except inside a thousands-grouped number (a run of digits and commas matching
`\d{1,3}(,\d{3})+` exactly, not glued to a letter before it, whose commas are folded out: `41,200`
is `41200`). So `1200,9750` gives `1200` and `9750`, and `host-a,1200,9750,ok` gives both values,
where the extractor sees neither. The differential test against that extractor, planned for the
plugin adapter, lists these as known differences. One JSON object or array is read value by value
(numbers as literals). Which way a text is read is decided on the WHOLE text, by JSON's grammar in
one pass (`isJsonValue`), also when the byte cap reads only its start: a cut JSON value is then read
as JSON up to its last whole literal, and prose that merely opens with a bracket (a log line
`[2026-11-25 10:00:00] …`) is prose. So a cut reading never keeps a token the whole text does not
hold.

What the rule cannot see: all-letter names; numbers under 4 digits; respellings (`1.2 s` against
`1200ms`); and a CSV row whose values happen to look thousands-grouped (`x,1,234` reads `1234`, not
`1` and `234`).

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
runs code at module evaluation. A fence over source text cannot stop every call built at run time —
a property name put together from pieces, a function a host hands in. What it stops: every import
form, the Node and network globals and `eval` by name, the Function constructor by name and by those
two reaches, `import.meta`, decorators, code at module evaluation, and Web Crypto outside its file. Tests beside the code import only the folder,
`vitest`, `footprintjs`, `foottrace` and `node:` builtins; tests that need repository helpers live
in `test/llm-ledger/`.
