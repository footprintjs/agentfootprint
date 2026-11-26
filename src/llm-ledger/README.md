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
| `tokens.ts` | which tokens of a text are values (rules 1–3 of the evidence extractor's header, as a closed copy), the receipt's capped reading (`readTokens`) and `utf8Bytes` |
| `window.ts` | the ledger's one instant validator (`instantMs`) and the window on it (`readWindow`) |
| `digest.ts` | the folder's one door to Web Crypto: `digestOf` (`sha256:<hex>`) and `randomBytes` |
| `session.ts` | the session id (`ls_` + 26 Crockford base32 characters, 128 random bits): `isSessionId`, `sessionIdOf`, `mintSessionId` |
| `store.ts` | the `LedgerStore` port, `LedgerStoreError` and its closed codes, the admission both adapters share (`admitBatch`, `lineBytesOf`), and `withHighWater` |
| `memoryStore.ts` | `memoryLedgerStore()`: a `Map` of admitted, deep-frozen entries, under the file store's caps |
| `fileStore.ts` | `fileLedgerStore({ dir, key, uid })`: one MAC-chained JSON-lines file per session. The only file here that imports Node |

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
  `torn-line`, `malformed`, `unsafe-file`, `too-large`, `locked-timeout`, and `rolled-back` (thrown
  only by `withHighWater`). The later stages turn it into the refusal `store-refused`. A store that
  cannot vouch for its bytes has no seq to give: it is refused, never repaired.
- A malformed batch is refused before the seq is compared; caps are checked after it. One contract
  suite (`store.contract.test.ts`) runs every case on both adapters.

## The file format

`<dir>/<session>.jsonl`, one canonical-JSON line per entry:

```
{"entry":{…},"mac":"<64 hex>"}
```

The MAC is HMAC-SHA-256 under the host's key over `canonicalizeJson({ session, seq, prev, entry })`
(`foottrace/canonical-json`), where `prev` is the previous line's MAC and `''` for seq 1. Putting
`session` in the input refuses a line or a whole file copied from another session; `prev` refuses a
removed or reordered line. Three canonical forms nest — an entry as admitted, its line, the MAC
input — and each one's bounds (bytes, nodes, fields, depth, sort work) sit a little inside the
next one's, so an entry admitted at an edge still makes a line that reads back, and a forged line
at an edge is refused, never a raw error. A wrong MAC on ANY line refuses the whole session (`mac-mismatch`);
nothing is loaded in part. A file that does not end with a newline, or whose last line is not JSON,
is `torn-line`: the adapter never truncates it and has no repair command, so the host inspects the
file and opens a new session.

Across processes, `append` takes `<session>.lock` with `wx`, reads the last line, compares seqs,
writes the batch with one append, calls `fsync` and removes the lock. It waits at most 2 s
(`locked-timeout`); a lock older than 30 s is removed and taken again through the same `wx`. A
`load` takes no lock; when it meets a tail without its newline it waits while a writer holds the
lock and reads once more, so a half-written append is never refused as torn.

The directory is created 0700 and refused when it is a link, another user's, or writable by group
or others. Files are opened with `O_NOFOLLOW` and created 0600, and refused when they are a
symbolic link or a hard link, another user's, or carry any group or other permission bit — the rule
`footprintjs/sinks` follows for its record file. The adapter runs on POSIX only and refuses at
construction elsewhere. The folder never reads `process`, so the host passes its own `uid`.

## Trust: what the log is, and what it cannot see

- **The log is the trusted side, kept on the host, unredacted.** The checks run on its real values.
  The MAC protects INTEGRITY, not secrecy: there is no encryption at rest, so the host keeps the
  store and the key where the agent cannot read or write them.
- **The key** is a `Uint8Array` of at least 32 bytes the host hands in. The adapter copies it once
  and never makes, reads, stores, logs or returns it. This release has no rotation: a new key means
  new sessions.
- **Restoring an earlier copy cannot be detected across processes.** `withHighWater` refuses, per
  ledger instance, a load below the highest seq that instance has seen (`rolled-back`). A saved
  earlier copy of the store restored between processes verifies: detecting it needs a trusted
  counter, which this release does not have. The same holds for a file cut at a line boundary.
- **A batch is one write, not one transaction.** A crash in the middle of an append leaves a torn
  tail, which is refused. A crash that lands exactly on a line boundary leaves the first lines of
  the batch, which verify. A reader that needs a whole batch (a submit and all its checks) must
  check that it is whole, not assume it.
- **What is never stored:** the text of a read or of a supplied value (only its tokens, its byte
  count and, for a supplied value, its digest); the draft and the delivered text (digests only); the
  key or its path; environment values. A note's text and values are the agent's own words and are
  stored as written: a secret pasted into a note is kept, because no name reaches it.
- **What a host with the key can do:** anything. An agent that runs commands as the host's user and
  can read the key file can forge receipts; the ledger cannot detect this.

## Tokens and windows

A receipt keeps a capped token set and a pointer, never the result text. `readTokens` reads at most
1 MiB of the host's text: past it, the bytes are counted in `cut.bytesUnread` and never read, and
the token the byte cap falls inside is left unread too (never kept as a piece). It keeps the first
2,048 distinct tokens in first-seen order and counts the rest — and any token longer than 64
characters — in `cut.tokensDropped`. A receipt is incomplete when it is cut, when `hidden > 0` or
when `limit.hit` (`isIncomplete`, the one predicate every rule asks).

The token rule is a closed copy of rules 1–3 of the evidence extractor's header: a token contains a
digit and is an identifier of at least 4 characters or a number of at least 4 digits (thousands
separators folded); a number with a unit glued on is judged by its number. Unlike that extractor it
does not re-spell numbers (`98304.0` stays `98304.0`); a differential test against it is added when
the plugin adapter starts.

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
`node:crypto`. Web Crypto appears only in `digest.ts`; `process`, `require` and `import()` appear
nowhere; no file runs code at module evaluation. Tests beside the code import only the folder,
`vitest`, `footprintjs`, `foottrace` and `node:` builtins; tests that need repository helpers live
in `test/llm-ledger/`.
