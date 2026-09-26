---
type: security
---
**An Error inside an event, a recording or a tool result no longer writes its custom properties, its `toJSON` output or its stack (such as an axios error's `Authorization` header) to any sink, stream or stored recording. A read at the artifact door no longer evicts anyone's instance.**

- **One wire rule for Errors.** A tool that returned or passed along an error from a client library could put that error in an event payload, a recording and the tool-result text. `JSON.stringify` wrote the error's own enumerable properties, or, for a real `AxiosError`, what its `toJSON` returns: its request config (headers included) and its stack. For an axios error that includes the `Authorization` header. It was written to the NDJSON file, the audit export, CloudWatch / AgentCore, X-Ray metadata, OpenTelemetry attribute text, the console default, the browser stream (`toSSE`), the recording artifact and file sink, the bug-report bundle, and the tool-result message the model reads and `history` keeps. Every Error is now written as `{ name, message, code? }` plus a bounded `cause` chain, and nothing else.
  - The rule reads the raw value, so `toJSON` never pre-empts it.
  - It checks for an Error with `Error.isError` or `instanceof`, so a spoofed `Symbol.toStringTag` does not fool it.
  - The detached path renders the same way before it copies an event, including Errors inside a Map or Set, so both delivery paths write the same bytes.
  - A value that holds no Error serializes exactly as before.
  - A test refuses any new direct `JSON.stringify` in these modules.
  - Measured cost on a 553 KB event: 2× the time of a plain `JSON.stringify` on the sync path (0.92 ms vs 0.46 ms), and 1.6× the time of a plain copy on the detached path (`bench/wire-json.mjs`).
- **Redemptions never build or evict a pooled instance.** At a door with no verifier, anybody naming made-up session ids in `artifact-head` / `artifact-get` / `answer-account` (or `handle.artifactsForRequest`) built one pooled instance per id. Each one evicted the least recently used idle session and closed its tool sessions as `'evicted'`. The door now answers from the session's live instance. A session with no live instance and no stored conversation gets the usual not-found. A session whose instance was evicted is answered by one reader instance held outside the pool, which never counts toward `maxActiveSessions`.
