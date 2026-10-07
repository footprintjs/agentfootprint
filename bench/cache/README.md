# The cache bench — how much of each request can a prompt cache serve?

A prompt cache serves a prefix only where every byte repeats, up to a breakpoint an earlier
request wrote. This bench measures that share on the inputs bench's own recorded cases, at $0:
every case of `bench/inputs/cases.mjs` is played by its scripted variants through the package's
REAL Anthropic adapter, over a stub SDK client that keeps each wire body. `share.mjs` replays each
conversation's bodies through Anthropic's documented cache model (render order tools → system →
messages; a breakpoint writes the bytes up to it; a later request reads the longest such prefix
it repeats exactly, within 20 blocks of one of its own breakpoints). No library import, so one
ruler measures any release.

```text
$ npm run build && node bench/cache/run.mjs --arms off,full,assume,ask,full-b
```

Measured on the release before and after the provider-declared strategy and the moving breakpoint
(58 runs, 129 calls per row; shares are of request bytes):

| provider | arm | read share, calls 2+ — before | after | marked share — before | after |
|---|---|---:|---:|---:|---:|
| `anthropic()` | off | 75.4% | **84.5%** | 82.7% | 100% |
| `withRetry(anthropic())` | off | **0.0%** | **84.5%** | 0% | 100% |
| app wrapper (renames, forwards capabilities) | off | **0.0%** | **84.5%** | 0% | 100% |
| `anthropic()` | full (`.findings()`) | 5.4% | 0% | 97.4% | **0%** |
| `anthropic()` | full-b (inputs layer) | 85.5% | **89.9%** | 90.5% | 100% |

- **The wrappers** were the cost bug: the strategy used to be looked up by `provider.name`, and a
  renamed provider fell through to the no-op — no markers, full price on every call.
- **The moving breakpoint** adds the conversation itself, so the repeat-call share climbs with
  every turn; these scripted cases are two calls long, so this is its floor.
- **`.findings()`** writes the offer into every tool schema on every call, and tools render
  first, so nothing repeats. Before, its markers paid the cache-write premium (1.25× input) on
  97% of the bytes to read back 5%; now it places none. What would make it cacheable is moving
  the offer out of the tool schemas — a change to what the model reads, not to caching.

Not modelled: the per-model minimum (Claude Haiku 4.5 caches nothing under 4,096 tokens — these
scripted prompts are below it, so a live run of them would read nothing either way), the TTL, and
token counts.

## The one paid check

`verify-haiku.mjs` runs a real agent on `claude-haiku-4-5` behind `withRetry` — two turns, four
calls, a ~7,000-token system prompt — and prints the API's own `cache_read_input_tokens` and
`cache_creation_input_tokens` per call, then PASS when every call after the first read the cache.
Rehearse it first for $0 (`--rehearse`, a stub client); the paid run needs the owner's go and a
key loaded by `node --env-file`:

```text
$ npm run build
$ node bench/cache/verify-haiku.mjs --rehearse
$ node --env-file=<file with ANTHROPIC_API_KEY> bench/cache/verify-haiku.mjs \
    --sdk-from <a project whose node_modules has @anthropic-ai/sdk>
```

Capped in code: Haiku only, at most 6 calls, no retries, `max_tokens` 300, and it refuses to
start above $0.50 worst case (expect about $0.02).
