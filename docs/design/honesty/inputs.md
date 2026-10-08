# The inputs layer — ask or assume, and where each value came from

**Design, 2026-09-26, revision 2. Adopted overnight 2026-09-27 on the owner's go; the owner may
overturn. Nothing here is built yet.**

> **Status, 2026-09-27.** Every question in § 10 and every refinement in § 10.1 (R1–R13) took its
> recommended answer; [decisions.md](decisions.md) records them, numbered once across the three
> design pages (this page's § 10 in Q2–Q19, its § 10.1 in Q20–Q32). The text below is the page as reviewed on 2026-09-26, with its file names and
> links updated for this folder. The plan builds this layer in steps 2–5 of
> [the architecture note](README.md) § 7.
>
> **Step 5 (declared sources) as built** — `src/core/agent/arguments/README.md` is the live
> account; where the build settled a detail this page left open, it says so here. The reader of
> `from` is `arguments/sources.ts` (static: the one reader of `_findings` is synchronous) and the
> checks are `arguments/checks.ts` · `checkSource` (loaded with the layer); the corpora are built
> by `honesty/sourceCorpus.ts` · `sourceCorpusOf` from raw pieces the mount hands in, and a result
> is read once per batch (`evidence/resultCarries.ts` · `resultReader`, beside `resultCarries`, over
> the index's own `readResult`). § 3.3's MUST-FIX reached one case this page did not name: a
> framework note joined AFTER the tool's JSON (a step banner, an effect note, the repeated-call
> note — Q16 kept them unannotated) made the whole message fail to parse, and the text fallback
> read `{"id":4417}` as `:4417`. `readResult` now reads the JSON a result opens with by the JSON
> grammar (`evidence/servedJson.ts`) — several MCP text blocks and a capped result's cut `head`
> too — and only what follows as text; the evidence gate reads through the same function, so
> its identical false flag is gone with it.
> A `turn` claim resolves to an earlier answer of the SAME argument of the SAME tool, or of a
> period (any tool's) in a spelling that converts — never to any answer that happens to share
> the value (the coincidence § 3.5 V4 rejects). The run constant a composed message leaves is
> `userMessageFrom` (the run input's own `messageFrom` is read-only in scope); `Sequence`,
> `Loop`, `workflow()` and `graph()` mark a message that is an earlier step's or node's output,
> and `Parallel`, `Conditional` and a nested composition pass a composed message on;
> `reflection()` is built from `LLMCall`s, so its critic cannot call a ruled tool (§ 8's
> reflection test runs on `Sequence`). The mark is the run's, not the message's (a `followUp`
> after a composed run reads that message as the person's) — named in the README, not built.
> The fold's `value-contingent` reads the ledger's `ContingentRow`s too (§ 4.7), and `checked`
> gains `argument-sources`; an UNSTAMPED row declared on the answer (an agent without the
> inputs layer) counts on a first turn, and on a later one only where the ledger shows it is
> this turn's (§ 5.2's law: an earlier turn's row never makes this answer "not sure").
> One rule is TIGHTER than § 5.1 wrote it: a row's `quote` (and the ask's `quoted`) reads
> `'REDACTED'` on an agent where ANY tool in reach can hide arguments — it registers a tool that
> carries an argument view, or wires a ToolProvider (any provider: its list is known only per
> iteration, and a tool it first lists after a quote was filed would find the quote already on
> the record) — decided once at build, so no ordering leaks a quote; not only when the quote's
> own argument is hidden: a quote is free text, and a person who gives a user name and a
> password in one sentence puts the hidden value inside another call's quote
> (`arguments/resolve.ts` · `quotesMayShow`). The bench's
> step-5 arm and its registered rule are not part of the build; they are registered before the
> step's first paid call.
>
> **Step 5, round 1 of the paid bench's fixes (2026-09-28) — two places this page is CHANGED.
> ADOPTED overnight 2026-09-28 on the owner's go ("decide for the library, report the reason");
> the owner may overturn it ([decisions.md](decisions.md) Q44, which wins over the text below
> where they differ).** The paid run (`bench/inputs/runs/haiku45-step5`, rule
> `inputs-rule-step5`, FAIL) found the checks right and the served text wrong: the model wrote
> `from` on 35 of 268 calls, cited the person's words only beside a result it also cited, and
> re-sent an earlier answer with no source. (a) **§ 2.3, what the model is served — the ruled
> argument's sentence differs when sources are armed**, because the armed layer changes what a
> present value needs (an unsourced value is asked), and served text must say what the layer will
> do. Under the sources arm an `ask` property's sentence names the declaration where the model
> decides (`arguments/serve.ts` · `ASK_SOURCES_SENTENCE` — this page's "whatever the arms"
> sentence is kept for the unarmed layer only); `from` is explained ONCE, in its own property,
> with no "Optional:" and no "Leave an argument out rather than guess", the sources' meanings on
> `source`, and what the record keeps ("a value with no entry has no declared source on the
> record"); beside the ledger it comes FIRST in `_findings` and joins its `required`
> (`['basis', 'from']`); the instruction line is GONE (it paid for the explanation twice); and an
> answered note adds that a later call may cite that answer as `turn` (`serve.ts` ·
> `ANSWERED_SOURCE_CLAUSE`, never for a hidden answer). By the same reason, both sentences are
> served only on a tool whose schema carries `_findings.from`: a REGISTERED ruled tool whose
> author owns `_findings` is refused at build under either door (`buildToolRegistry.ts` ·
> `assertReservedArgument`, over every ruled tool of the dispatch map, a skill's scoped tools
> included), and a ToolProvider's is served and run as written, with the unarmed `ask` sentence
> and no `turn` clause (§ 2.2's "a tool that owns the name is neither decorated nor read" now
> holds for its sentences too). (b) **§ 6, arming — sources may be armed without `.findings()`;
> "Refused without `.findings()`" no longer holds**, because two laws of the architecture note's
> clause 7 — "a tool declaration may serve bytes only inside that tool's own schema" and "zero
> cost when undeclared" — forbid charging every tool the ledger's schema for a feature that needs
> `from` on ruled tools only. `.inputsLayer({ argumentSources: true })` arms the same checks and
> rows WITHOUT the findings ledger: `_findings` with `from` alone (`findings/reserved.ts` ·
> `FINDINGS_SOURCES_SCHEMA`) on ruled tools only, so every other tool and the system prompt are
> served as on a plain agent (the ledger costs every tool about 2,500 characters, which the arm
> needed only for `from`). `.findings({ argumentSources: true })` stays and serves the same
> checks, and `.findings()` + `.inputsLayer({ argumentSources: true })` serves the same bytes;
> `setAside` needs the ledger's standings, so it is filed only beside it. (c) **The option name
> `argumentSources` is kept on both doors** — one vocabulary. Every other law of this page holds:
> the checks (§ 3) are unchanged, a model declaration is a claim and never evidence, and
> membership can refute but never make an answer "known". The registered rule is frozen and not
> re-scored by these: its `full` arm still rides `.findings()`, so its S5-8 cannot pass on any
> wording — whether the next registration measures S5-8 against `off` or against the agent the
> arm needs is the owner's question.

- Written against agentfootprint 9.118.1 (`f83f277c` on main) and footprintjs 9.27.0. Every code
  fact below was re-read in the code on 2026-09-26.
- This is layer 2 of the honesty layers note ([README.md](README.md), revision 2), and it fits that
  note's contract: the seven clauses, the laws in its § 2.2, the four-valued standing, the subflow
  layout and the step plan. Where this page adds a detail the note left to it, or settles a place
  where the note disagrees with itself, it says so; § 10.1 lists every such refinement for the
  owner.
- Code is cited as `file · symbol`, never by line. Paths are under agentfootprint's `src/` unless
  they start with `fp:` (footprintjs) or `host:` (the host app that field-tests the library). The
  agent loop's folders are written short: `findings/`, `evidence/`, `coverage/`, `stages/` and the
  new `arguments/` and `honesty/` mean `src/core/agent/<folder>/`.
- Revision 1 of this page (the "arguments note") had the check inside ToolCalls, one ask per call,
  a library lookup that turned a coincidence into "the person said it", and other defects the
  four-lens review found. The appendix maps every finding about this page to where it landed.

---

## For the owner

1. The law: **no argument runs unaccounted for.** Every value on an argument a tool author ruled is traced to the person, a tool result, the app, or a default the library filled and admits — or it is recorded as the model's own, and the answer's standing says so.
2. The tool author declares, per argument, `ask` (a question, choices, and phrases the author vouches for) or `assume` (a default the library fills, never the tool), plus which argument sets the period, in the one period shape the result doors use.
3. The model declares where each value came from, in `_findings.from` — the person (with a verbatim quote), a result id, an earlier answer, the app, or "assumed" — only on ruled tools, and only under an opt-in arm.
4. The library checks each claim deterministically, by whole-token membership in the one right place. A declaration is worth only what that check reaches: an unchecked one is filed as unverified (`model`) and never trusted. A pass can stop a reason from firing; it never makes an answer "known". Text the library wrote is never evidence.
5. The layer is a small subflow after the LLM call and before Route, run once per batch and only when Route will dispatch it: one typed ask for everything missing in the batch, before any call runs.
6. Its rows join the one ledger once per batch, stamped with the conversation turn and written through the tool's own argument view, so no hidden value is stored.
7. The rules travel over MCP from the first step. The host adds two keys per tool to its Python `TOOL_EXTRAS`; its relative-window app code can go, and its absolute-window flow stays.
8. With nothing declared, every run is byte-identical to the 21 references. A tool's declaration arms it; one builder option covers tools that only a ToolProvider serves.
9. Order: the bench and its baseline (step 2), then assume (3), then ask for missing values (4), then declared sources (5). Each is kept only on a measured gain.
10. Waiting for you (§ 10): the ask rule before sources exist, asking and filling before permission, a middleware's declared origin, the composed-run marker, the names, a period on an argument with no rule (Q19), and thirteen refinements to the architecture note.

---

## 1. What the tool author declares

### 1.1 `askOrAssume` — one rule per argument (name open)

The declaration is camelCase data on the tool, next to the author's own schema, which it never
edits:

```ts
import { defineTool } from 'agentfootprint';

export const searchLogs = defineTool({
  name: 'search_logs',
  description: 'Error lines for one service over a look-back period.',
  inputSchema: {
    type: 'object',
    required: ['service', 'window'],              // the author's contract — never edited
    properties: {
      service: { type: 'string', description: 'Service name.' },
      window: { type: 'string', enum: ['1h', '2h', '24h', '7d'], description: 'Look-back period.' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },  // no rule: free
    },
  },
  askOrAssume: {
    window: {
      ask: 'Which period should the error search cover?',
      choices: [
        { value: '24h', said: ['last 24 hours', 'past day'] },   // phrases the author vouches for
        { value: '7d', said: ['last week', 'past week', 'last 7 days'] },
        '1h',
      ],
    },
    service: { ask: 'Which service should I search?' },         // no choices: a free-text field
    // the other form of a rule:  window: { assume: '2h' }
  },
  period: { argument: 'window', spelling: 'lookback' },        // § 1.2
  execute: async ({ service, window, limit }) => searchLogs(service, window, limit),
});
```

```ts
type InputValue = string | number | boolean;                       // core/inputRequest.ts · InputValue
type ArgumentChoice = InputValue | { readonly value: InputValue; readonly said?: readonly string[] };
type ArgumentRule =
  | { readonly ask: string; readonly choices?: readonly ArgumentChoice[] }
  | { readonly assume: InputValue };
interface Tool {
  readonly askOrAssume?: Readonly<Record<string, ArgumentRule>>;
  readonly period?: ToolPeriod;                                    // § 1.2
}
```

What each form means:

- **`ask`** — a value that is missing is asked of the person before the call runs, with the
  author's question and the author's choices. Once declared sources are armed (step 5), a value
  that is present but not traced to the person is asked too (§ 4.1). The ask never carries the
  model's value or the model's choices ([decisions memo](../2026-09-honest-answer-ledger-decisions.md)
  § 8.4: "the typed ask carries the model's guess when the model writes the choices").
- **`said` on a choice** — words the author vouches for as meaning that choice. The library
  matches them as whole tokens, and only inside a quote the model declared (§ 3.5, V2). It never
  scans the person's words for them on its own, and it never parses a time phrase. This is the
  ontology source-alias precedent: a declared spelling, matched as tokens.
- **`assume`** — a value that is missing is filled by the library, never by the tool, and recorded
  as `default`. The answer admits it.
- **No rule** — the argument is free. Nothing is filled or asked. A `from` entry naming a free
  argument is still checked and filed (§ 3.5).

**Missing** means, deterministically (`arguments/declare.ts` · `isMissing`, one owner): the call's
arguments have no own key for it, or its value is `undefined`, `null`, or a string that is empty
after trimming.

The name is `askOrAssume`, not revision 1's `whenMissing`, because `ask` also fires on a present
value once sources are armed (devil's review). Every name is open (§ 10, Q10).

### 1.2 The period — `ToolPeriod` on the tool, `DeclaredPeriod` on the result

The owner asked for ONE time-coverage shape, shared by the result doors and this layer. It is two
named types, and the results page uses the same two names:

```ts
// On the TOOL — which argument sets the period, and how its values are spelled.
// Declared here (step 3), carried over MCP, read by this layer and by the results layer.
interface ToolPeriod {
  readonly argument: string;
  readonly spelling?: 'lookback' | 'signed-lookback' | 'iso-range';
}

// On a RESULT — what the read covered: absent(), coverage() and describedResult() carry it
// (the results layer, step 7b; `coverage/period.ts`). camelCase in, snake_case on the wire.
interface DeclaredPeriod {
  /** ISO 8601 instants WITH a zone, of the READ that produced these rows — not of "this call". */
  readonly queried: { readonly from: string; readonly to: string };
  /** What the store holds at the time of the read, or 'unknown', said out loud. */
  readonly held: { readonly from: string; readonly to: string } | 'unknown';
  /** When that read ran. A cached answer is served minutes after the read it describes. */
  readonly readAt?: string;
}
```

- **The results page owns `DeclaredPeriod` and its verdict rule (`coverage/period.ts`); this page
  owns `ToolPeriod` and refuses a malformed one at definition.** This layer never reads a
  `DeclaredPeriod`. Its rows for the period argument carry
  `period: true`, and the results layer joins them with its verdict for the same call
  (`covered` · `partly-held` · `not-held` · `unknown` · `undeclared`). So the standing can say, in
  one clause, "window = "2h" was assumed, and the store holds data only from 14:20".
- **The spellings are declared formats, not phrases.** `lookback` is a positive integer and a unit
  (`30m`, `24h`, `7d`, `2w`); `signed-lookback` is the same with a leading minus (`-24h`);
  `iso-range` is two ISO 8601 instants joined by `..`. The library converts only between `lookback`
  and `signed-lookback` (`24h` ↔ `-24h`), by adding or removing the leading minus — nothing is ever
  turned into a duration. It never converts an `iso-range` (that needs a clock the library does not
  own), and it never compares a period with "now" — the results layer compares instants the tool
  declared.
- **What the spelling buys this layer:** the batch ask asks ONE period question for calls whose
  spellings convert (§ 4.3), and an earlier answered period traces to a later period argument in
  another spelling (`matched: 'spelling'`, § 3.5 V4). The host needs both: its time-series tools
  spell `24h`, a network tool `-24h`, a storage tool `-60m`, and a packet tool an ISO range, so a
  question that touches two tool families would otherwise ask twice.
- **Only an argument that bounds the period the answer covers may be a period.** A freshness
  horizon ("how far back to find the newest collection") is not one, and the README says so with
  the host's own examples.
- **Why not the word `window`:** it already names the context window (`src/core/agent/window/`,
  `.window()`). The example's argument is called `window` because that is the author's name for it.

### 1.3 Refused at definition, at dispatch and at MCP ingest

`arguments/declare.ts` · `assertAskOrAssume` is called from `core/tools.ts` · `defineTool` beside
`assertToolWants` and `assertArgumentsFrom`. `defineTool` copies fields one by one, so it also
copies `askOrAssume` and `period`. A rule is refused, naming the tool and the argument, when:

- the argument is not in `inputSchema.properties`, or its type is not exactly one of `string`,
  `number`, `integer`, `boolean` (a type union, a nullable type, an object or an array is not ruled
  in v1), or it is a `wants` argument (an artifact ref is never the person's to type);
- the rule has both `ask` and `assume`, neither, or an unknown key;
- `ask` is blank or longer than 4096 characters (`core/inputRequest.ts` · `validateInputDeclaration`'s
  bound);
- `choices` is empty, has more than 100 entries, repeats a value, or holds a value that fails the
  property's own schema;
- a `said` phrase has no token after normalisation, is longer than 120 characters, the same phrase
  is declared on two choices of one argument, or a choice declares more than 16 phrases (bounds
  open);
- the `assume` value fails **the property's own schema** — `inputSchema.properties[arg]`, judged by
  the node validator. Not by `toolArgsValidation.ts` · `validateToolArgs` on `{ [arg]: value }`:
  that enforces the root `required`, so it would refuse the example above for its missing
  `service` (engineer review). The node validator is module-private today
  (`toolArgsValidation.ts` · `validateNode`); step 3 exports it, or calls `validateToolArgs` with a
  one-property schema that has no `required`, which judges the same node;
- more than 32 arguments carry `ask` (the typed ask's field limit);
- `period` names an argument with no rule, `spelling` is outside the three, or a choice or the
  `assume` value does not parse under the declared spelling;
- **until step 4 ships, any `ask` rule** — so no declaration promises what the library cannot yet
  do. The refusal names the step.

One warning, not a refusal: a ruled property whose `description` contains the word "default" (the
rule's own sentence now says it, § 1.6).

**The same rule set runs again at dispatch** (`arguments/declare.ts` · `rulesOf`), because a Tool
built by hand or delivered by a ToolProvider never passes through `defineTool`. A rule that fails
there refuses the call and is never repaired (§ 4.5). **And at MCP ingest** (§ 1.4), where a
failing field is dropped with a warning, like every other extra.

### 1.4 Over MCP, from the first step

The host's production tools arrive over MCP: its service unit turns the MCP path on, and its
catalog replaces each local binding with the served tool (`host:src/mcpCatalog.ts`). A layer that
left MCP tools free would do nothing there. So step 3 carries both declarations:

- **Serve.** `lib/mcp/toolExtras.ts` · `toolExtrasOf` copies `askOrAssume` and `period` verbatim into
  `_meta.agentfootprint`, under the same camelCase keys as the tool fields (`argumentsFrom`,
  `resultCeiling` already travel this way). `mcpServe` still serves the author's registry schema,
  `required` intact.
- **Ingest.** `lib/mcp/toolExtras.ts` · `readToolExtras` judges each field with the same exported
  assert `defineTool` calls. These are the first extras judged against the tool's schema, so
  `McpToolExtrasOrigin` gains the listed tool's `inputSchema` (`lib/mcp/mcpClient.ts` and
  `mockMcpClient.ts` pass it). A field that fails is warned once — naming the server, the tool, the
  field and the rule — and dropped. The tool still registers, and its argument then runs free.
- **The file's bar holds.** "A declaration a consumer-side check or rail reads; nothing that
  governs execution": the fill and the ask happen in the client's own loop before the call is sent,
  exactly as the client applies a served `resultCeiling`. Nothing about how the server runs the
  tool changes.
- **A client that ignores `_meta`** sees the author's `required` and sends the value, or the server
  applies its own default. The library claims nothing there.
- **The period on results** travels in the result itself (the results page). The host's Python
  helpers mint it from the `canonical-notes.json` wire contract (step 7b).

### 1.5 The host app, before and after

The host's Python side owns the declarations (`host:py-tools/tool_metadata.py` · `TOOL_EXTRAS`),
and `host:py-tools/mcp_server.py` serves each entry as `_meta.agentfootprint`. One entry, with a
neutral tool name standing in for the host's I/O-profile tool, whose Python signature defaults the
period to `"24h"` today:

```python
# BEFORE — the period default lives only in the Python signature; nobody chose it.
TOOL_EXTRAS = {
    "io_profile": {"resultKind": ROWS,
                   "resultCeiling": {"maxChars": 90000, "narrowBy": ["port", "time_range"]}},
}

# AFTER — two keys: the library fills the default and records it, or asks.
TOOL_EXTRAS = {
    "io_profile": {"resultKind": ROWS,
                   "resultCeiling": {"maxChars": 90000, "narrowBy": ["port", "time_range"]},
                   "askOrAssume": {"time_range": {"assume": "24h"}},
                   "period": {"argument": "time_range", "spelling": "lookback"}},
    "packet_records": {"resultKind": ROWS,   # a period that must be the person's
                   "askOrAssume": {"window": {
                       "ask": "Which period should the packet search cover?",
                       "choices": [{"value": "-30m", "said": ["last 30 minutes", "last half hour"]},
                                   {"value": "-6h", "said": ["last 6 hours"]}, "-24h"]}},
                   "period": {"argument": "window", "spelling": "signed-lookback"}},
}
```

The TypeScript side, `host:be-server/queryWindowFlow.ts` · `createQueryWindowFlow` (143 lines), is a
collecting tool that raises `requestInput`, a provider wrapper that forces that tool's choice, a
before-tool middleware that rewrites `window` and `timezone` from the collected receipt, and an
after-tool hook that attaches `query_context.provenance`:

| Part of the flow today | After adoption |
|---|---|
| Relative look-backs. The collecting tool's description tells the model never to call it for a relative window, because that "asks the person for something they already gave". | **Moves to the library.** The source tools declare `ask` or `assume` over MCP. A missing relative period is asked once per batch with the author's choices; a present one is checked against the person's quoted words once sources are armed. The description warning can go. |
| Absolute, compound windows: a calendar date, a year, a timezone, two bounds and a DST-safe conversion (`host:be-server/timeContext.ts` · `finishQueryWindow`), plus the forced-choice provider wrapper. | **Stays app code.** A rule per argument cannot check four values together. It stays `requestInput` inside the collecting tool. |
| The middleware that rewrites `window` and `timezone` for an absolute request. | **Stays.** The layer checks the model's value before any middleware runs; a later rewrite of a ruled argument reads as assumed unless the middleware declares where the value came from (open question Q8: `allow(args, why, { from: { window: 'person' } })`, which the host can fill from its receipt's `origins`). |
| `query_context.provenance` with origins `declaration` (app default) or `response` (the person). | May stay as the app's own record. For relative periods the ledger now carries the same fact: `declaration` ↔ `default`, `response` ↔ `answered`. |

Two conditions for the host, stated plainly: it pins agentfootprint 9.116.0 today and must re-pin
to the release that carries steps 3 and 4; and some of its tools reach the agent only through
ToolProviders (`host:src/agent.ts` composes them), which the build cannot see, so it arms the layer
with the one builder option (§ 6). A step counts as delivered only when the host re-pins and the
behaviour is counted by hand.

### 1.6 Migration — one default, in one place

- **Delete default prose from a ruled argument's description** ("optional, defaults to 1h",
  "Default -60m"). The rule's served sentence now says it (§ 2.3); two copies drift.
- **Keep the server's own default** as the fallback for clients that ignore `_meta`, and pin it:
  the host's catalog parity test asserts that the Python default equals the declared `assume`.
- **A model that sends the default explicitly** — copying it from a description — is filed
  `default`, not as its own value (§ 3.5, V1). The standing then says "assumed", which is what
  happened; the bench counts how often models echo a default.

---

## 2. What the model declares

### 2.1 `_findings.from` — armed by `.findings({ argumentSources: true })`

It rides the reserved argument the model already writes, on the call whose arguments it describes.
Its shape copies `previous[]`, so the model meets one pattern. This array form is the one the
architecture note's § 3.2 (b) kept, over the object map of that note's own first revision:

```json
"_findings": {
  "basis": "direct",
  "from": [
    { "argument": "service", "source": "user", "quote": "errors on checkout" },
    { "argument": "window",  "source": "user", "quote": "over the last week" },
    { "argument": "host",    "source": "result", "id": "toolu_01AbC" },
    { "argument": "limit",   "source": "assumed" }
  ]
}
```

| `source` | Needs | Meaning | Checked against (§ 3.5) |
|---|---|---|---|
| `user` | `quote`: the person's words, copied exactly | the person said it | the person's messages (V2) |
| `result` | `id`: a tool_result id | a tool result carried it | that one result's own bytes (V3) |
| `turn` | — | the person answered it in an earlier turn | the ledger's earlier `answered` rows (V4) |
| `app` | — | the app's own text carries it | the app corpus (V5) |
| `assumed` | — | the model chose it | nothing; filed as the model's (V6) |

A value the person wrote in an earlier turn is a `user` source with its quote — quotes are checked
across every person message still in the window. `turn` is only for the person's earlier
*answers* to the library's ask, which live on the ledger and not in any message (§ 3.5, V4 says why
this is narrower than the architecture note's wording).

### 2.2 How it is read

- **One reader.** `findings/reserved.ts` · `readDeclaration(raw, arms)` gains `from`, read through
  `arguments/sources.ts` · `readSources`, only when `arms.argumentSources` is on. Unarmed, `from` is
  ignored exactly as unknown keys are today, so a `.findings()`-only agent is byte-identical. The
  arm is threaded through `splitFindings` and ToolCalls' `peelCall`, so both reads of one
  `_findings` agree.
- **A `from`-only `_findings` is readable** under the arm. Today `readable` covers basis, expect,
  proposition, predicts and previous only, so it would be dropped (engineer review).
- **Malformed entries are dropped and counted, never defaulted.** An entry is malformed when it is
  not an object; `source` is outside the enum; `user` has no `quote` or `result` has no `id` (a
  string each); `argument` is not a top-level argument of this call; or it names an argument an
  earlier entry already named (the first wins). The count joins the basis row's `malformed` when
  the call files a basis row (the existing law). When it files none — `findings/ledger.ts` ·
  `basisRowFrom` needs a basis — the count goes on the call's first argument row as `malformed`
  (§ 5.1), so it is never lost.
- **Who reads it when.** The inputs layer runs before ToolCalls, so it reads each call's RAW
  `_findings` from the batch (`llmLatestToolCalls`) through the same reader. ToolCalls' peel later
  reads the same value for the basis, contingent and standing rows, and does nothing more with
  `from`.
- **A tool that owns the name** (`findings/reserved.ts` · `ownsReservedArgument`) is neither
  decorated nor read: its calls declare nothing, and `claimed` is absent on its rows.
- **Import direction.** `findings/` imports `arguments/` (the reader, the row type); `arguments/`
  never imports `findings/` (§ 3.1).

### 2.3 What the model is served

Every served sentence is registered in `test/modelFacingSurfaces.test.ts` at the strictest lifetime
and passes `unprovable`: it says what the model may do and what the record keeps, and promises no
outcome a later path can break (architecture law 7). The wording is a draft; the step-5 bench gates
it.

**A ruled tool's schema, whatever the arms.** The served copy drops ruled arguments from `required`
and appends one sentence to each ruled property's description:

- *ask:* "The tool's rule asks the person for this value; leave it out unless the person gave it."
- *assume:* "If left out, the tool's rule fills "2h", recorded as assumed."

Revision 1's sentences promised outcomes other paths break ("waits for the person's choice before
it runs" is false when permission denies the call or inner dispatch refuses it).

- **Where.** At the one decoration site, `core/slots/buildToolsSlot.ts`, one step before
  `withFindingsArgument`, and in its seed twin (`stages/seed.ts`, `dynamicToolSchemas`). Both return
  a rebuilt copy and never edit a registry reference: `validateToolArgs` still judges the author's
  `required`, and `mcpServe` still serves the author's schema.
- **Which rules.** The rules of the implementation that will run. `commitWire` receives schemas
  only, and `mergeWire` returns `winners` as name → party, so step 3 makes `mergeWire` also return
  the winning `Tool` per served name (engineer review). A name with no known tool — a chart with no
  claimant record — is not decorated; the dispatch re-read is its guard.
- **Replay.** `lib/time-travel/servedView.ts` · `viewOf` rebuilds the committed list byte for byte,
  so the decoration must be a pure function of the committed schema and the rule.

**The `from` property — under the sources arm, on ruled tools only.** `withFindingsArgument` plants
`_findings` on every served tool today; the review measured the drafted `from` schema at about 611
characters, so planting it everywhere would cost thousands of tokens per call before any benefit is
measured (practitioner review). A tool with a rule or a period gets a composed, frozen variant of
`FINDINGS_ARGUMENT_SCHEMA` (the `offeredFindingsSchema` precedent); every other tool keeps the base
by reference. The description's first sentence — "Findings v1 (reserved by the agent runtime)." —
is unchanged, so `withoutFindingsArgument` still recognises the decoration.

```ts
from: {
  type: 'array',
  description:
    'Optional: where each argument value of this call came from, one entry per argument. ' +
    'Leave an argument out rather than guess.',
  items: {
    type: 'object',
    properties: {
      argument: { type: 'string', description: "The argument's name in this call." },
      source: { type: 'string', enum: ['user', 'result', 'turn', 'app', 'assumed'] },
      quote: { type: 'string', description: "source 'user': the person's words the value came from, copied exactly." },
      id: { type: 'string', description: "source 'result': the tool_result id, as listed for previous[].toolCallId." },
    },
    required: ['argument', 'source'],
  },
}
```

`id` carries no enum of its own: a second copy of the offer on every ruled tool would double the
offer's bytes, and the description points at the list the model already copies from.

**One instruction line**, from `findings/reserved.ts` · `findingsInstructionFor({ contingent,
argumentSources })`, only under the arm:

> `_findings.from` on a call to a tool that carries it: for each argument value that came from
> somewhere, say where — 'user' with the person's exact words as `quote`, 'result' with the
> tool_result `id`, 'turn' when the person answered it in an earlier turn, 'app' when your
> instructions carry it — or 'assumed' when you chose it. Each entry is recorded with the library's
> check of it.

**Past-tense notes on results**, each tied to its call (Lens law 2), appended by ToolCalls after the
cap beside the step suffix and the repeated-call note:

- *assumed:* "window was not in the search_logs call this result answers; the call ran with "2h",
  the value the tool's rule assumes — recorded as assumed, not as the person's."
- *answered:* "window = "24h" in the search_logs call this result answers was chosen by the person
  when asked (the call had carried "2h")." — or "(the call had left it out)."
- *hidden:* when the tool's argument view hides the argument, the note says "the value is hidden by
  the tool's view" instead of printing it, because the served tool message is itself part of the
  record.

The value stays in a note the model can read, because the model needs it to reason ("no errors in
the last 2h"). The note is never evidence for that value (§ 3.4, the tool-bytes boundary).

---

## 3. The checks

### 3.1 Where the layer runs, and what it is handed

```
… → CallLLM → [NormalizeThinking] → ⟨Choice layer⟩ᴬ → ⟨Inputs layer⟩ᴬ → Route ─┬─ tool-calls: ToolCalls (applies the layer's results) ──loopTo──▶
                                                                               └─ final · output-retry · step-nudge · evidence-recheck · wrap-up
ᴬ mounted only when armed — the unarmed chart is byte-identical (the WrapUp precedent).
```

- **After the LLM call, before Route.** A footprintjs decider branch can loop only to a stage
  declared before the decider and has no other continuation (`fp:src/lib/builder/FlowChartBuilder.ts`
  · `DeciderList._applyBranchLoop`), so "between CallLLM and ToolCalls" can only mean after the LLM
  and before Route (architecture § 5.2). In the dynamic chart CallLLM sits inside `sf-llm-call`;
  the layer mounts outside it, at the same place. Both chart builders call one mount helper
  (`honesty/mounts.ts`), so the twins cannot drift. The subflow id (`sf-inputs`, name open) joins
  `conventions.ts` so `stageRole` and `milestoneFor` name it and the lens does not show it as an
  unknown stage.
- **Only for a batch that will dispatch.** `stages/route.ts` · `decideBranch` picks `tool-calls`
  only when there are calls, the run is not out of iterations, and no halting cost budget fired —
  and every Route decider variant returns `tool-calls` whenever it does (checked in all three). That
  test is lifted into one exported pure predicate over the five values it reads (the call count,
  `iteration`, `maxIterations`, `costBudgetHit`, `costBudgetOnExceed`), which `decideBranch` itself
  calls. The layer asks the same function, so it never asks the person about a batch Route then
  sends to the final branch.
- **Per batch, not per call.** It checks every call, fills what it may, asks once for everything
  that must be asked, and only then does anything dispatch.

**What the layer is handed** (the input mapping; footprintjs freezes these inside the subflow):

- the batch (`llmLatestToolCalls`, the model's raw arguments with `_findings` still on them), the
  five predicate values, and `turnNumber`;
- the served `history` and `systemPromptInjections` — the person, result and app text;
- only under the sources arm: a **standings projection** — `findings/ledger.ts` · `foldLedger` over
  the ledger PLUS the standings this batch's own `_findings.previous[]` declares, computed in memory
  and never filed (ToolCalls files them a moment later). This keeps `setAside` equal to the
  contingent law at dispatch, which also counts a standing declared on the same batch
  (`stages/toolCalls.ts`, the towers comment). And the ledger's earlier **`answered` rows**. Never
  the whole ledger;
- the rules, through a deps accessor that resolves each name exactly as ToolCalls will
  (`stages/toolCalls.ts` · `resolveTool`, lifted into one shared resolver), so the rules checked are
  the rules of the implementation that will run. Tools are closures and never enter scope.

**What it returns** (the output mapping, `arrayMerge: Replace` on both keys — the loop-crossed mount
law):

- its rows, merged into the ledger by `findings/ledger.ts` · `appendRows` (§ 5.2);
- `argumentResolutions` — one entry per call it resolved:
  `{ toolCallId, fills?: { argument, value, source: 'default' | 'answered' }[], refused?: string }`.
  The architecture note calls this "the fills array"; a refused call needs the same carrier, so the
  entry is per call. Nothing to return means nothing is written.

The mount's mappers live in `honesty/mounts.ts`, which imports both `findings/` and `arguments/`.
That is how **`arguments/` stays a leaf**: it builds rows and resolutions from what it is handed,
and never imports `findings/` (devil's review: revision 1 imported in both directions).

### 3.2 The four stages

| Stage | Does | Owner |
|---|---|---|
| **Declare** | Resolves each call's tool; re-reads its rules (`rulesOf`); reads `from` under the arm; finds missing values. Returns at once when the predicate says no dispatch, or when no call is ruled and no `from` was declared. | `arguments/declare.ts` |
| **Verify** | Runs the checks of § 3.5 — pure functions, handed the corpora. | `arguments/sources.ts` |
| **Record** | Builds one row per ruled argument per call (and one per `from` entry on a free argument), emits one `agentfootprint.findings.argument` event per row, and stages the rows on the subflow's scope. | `arguments/rows.ts` |
| **Resolve** | Applies the table of § 4.1: fill, ask, pass, flag or refuse; builds `argumentResolutions`. The ask is two nodes: `Ask`, a pausable stage whose resume half receives the answers, and `Bind`, a small decider that loops back to `Ask` when an answer must be asked again (§ 4.3). | `arguments/resolve.ts`, `arguments/ask.ts` |

### 3.3 The membership rule — one owner of "the same value"

- **Text.** Both sides go through `evidence/normalize.ts` · `tokenize`, then `canonicalForm` per
  token (`41,200` ≡ `41200`, `0xef0101` ≡ `ef0101`). A needle is in a text when its token sequence
  occurs contiguously in the text's token sequence. Whole tokens only, never substrings; no
  extractor, so `2h`, `24h` and plain words can all be checked. A number or a boolean is checked
  through its `String()` form.
- **A tool result.** Read the way the evidence index reads one — parse, apply
  `coverage/evidence.ts` · `absenceEvidenceProjection` (so an absence's `looked_for`, which quotes
  the request, never grounds), walk the leaves, fall back to text. That routine is
  `evidence/evidenceIndex.ts` · `indexResult`, module-private today; step 5 exposes it from
  `evidence/` as ONE per-result function (`resultCarries(content, value)`, name open). A one-token
  value is found when it equals a leaf or a leaf's token; a longer value must occur contiguously
  inside one string leaf (or in the text fallback). **Never `tokenize` over the raw JSON string:**
  run on 2026-09-26, `tokenize('{"host":"srv-4417","limit":50,"window":"24h","ok":true}')` returns
  `host, srv-4417, limit, :50, window, 24h, ok, :true` — every number and boolean in compact JSON
  would fail as `not-in-result`, a false accusation (devil's review).
- **Ceiling.** A haystack that reaches the index's token ceiling (`evidence/evidenceIndex.ts` ·
  `MAX_INDEX_TOKENS`) before a match is `uncheckable`, never "not found".
- **No second normaliser.** The layer adds no NFKC or case rule of its own. A character outside the
  token alphabet (`２４ｈ` returns no tokens at all, checked) vanishes on both sides; a value or quote
  left with no token is `uncheckable`. If Unicode folding is wanted, it goes into `normalize.ts` for
  the evidence gate and this layer together, as its own measured change.

### 3.4 Which text counts

- **The person's words.** Every served history message that `lib/saidByPerson.ts` · `isSaidByPerson`
  accepts, the current request included, within the window. That predicate excludes every frame the
  library writes in a person's voice and every injected message; it is cited without a count.
  A match in a message before the current request sets `earlier: true`.
- **A composed run's message is not a person's.** The patterns pass model-written text as the run's
  message (`patterns/Reflection.ts` · `reflection` sends "Proposal to critique: …"; debate, swarm
  and map-reduce do the same), and so do the core-flow composers when one runner's output becomes
  the next one's message. Those runners mark their runs (a run-level origin, committed as a run
  constant only when set; open question Q9). In a marked run, a quote found only in the run's own
  message fails as `composed-message` (§ 3.5, V2) — it is another model's words.
- **The person's answers.** The ledger's `answered` rows of earlier turns (handed in, § 3.1), and
  this layer run's own answers. An answer lives on the ledger, not in a message, so compaction
  never evicts it.
- **A result's own bytes.** The committed `role: 'tool'` content for that id, as the model was
  served it — cut at the **tool-bytes boundary** when the message carries one. ToolCalls appends
  this layer's notes after the tool's own text; a check that read the whole message would find
  "2h" in the note and turn an assumption into an observed value on the next call (engineer review,
  a MUST-FIX). So when ToolCalls appends a layer note, it stamps a framework field on the committed
  message (`toolChars`, name open: the length of the tool's own delivered text, the same string the
  repeated-call ledger fingerprints). `composeRequest.ts` · `stripFrameworkFields` removes it from
  the wire and `carriesFrameworkFields` lists it, beside `injectedBy` and `notDispatched`. The
  evidence index reads through the same cut, so the note never grounds an answer either. The field
  exists only on a message the layer annotated, so every existing run indexes exactly what it did.
- **The app's text.** The reach of `evidence/evidenceIndex.ts` · `exemptFromRun` minus the person's
  turns: `role: 'system'` history messages and `systemPromptInjections` (raw content, or the summary
  a redacted record carries). That reach includes memory recall and retrieval passages, and it is
  stated as such (open question Q14). Plus the values of `AgentOptions.externalGrounds`, each with
  its `source` label. Plus, once the declared-control page's capability 1 ships, the run's `given`
  leaves — read through the run's own accessor, because `given` is never committed to scope — with
  a label `given.<key>`. Never the library's served schema sentences, notes or frames.
- **Assistant text is never evidence** for a value.

### 3.5 The checks, one per declared source

Each ruled argument of each call goes through the steps below, and so does each argument a `from`
entry names. The checks run on the raw value in memory; nothing raw is stored (§ 5.1). Every check
is a pure function of what the layer was handed: the same inputs always give the same row.

- **V0 · Missing?** (`isMissing`, § 1.1). A missing value has no source to check; it goes straight
  to Resolve.
- **V1 · The declared default — applied last, after V2–V6.** When the claimed source did not
  verify as the person's (V2's `said` via quote or phrase, or an answer via V4), and the present
  value equals the argument's own `assume` value (canonical forms), the row is `source: 'default'`,
  with `claimed` (and any `failed`) kept as written and the model's value in `proposed` — which is
  how a reader tells a default the model sent from one the library filled.
  This closes two holes: a model that echoes the default from a description is not credited with a
  choice (practitioner NOTE), and a default cannot earn `app` or `result` standing because the same
  string happens to sit in the system prompt or a result (practitioner review: a default must never
  earn more standing than the same default declared as `assume`). The person beats the default; the
  default beats the app and a result.
- **V2 · `user` + quote.**
  - The quote must occur in the person's words (§ 3.4). If not: `failed: 'quote-not-found'`. In a
    marked composed run, a quote found only in the run's own message: `failed: 'composed-message'`.
  - The value occurs inside the quote → `said`, `matched: 'quote'`.
  - Else, a phrase the author declared for the value's own choice occurs inside the quote → `said`,
    `matched: 'phrase'`. ("over the last week" contains "last week", declared for `7d`.)
  - Else → a **reading**: `said` + `reading: true`, with the words and the value both kept. A quote
    that holds a phrase declared for a DIFFERENT choice is a reading too. Under an `ask` rule with
    sources armed, a reading **asks** (§ 4.1) — revision 1 let it run, which let any exact fragment
    of the person's message carry any value past an `ask` rule (devil's review, a MUST-FIX).
- **V3 · `result` + id.**
  - The id must be in `findings/offer.ts` · `knownResults` over the served history and the previous
    batch — a settled message is no result (`isResultMessage`). If not: `failed: 'unknown-result'`,
    never resolved by position (the `unknownId` precedent). A sibling call in the same batch is not
    known: the model wrote this call before that result existed.
  - A placement ticket (`artifacts/placement.ts` · `isPlacedToolResult`): `failed: 'placed-result'`.
    The model was served a ticket, not the value.
  - The value must be in that result's own bytes, read by the one per-result function (§ 3.3). If
    not: `failed: 'not-in-result'`. Found → `result`, with `result` = the id.
  - The standings projection gives the model's current standing on that result: `open`, `noise` or
    `ruled-out` → `setAside`. This is the contingent law, for any value, from any turn, with no
    extractor.
  - When the tool declares `Tool.argumentsFrom`, the row says whether the cited result's tool is one
    of them: `argumentsFrom: 'listed' | 'unlisted'`. A flag for the lens and the bench, never a
    refusal (engineer NOTE; the architecture note left this detail to this page).
- **V4 · `turn`.**
  - No earlier turn: `failed: 'no-earlier-turn'`.
  - An earlier `answered` row whose value equals this one (canonical forms; when both are period
    arguments, also through the declared spelling conversion, `24h` ↔ `-24h`) → `answered` +
    `earlier: true`, with `matched: 'spelling'` when the conversion was needed.
  - Else the value is looked up in earlier person words, results and app text. A hit is a **hint**:
    `model` + `coincides` + `earlier: true`. To be verified, the model quotes the words (`user`) or
    names the result (`result`).
  - Else, found only in assistant text: `failed: 'only-in-model-answer'`. Found nowhere:
    `failed: 'not-in-earlier-turns'`.
  - **Narrower than the architecture note's wording, on purpose.** That note lets a `turn` claim
    resolve to `said`, `result` or `app` by a library search of earlier turns. A search the library
    runs on its own is a hint under its own law 2, and a value-only match is the coincidence the
    reviews rejected ("we have 7 hosts" is not `days: 7`). Each declared source is checked against
    its one corpus: person words through a quote, a result through its id, an earlier turn through
    the answers the ledger holds (§ 10.1, R1).
- **V5 · `app`.** The value must occur in the app's text (§ 3.4) → `app`, with `appSource` naming
  the `externalGrounds` label or `given.<key>` that matched (absent for prompt text). If not:
  `failed: 'not-in-app-text'`.
- **V6 · `assumed`, or nothing declared** (sources unarmed, or no entry for this argument) → `model`,
  with `claimed: 'assumed'`, `'none'`, or absent when the arm is off. The library still looks the
  value up in the person's words, the results and the app's text, and records a hit as
  `coincides: 'person' | 'result' | 'app'` — a hint for the lens and the bench, never a source,
  never support, and never enough to skip an ask. Revision 1 turned such a hit into `said` (its
  "C6"); a person who wrote "we have 7 hosts" would then have "said" `days: 7` (engineer and
  research reviews).
- **A failed claim** keeps `claimed` and `failed` as written. It is never repaired and never falls
  back to another check: a false claim is itself a fact. The hint is still computed, so a misquote
  with a correct value shows as exactly that.

### 3.6 What cannot be checked, and how the row says so

| Cannot be checked | Recorded as |
|---|---|
| What the person meant ("last week" → `7d`) when the author declared no phrase for it | a reading: `said` + `reading`, the words and the value both kept. The library never parses a time phrase. |
| A negation or another sentence ("not the last 24h — the whole week", quoted as "the last 24h") | passes membership. Undetectable — which is exactly why membership never supports "known". |
| A quote that is only the value, taken from another sense ("the 24h dashboard" quoted as "24h") | passes. Never support; the bench counts one-token quotes. |
| A short or common value (`7`, `true`) that the library's own lookup finds | a hint only, and a weak one: the bench splits hints at `integrity/argumentLeaves.ts` · `MIN_CHECKED_LENGTH` (4 characters), the library's own bound for such matches. |
| A value or quote with no token after normalisation, or a haystack past the index ceiling | `failed: 'uncheckable'` — never a pass, never "not found". |
| Messages the window evicted, and a compaction frame (never the person's words) | not found: the check is window-relative, like the evidence index. Answers survive, because they live on the ledger. |
| An argument the tool's view hides, checked against an answer from an earlier batch | `failed: 'uncheckable'`: the record keeps no raw value to compare (§ 5.1). |
| A result that echoes the argument it was called with (other than `looked_for`) | passes — the evidence gate's documented bound. The earlier call has its own rows, so the chain stays visible. |
| A result an after-tool rule replaced, or a ceiling refused | membership reads the served text, which is the app's or the library's. Layer 3's outcome row (step 8) will mark such calls. |
| Another library suffix on a message the layer did not annotate (a step banner, an effect note, the repeated-call note) | read as today. These carry tool names and counts, never argument values, but a count can pass a small number (open question Q15). |
| Whether the tool actually used the value | out of scope here; the tool's own `DeclaredPeriod.queried` is its declaration of what it read (step 7b). |
| Nested or non-primitive arguments | not ruled in v1; a `from` entry naming one is malformed. |
| An author's declaration that is wrong — a `said` phrase declared for the wrong choice, an `assume` value the server does not honour | nothing: tool, app and person declarations are the trust base (architecture § 1.2), and a wrong one yields an honest-looking row. The host's catalog parity test (§ 1.6) and the study's checks from outside the library are the guard. |

---

## 4. Resolve — ask, assume, pass

### 4.1 One table, applied only to a batch that will dispatch

`arguments/resolve.ts` · `resolveArguments` is pure. It is the architecture note's table (§ 3.2 (d)),
with V1's default rule made explicit:

| The value | `assume` rule | `ask` rule, sources **unarmed** | `ask` rule, sources **armed** | no rule |
|---|---|---|---|---|
| missing | **fill** → `default` | **ask** (`asked: 'missing'`) | **ask** (`asked: 'missing'`) | nothing |
| present, verified — `said` via quote or phrase, `answered`, `result`, `app` | run | run | run | run; a row only if `from` named it |
| present, equal to the declared default and not the person's (V1) | run → `default` | — (an `ask` rule has no default) | — | — |
| present, unverified — undeclared, `assumed`, a hint only, a failed claim, a reading | run, flagged → `model` | run, flagged → `model` — **open question Q2** | **ask** (`asked: 'unverified'`) | run; a row only if `from` named it; a failed claim flags |

`setAside`, `reading` under an `assume` rule, `coincides` and `argumentsFrom` never block. They are
flags the fold and the lens read.

**Why the unarmed `ask` cell flags instead of asking.** With sources unarmed, the model has no way
to say where a value came from, so every present value is unverified, and the ask would fire on
nearly every call — including when the person already gave the period in words. The spellings
rarely meet: `tokenize` keeps `-24h` and `24h` apart and splits "24 hours" into two tokens (checked).
The host met exactly this in its own flow (§ 1.5). So a present value is asked only once sources are
armed (step 5), and step 4 measures the needless-ask rate before anything else is decided
(practitioner review, a MUST-FIX).

### 4.2 Assume

- **The library fills the value, never the tool.** The fill is an entry in `argumentResolutions`;
  ToolCalls applies it (§ 4.6). The row is `source: 'default'`.
- **The model is told**, in past tense, on the result of the call that ran (§ 2.3).
- **The answer carries the assumption as data first**: the rows; the argument event with names and
  enums; and, from step 6, the standing's field on the run's result. The host dropped the appended
  limits block on the owner's 2026-09-18 ruling — "the boundary is the reader's, drawn in the lens"
  — and shows counts it reads from events (`host:be-server/coverageMark.ts`). It can count
  "1 assumed" the same way (practitioner review).
- **Prose only under an opt-in arm.** Under an existing `.limitsTravelWithTheAnswer()`,
  `coverage/answer.ts` · `composeAnswerWithCoverage` takes the `default` rows as a second input:

  > Assumed (a tool's rule, not your words):
  > - window = "2h" (search_logs)

  With neither coverage rows nor default rows the answer is unchanged. From step 6 on, the standing
  line owns the "assumed" sentence whenever both arms are on — one composer for one fact (devil's
  review). `stages/prepareFinal.ts` · `prepareFinalWithLimitsStage` reads the default rows only when
  the run constant says the inputs layer is armed (architecture law 9: a tracked read of a key a run
  never writes is a phantom context source). None of the 21 references arms the limits block, so
  step 3 adds one that does.
- **The evidence gate.** A declared default is the app's own declaration, so the gate treats it as
  exempt, like a value in the system prompt: `exemptFromRun` gains the declared `assume` value of
  every (tool, argument) that filed a `default` row this turn — read from the declaration, never
  from the row. The library's note grounds nothing (§ 3.4). If the tool's own result echoes "2h",
  that echo grounds it as today. The fold says who chose it.

### 4.3 Ask — once per batch, before anything runs

**When.** A missing value on an `ask` argument; and, under the sources arm, a present unverified
value on one (a reading included).

**The declaration** (`arguments/ask.ts` · `argumentAskDeclaration`), accepted by
`core/inputRequest.ts` · `validateInputDeclaration`:

- **A fixed library question**, not the authors' questions joined: "Before the next step can run, a
  few values are needed. Each field says what it is for." Joined questions could pass the
  4096-character bound at pause time although each rule passed it at definition (engineer review).
- **One field per distinct (tool, argument)**, bound to every call in the batch that needs it. Two
  period arguments share one field when their spellings convert and every converted choice is a
  valid choice of each; otherwise they stay separate fields. An `iso-range` period never merges.
- **Field ids are positional** (`f1`, `f2`, …) — never a joined `tool.argument` string, which two
  different pairs could spell alike (the injective-key law in agentfootprint's CLAUDE.md).
- **Each field:** `type` from the property (`integer` asks as `number`); `required: true`;
  `description` = the author's question; `enum` = the author's choices' values, when declared.
- **No `supplied`.** Nothing the model proposed rides the ask.
- **`context`**: `{ agentfootprint: { ask: 'arguments', fields: [{ id, tool, argument, calls,
  quoted? }] } }`. `quoted` is the person's own words, only when an unverified quote triggered the
  ask and the tool's view does not hide the argument — the model's value is never shown. The
  reserved key is the library's marker. JSON, at most 16384 characters (the declaration's bound).
- **More than 32 fields** (the typed ask's limit): the ask goes in rounds of 32, through the loop
  below.

**The pause.**

- It is a pausable stage inside the layer's subflow. footprintjs carries a paused subflow's state
  in the checkpoint (`checkpoint.subflowStates`; `fp:test/lib/pause/subflow-scope-resume.test.ts`,
  including a fresh executor resuming a serialized checkpoint).
- `core/inputRequest.ts` · `stampInputRequest` stamps it. A batch ask has no single call, so
  `origin.toolCallId` names the batch's first asked call and `context` lists the rest — a named
  change to the stamp, in step 4.
- The rows are already staged and their events already fired (the Record stage ran first). They
  reach the ledger when the layer completes.
- **Nothing to settle.** No call of the batch has run, and the batch's assistant turn is not even in
  `history` yet: ToolCalls appends it (`stages/toolCalls.ts`, the assistant-turn push before
  dispatch). The per-call design had to settle later siblings on resume; this one does not.
- There is no `ask` or `checkIn` key, so `core/pause.ts` · `pauseDemandsDecision` returns nothing,
  and `core/Agent.ts` · `resume` takes the typed-input path: `readAwaitingInput` →
  `applyInputResponse` (types and enums checked, nothing coerced; a partial answer pauses again at
  the door, with no model call). `hosting/standingAgent.ts` renders and resumes it like any
  `requestInput`.

**The resume** — `Ask`'s resume half, then the `Bind` decider (§ 3.2):

1. It accepts only the `requestId` it stamped.
2. It binds each field's value to every (call, argument) the field serves.
3. It re-checks each value against the property's own schema, through the rule re-read with the
   same resolver. A typed ask checks type and enum only, so an integer asked as a number can come
   back `2.5`, and a bounded number can come back out of bounds. A value that fails is **not bound**:
   the layer files `asked: 'invalid-answer'` and asks that field again, with a second fixed question
   ("One answer did not fit what the tool accepts. Please answer that field again."). The loop runs
   from `Bind` back to `Ask` — legal in footprintjs because `Ask` is declared before the decider —
   and a later stage may pause after a resume (`fp:test/lib/pause/resume.test.ts`,
   "second pause at review"). Step 4 pins a pause reached through that loop with its own test. At
   most three rounds per field (a named constant); after the third, the calls that needed the field
   are refused (§ 4.5). This is the architecture's "re-check at bind, pause again".
4. Each bound value files an `answered` row: `proposed` is the model's value it replaced, if any, in
   the shown view; `free: true` when the field was a string with no choices — the person gave a
   name, which is provenance and never support (the
   [honest-answer page](../2026-09-honest-answer-ledger.md)'s rule that only enum, number and
   boolean fields carry the prompt-injection guarantee, its § 5.1).
5. The layer completes. Route sends the completed batch to ToolCalls, which dispatches it through
   its normal path. **ToolCalls can still pause afterwards** — a tool's own `requestInput`, a
   check-in, a credential consent — because footprintjs lets a later stage pause after a resume.
   The per-call design had to refuse those, because a resumed dispatch has no second checkpoint.
6. **The evidence gate** learns the answers: `exemptFromRun` gains this turn's `answered` values,
   read from the rows. The person supplied them, and nothing else puts them in front of the gate:
   unlike a tool's own `requestInput`, whose answer lands as an `input_received` tool result, the
   library's ask writes no message. A value the tool's view hides cannot be exempted (the row holds
   the placeholder), so an answer that repeats it may be flagged — named, and left.

**A host that keeps its own state across pauses.** The host puts its routing step in the ask's
`context` and restores it on resume (`host:be-server/brain.ts` → `host:be-server/routing.ts` ·
`restoreInputPause`, which reads `awaitingInput.context.routing`). A library ask would lose it
(practitioner review). So `AgentOptions.argumentAskContext?: () => JsonObject` (name open) is called
when the ask is built, and its object is spread into `context` beside the reserved key; a value that
uses the reserved key, or is not JSON, is refused. The host's reader then works unchanged. A host
that prefers not to use the hook checkpoints its own state and recognises a library ask by the
reserved key.

**Cancel.** `hosting/standingAgent.ts` settles outstanding calls with `input_cancelled` and replies
with a fixed sentence. For a library ask there is no outstanding call — the batch's assistant turn
was never committed — so it writes only the reply. No chart runs, so nothing reaches the ledger and
nothing is served; the events already fired stay in the recording. Only a later reader of the
stored run can fold it as "ask" (architecture § 5.3).

**Readers that assume a pause came from ToolCalls** learn the reserved key in step 4, each with a
test: the paused-call guard in `stages/window.ts`, `lib/answer-account/facts/calls.ts` (which reads
`pausedToolCallId`), and the commentary templates that name the paused tool.

### 4.4 Pass and flag

A call that reaches "run" continues unchanged. Its rows carry whatever the fold reads: `model`,
`reading`, `setAside`, `default`, a failed claim.

### 4.5 Refuse

The call does not run. ToolCalls lands it in the argument-refusal shape the validation refusal
already uses (`error: true`, the `argsRejected` flag), so `tool_end`, `history` and `toolResults`
stay consistent, and the model reads one past-tense sentence:

| When | The model reads |
|---|---|
| a rule fails the dispatch re-read (a hand-built or provider tool) | "search_logs was not run on that call: its argument rule for window could not be read (<reason>)." Warned once, naming the tool. |
| three answers in a row failed the property's schema | "search_logs was not run on that call: the person's answers for window did not fit what the tool accepts (<rule>)." |
| ToolCalls meets a ruled tool while the layer is not mounted (a provider tool, on an agent built without the option, § 6) | "search_logs was not run on that call: it declares argument rules this agent was not built to apply." Warned once, naming the builder option. Fail-closed, because configured-and-inert looks exactly like configured-and-working (open question Q13). |
| inner dispatch (`core/agent/toolDispatch.ts` · `agentToolDispatch`) calls a ruled tool without every ruled argument | refused by name, like a `checkIn` or `wants` tool there. Inner calls file no rows: their values are the composing tool's code, and the outer call is the accounted unit. |

### 4.6 Where the results enter the call

ToolCalls reads `argumentResolutions` only when the run constant says the layer is armed, and applies
the entry for `tc.id` **after `tool_start`** (which keeps the model's proposal) and **before the
permission check**:

- the fill builds a fresh object, `{ ...args, ...fills }`, assigned to both `callArgs` and
  `chainedArgs`. It never edits `tc.args`, which is the assistant message's own object when
  `.findings()` is off (engineer NOTE);
- permission's `context` becomes the completed arguments, so policy judges the call that will
  really run and a person's answer can never slip past an argument policy (open question Q5);
- `changedArgKeys` then names every filled key on `tool_end`, by name only;
- check-in sees the completed arguments (`pausedCheckInArgs` carries them), and
  `core/checkin.ts` · `CheckInRequest.args`'s doc comment changes from "the arguments the model
  proposed" to "the arguments the call will run with" (step 3, in the change fragment);
- the repeated-call note fingerprints `callArgs`, as it does today;
- a refused entry lands as § 4.5 says.

**A before-tool middleware that rewrites a ruled argument afterwards** is recorded on
`middlewareDecisions` by name: `MiddlewareDecision` gains `changedKeys` (argument names only; the row
already carries `before` and `after`). The fold reads that value as assumed unless the middleware
declares where it came from (open question Q8). The layer never saw the rewritten value, and a
middleware default must not earn more standing than the same default declared as `assume`
(practitioner review). This replaces revision 1's "C0", which credited any rewrite to the app —
including a lower-casing of the model's own guess (devil's review).

### 4.7 Interactions

| With | What happens |
|---|---|
| Permission and capabilities | They run in ToolCalls, after the ask. A call permission then denies may have asked the person for nothing; its `answered` row stays and the call is denied as today (open question Q4). |
| Before-tool middleware | Runs after the layer (§ 4.6). Its own `ask` pauses in ToolCalls, after the layer's pause, which is allowed. |
| Check-in | Sees the completed arguments. A tool with both a check-in and an `ask` rule costs the person two round trips. |
| Credentials, `wants` | After the layer, unchanged. A `wants` argument cannot be ruled. |
| Several calls in one batch | One ask for all of them; nothing ran before it, so nothing is settled. |
| Wrap-up turn | Tools are withheld (`callLLM` · `EMPTY_TOOL_SCHEMAS`), so there are no calls and the layer returns at once. |
| Composed tools (`ctx.tools`) | Inner dispatch refuses a ruled tool unless every ruled argument is given (§ 4.5). |
| ToolProvider tools | Rules are read through the shared resolver at the layer and again at dispatch. The mount needs a rule the build can see, or the builder option (§ 6). |
| MCP client tools | Rules arrive in `_meta.agentfootprint` (§ 1.4) and are then ordinary tool fields. |
| `mcpServe` | Serves the author's schema with `required` intact. No gate there, and none is claimed. |
| `unsupported-argument` (the choice seam in `callLLM`) | Judges only the model's proposal. A filled default is never its subject. It shares `integrity/argumentLeaves.ts` with this layer but writes its own carrier, so one defect is never filed twice. |
| Contingent rows at dispatch | Unchanged, over data tokens. V3's `setAside` is the model-named twin; the fold keeps one `value-contingent` per value per call, with both rows as witnesses. |
| `tool_start` | Still carries the model's proposal. The fill shows on the row and in `changedArgKeys`. |
| `resumeOnError` | The layer's rows ride `AgentRunCheckpoint.findingsLedger` once merged, through the new door arm (§ 5.4). |
| The next turn (`continueFrom`) | The ledger does carry into the next turn (§ 5.2); the `turn` stamp keeps turns apart, and earlier `answered` rows stay readable by V4. |
| `solo` (declared-control page, capability 4) | When it ships, its whole-batch refusal is one exported predicate the layer asks too: a batch `solo` refuses is never asked about. |
| The explicit action (no-model hop draft) | An action pass jumps past CallLLM, so the layer never runs on it, and its values are the app's. That page must say what a missing ruled argument on an action does; this page recommends: `assume` fills through the same `arguments/resolve.ts` function, and a missing `ask` argument refuses the action. |
| Run facts `given` (declared-control page, capability 1) | Once built, a V5 source (§ 3.4). |

---

## 5. The record

### 5.1 The row

`arguments/rows.ts` owns the type, the builders and the well-formedness check. `findings/types.ts` ·
`FindingsRow` imports it. The shape is the architecture note's (§ 3.2 (h)); the lines marked
"this page" are the details that note left to this page (§ 10.1).

```ts
export interface ArgumentRow {
  readonly kind: 'argument';
  readonly turn: number;                  // AgentState.turnNumber when filed — the conversation turn
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly argument: string;              // top-level name — schema vocabulary, like toolName
  readonly rule?: 'ask' | 'assume';       // absent = free (a row only because `from` named it)
  readonly period?: true;                 // the argument Tool.period names
  readonly source?: 'said' | 'answered' | 'result' | 'app' | 'default' | 'model'; // absent only on an asked row
  readonly asked?: 'missing' | 'unverified' | 'invalid-answer';   // 'invalid-answer': this page (§ 4.3)
  readonly value?: string;                // shownArgsOf(tool, args)[argument], clipped; 'REDACTED' when hidden
  readonly proposed?: string;             // the model's own value, same view: on an answered row, the one the answer
                                          // replaced; on a V1 default row, the one the model sent (absent = filled)
  readonly claimed?: 'user' | 'result' | 'turn' | 'app' | 'assumed' | 'none'; // absent = sources unarmed
  readonly matched?: 'quote' | 'phrase' | 'spelling';               // 'spelling': this page (§ 3.5 V4)
  readonly quote?: string;                // as the model wrote it, clipped; 'REDACTED' with its argument
  readonly reading?: true;
  readonly earlier?: true;                // the carrying message or answer is from an earlier turn
  readonly result?: string;               // the result id claimed and found
  readonly setAside?: 'open' | 'noise' | 'ruled-out';
  readonly argumentsFrom?: 'listed' | 'unlisted';                   // this page (§ 3.5 V3)
  readonly appSource?: string;            // the ExternalGround label, or given.<key>
  readonly free?: true;                   // answered through a free-text field: a name, not a choice
  readonly coincides?: 'person' | 'result' | 'app';                 // the library's own lookup: a hint, never a source
  readonly malformed?: number;            // this page (§ 2.2): dropped `from` entries, when no basis row carries them
  readonly failed?:
    | 'quote-not-found' | 'composed-message'                        // 'composed-message': this page (§ 3.5 V2)
    | 'unknown-result' | 'placed-result' | 'not-in-result'
    | 'no-earlier-turn' | 'not-in-earlier-turns' | 'only-in-model-answer'
    | 'not-in-app-text' | 'uncheckable';
}
```

- **Redaction goes through the tool's own argument view** (devil's review, a MUST-FIX). An agent's
  executor set no state-level redaction policy when this was written — only
  `core/flowchartAsTool.ts` and `core/runbook/runbookAsTool.ts` set one, on their inner executors;
  an agent takes one since `Agent.create({ redact })` (`src/redaction/`), and the view still
  applies on top of it — and `core/Agent.ts` ·
  `findings` hands out the committed ledger as a clone. So `value`, `proposed` and `quote` are built
  from `core/toolShownArgs.ts` · `shownArgsOf` ("what an event may say this call ran with"): a key
  the view hides reads `'REDACTED'`, and a quote is hidden whenever its argument is. The checks run
  on the raw value in memory; the raw value is never stored on a row, never put on an event, and
  never handed out by `agent.findings()`, the checkpoint door or the lens.
- **The one raw carrier is working state.** `argumentResolutions` holds the raw filled and answered
  values, because the call must run with them. It is the same class as `pausedToolArgs` and the
  assistant message's own arguments: committed run state, which a full recording of the run
  (`recordRun`) carries exactly as it carries those — never a row, an event or a lens view. A tool
  that must keep a value out of recordings too needs a redaction policy on the run — the gap this
  layer named is closed by `Agent.create({ redact })`: `conversationRedaction()` names
  `argumentResolutions`, `argumentAsk` and `argumentAnswersKept`, so every record holds the
  placeholder while the call still runs with the real values.
- **Clipping.** `value` and `proposed` through `integrity/argumentLeaves.ts` · `clipValue` (80
  characters); `quote` at `findings/types.ts` · `PROPOSITION_CHARS` (240).
- **Current row.** The fold takes the last row per (turn, toolCallId, argument), keyed by a map of
  maps — never a joined string key (the injective-key law). An `answered` row supersedes the
  `asked` row before it.

**Provenance tiers** (honest-answer page § 5.1): `answered` → answered; `result` → observed;
`app` → given; `default` → given, but never support, because an app default is a choice nobody in
the conversation made; `model` → judged. **`said`** is `claimed` text that a library check tied to
a value, in one ordered lattice, `claimed` ⊑ `said` ⊑ `answered` (research review; open question
Q7).

### 5.2 When rows are written — once per batch, stamped with the turn

- **Three moments, one merge.** The Record stage stages a batch's rows before any pause; the resume
  stages the `answered` and `invalid-answer` rows; when the layer completes, the mount's output
  mapper merges all of them into the ledger with one call:
  `appendRows(parent.findingsLedger, rows)` under `arrayMerge: Replace`. One committed copy per
  layer run — never a write per call (devil's review: this is the first program that files rows
  without the model's help, one per ruled argument per call).
- **The writer split.** `findings/ledger.ts` · `recordFindings` splits into its two halves, one
  owner each: `appendRows(prev, rows)`, the pure merge plus any new conflict rows, and the emit half
  (`emitRow`). `recordFindings` keeps both for its in-stage callers (ToolCalls, Route). The layer's
  Record stage emits inside the subflow; the mapper only merges. Argument rows never enter
  `conflictsOf` (only `fact` standings do), so the merge adds no conflict.
- **The cost, measured before it is claimed.** Each merge still copies the whole ledger and commits
  the whole array (`fp:src/lib/engine/handlers/SubflowInputMapper.ts` · `applyOutputMapping` sets a
  top-level array whole). Step 3 measures commit-log bytes over a 50-iteration run with a ruled tool
  and the merge at 1,000 rows. An append-only merge through footprintjs's `append` verb is a
  separate, measured footprintjs change, taken only if those numbers ask for it.
- **The ledger crosses turns** (engineer review, a MUST-FIX; revision 1 said the opposite).
  `core/Agent.ts` · `checkpoint` puts it on the conversation checkpoint, the continue path stashes
  it, and `stages/seed.ts` restores it. `iteration` restarts at 1 every run, so without a stamp a
  turn-1 `default` row would make a turn-2 answer that never called the tool read "not sure". So
  every row this layer files carries `turn` = `AgentState.turnNumber`, which seed derives from the
  conversation (`stages/seed.ts` · `countUserTurns`, raised by `anchorTurnNumber` from the memory
  stores: a floor that may skip a number and never collides). The fold reads only this turn's rows;
  V4 reads earlier turns' `answered` rows on purpose.

### 5.3 The event

`agentfootprint.findings.argument`, added to `events/registry.ts` · `EVENT_NAMES.findings` (key
`argument`, beside `declared`, `standing`, `judged`, `judge_failed`, `contingent`) with its payload
type in `events/payloads.ts`, emitted once per row by the Record stage and by the resume:

- **Carries** `{ toolCallId, toolName, iteration, turn, argument, rule?, period?, source?, asked?,
  claimed?, matched?, reading?, earlier?, setAside?, argumentsFrom?, coincides?, free?, failed?,
  malformed?, valueChars? }` — names, enums and counts.
- **Never carries** a value, a quote or a proposal, and carries no `valueChars` when the tool's view
  hides the argument (the length of a hidden value is itself a leak).
- A host counts "1 assumed" or "1 asked" from these events, the way it counts coverage today
  (`host:be-server/coverageMark.ts`). The fold never reads events (§ 5.5).

### 5.4 The checkpoint door, the restore, and who reads the rows

- **Door.** `core/runCheckpoint.ts` · `ledgerRowIsWellFormed` gains `case 'argument'` in the same
  change: identity strings (`toolCallId`, `toolName`, `argument`), numeric `iteration` and `turn`,
  either a `source` or an `asked` in its vocabulary, and every enum field checked. It accepts `turn`
  on every kind. The judge rows were refused until 9.110.0 — the precedent for never shipping a row
  kind before its door arm. An older runtime refuses a checkpoint that carries the new kind; the
  change fragment names it.
- **Restore.** The restore accessor (`stages/seed.ts` · `SeedStageDeps.consumePendingResumeFindingsLedger`)
  is wired today only inside `core/Agent.ts`'s `.findings()` spread, so rows written by an agent
  without `.findings()` would be dropped on a continued conversation. It is wired whenever any layer
  is armed, still value-conditional (only when the checkpoint carries rows).
- **Public surfaces that widen.** `FindingsRow` gains a member, which breaks consumers that switch
  over every kind; `agent.findings()` starts returning rows on agents without `.findings()`. Both go
  in the change fragment, and both READMEs say readers must skip unknown kinds (the lens already
  does: `FindingsBand.tsx`, `ProofMap.tsx`).

### 5.5 What the standing fold reads

The fold (`assessment/assess.ts` · `assessAnswer`, architecture § 4.2) is pure and reads committed
rows of this turn only. From this layer it reads the current row per (call, argument), for calls
that reached the layer:

| Current row | Reason | The person reads (versioned template) |
|---|---|---|
| `default` | `argument-assumed` | Not sure — window = "2h" was assumed (the tool's rule); you did not give it. |
| `model` on a ruled or period argument (undeclared, `assumed`, a hint only) | `argument-unverified` | Not sure — window = "2h" came from the model; the record does not show you gave it. |
| any row with `failed`, on any argument | `argument-unverified` | the same, naming the check: "the quoted words are not in your messages". The model misstated the record. |
| `said` + `reading` (reached only where no ask fired) | `argument-read` | Not sure — "over the last week" was read as window = "7d". |
| `result` + `setAside` | `value-contingent` | Not sure — host = "srv-4417" came from a result the model set aside. |
| an `asked` row with no later `answered` row, at the end of the turn | **ask** · `argument-asked` | the ask itself is the reply (read from the paused run's checkpoint, never from an event) |
| a before-tool rewrite of a ruled argument with no declared origin (`MiddlewareDecision.changedKeys`) | `argument-assumed` | Not sure — window was set by the middleware "<its name>"; where the value came from was not declared. |
| `said` via quote or phrase, `answered`, `result` without `setAside`, `app` | no reason | — never support: a membership pass keeps a reason from firing and nothing more |

A `period: true` row joins the results layer's period verdict for the same call (step 7b). An
unarmed check is not a reason; it is simply absent from the printed `checked` list, which shows
"argument sources" only when this layer ran (architecture § 4.2, rule 3).

### 5.6 What the lens and the host show

- **Per call, one chip per argument:** the value (in the shown view), its source, and the check
  behind it.
- **On the ProofMap, an edge from the value to its source:** the quoted words in the person's
  message, the result node, the app, or a "default" node.
- **The ask as the reply.**
- A role-hidden tool's rows follow Lens law 1: they may be left out, never denied.
- **The host's non-append path** is first-class: counts from the event, the rows from
  `agent.findings()`, and from step 6 the standing's field on the run's result.

---

## 6. Arming — and byte identity when nothing is declared

| Arm | Switches on | Byte cost when absent |
|---|---|---|
| A tool the build can see declares `askOrAssume` (a registered tool, a skill-carried tool, an MCP tool registered on the builder) | The layer's mount; for that tool: the schema decoration, the checks, fill, ask, rows, notes and the event; the widened restore; the `turn` stamp; the "Assumed" line under an existing `.limitsTravelWithTheAnswer()`; the gate's exempt defaults and answers. The chart builder harvests the rules at build (the `toolGrounding` harvest precedent) and seeds one run constant (`honesty/armed.ts`, the `findingsServe` precedent). | none |
| `.inputsLayer()` on the builder (name open) | The mount, for an agent whose ruled tools arrive only through a ToolProvider, which the build cannot see. Without it, ToolCalls refuses such a tool rather than run it unruled (§ 4.5). | none |
| A tool declares `period` | `period: true` on that argument's rows; the shared period field and the spelling match (§ 1.2); the results layer's verdict (step 7b). `period` without a rule is refused, so it never arms anything alone (Q19). | none |
| `.findings({ argumentSources: true })` | The `from` property on ruled tools, the instruction line, V2–V5, the standings projection and the earlier-answers read, and the unverified → ask cell. Refused without `.findings()`. | none |

**When nothing is declared** — no tool declares a rule, no builder option, the sources arm off —
nothing mounts, nothing is decorated, no key is read or written, no event fires and no framework
field appears. Every existing run commits and serves the bytes it always did. These 21 references in
`test/core/tools/reference/` must not move (counted on 2026-09-26):

`agent-dynamic-graph-hop` · `agent-dynamic-static-tool` · `agent-findings-contingent` ·
`agent-findings-judge` · `agent-findings-window` · `agent-findings` · `agent-from-active-skill` ·
`agent-grouped-graph-hop` · `agent-grouped-static-tool` · `agent-message-api-chart-one-turn` ·
`agent-ontology` · `agent-parked-map` · `agent-provider-three-sources` · `agent-scoped-provider` ·
`agent-shared-tool-reference` · `agent-stepped-skill` · `agent-tool-choice` · `agent-tool-forced` ·
`agent-wrap-up` · `llmcall` · `message-api-chart`

**New references**, one per armed shape: `agent-arguments-assume` (step 3); `agent-arguments-assume-limits`
(step 3 — an agent with `.limitsTravelWithTheAnswer()` armed, which none of the 21 does);
`agent-arguments-ask` (step 4, both epochs — the paused run and the resumed one);
`agent-arguments-sources` (step 5).

**Reads stay value-conditional** (architecture law 9: a layer reads a key only when a run constant
says the key can exist). ToolCalls reads `argumentResolutions` only when the layer is armed.
PrepareFinal reads argument rows only when the limits block AND this layer are armed; Route only
when the evidence gate AND this layer are armed. The mount reads the ledger only under the sources
arm, which requires `.findings()` — the arm under which ToolCalls already reads that key. A tracked
read of a key a run never writes is a phantom context source (`core/agent/window/evictedTurns.ts`,
header).

**Lazy load.** `arguments/` loads through `import()` when armed — the optional-family law
`findings/peel.ts` states — so a plain agent's bundle and the docs site budget do not grow. The site
budget is measured after the last code change, because a new export adds API-reference routes.

---

## 7. Benchmark first — and what it lets you measure

### 7.1 The bench (step 2 — before any layer code)

The architecture note's protocol (§ 6.1), applied to this layer:

- **Provoking cases.**
  - *P1 — no stated period* on a tool whose default nobody chose ("any errors on checkout?" with a
    silent `2h`).
  - *P2 — a period said in words* ("over the last week", "since yesterday").
  - *P3 — a name the person never said* (a service or host the model invents or half-remembers).
  - *P4 — a value only an earlier turn settled* (the person answered it last turn).
  - *P5 — a value only an earlier result carried* (a host id listed by a lookup).
  - *P6 — one period, two tool families* (a question that needs `24h` and `-24h`).
  - *P7 — a composed run* (a reflection whose critic calls a ruled tool).
- **Controls**, where the layer should change nothing: the person gave the value exactly in the
  tool's spelling; the question needs no ruled tool.
- **The baseline** is the unarmed agent — the tool's silent default — on the same cases, the same
  day, interleaved, on a freshly loaded seed, with verdicts from blind hand labels only (the host
  bench's own rules since the [decisions memo](../2026-09-honest-answer-ledger-decisions.md) § 8.3).
- **The success rule is registered before the first paid call**, by the owner. A draft to register:
  step 3 moves most P1 answers from "consistent with the record" to "not sure" with the assumption
  named; step 4's needless asks on the controls stay within a non-inferiority margin set in
  advance; facts in the answer do not fall. The numbers are the owner's to set — none is claimed
  here.
- **Haiku 4.5 only**, inside a budget the owner approves per run. Every cost is an estimate until
  the run's own record says otherwise.
- **Measured nulls to respect.** The served findings piece showed no benefit at ten runs and cost
  fact fidelity (facts-in-answer fell from 1.000 to 0.917,
  [2026-09-findings-ledger-worklog.md](../2026-09-findings-ledger-worklog.md)); Haiku declared about
  half the time ([2026-09-findings-ledger-real-model.md](../2026-09-findings-ledger-real-model.md)). So the
  sources arm (step 5) is measured for what it costs — tokens per call, fact fidelity, needless
  asks from misquotes — as well as for what it catches, under a tokens-per-call ceiling set before
  the run.
- **Kept only on a gain.** A null is recorded as a null, and the arm stays opt-in or is withdrawn.

### 7.2 What it lets you measure — from the record alone

Per model, and per prompt or skill version, with no second model and no reading of prose:

| Metric | Read from |
|---|---|
| **assumed-value rate** — calls that ran on a default nobody chose | `default` rows over ruled-argument rows |
| **echoed-default rate** — the model sent the default itself | `default` rows that carry `proposed` (a filled default has none) |
| **ask rate**, and **needless-ask rate** — asked for what the person had given | `asked` rows; blind labels on the bench cases |
| **declared-source rate** | rows with `claimed` other than `none` |
| **verified rate** — a copying measure, not an honesty measure (architecture § 1.1) | verified sources over declared ones |
| **failed-claim mix** | the `failed` values |
| **reading rate** — values the model read into the person's words | `said` + `reading` |
| **hint rate**, split at `MIN_CHECKED_LENGTH` | `coincides` |
| **contingent uses** — values from results the model set aside | `setAside` |
| **composed-run exposure** | `failed: 'composed-message'` |
| **tokens per call** that the served sentences and `from` cost | the request receipts |

Read together, these are the layer's part of a per-model **honesty profile**: the same rows in the
bench, the paper and the lens, comparable across models and prompt versions. **The limit:** it
measures claims within evidence, not truth. A value the person really gave, used wrongly, passes.

**For the paper**, this layer is a Future Plans claim with planted defects (architecture § 6.3):
*questions that leave out the period, on a tool that defaults to 2h — arming the layer moves those
answers from "consistent with the record" to "not sure" or "ask", without raising needless asks on
the controls.* The study's evidence is for layer 3; no served honesty arm is on in any study arm.

---

## 8. Tests — seven types per step

Every step also passes the architecture note's gates: the 21 references unchanged when nothing is
declared, plus its own new reference; every new sentence registered in
`test/modelFacingSurfaces.test.ts`; `test/architecture/folderRoles.test.ts` (the `arguments/`
README opens with its role word, Mixed) and `test/architecture/citations.test.ts` (every
`file · symbol` in the READMEs resolves); a `ledgerRowIsWellFormed` arm for the new kind.

**Docs with every step** (the architecture note's checklist): this page (placed by step 0 at
`docs/design/honesty/inputs.md`) is kept current; `src/core/agent/arguments/README.md` opens with its role word,
states the law in one sentence — *No argument runs unaccounted for.* — and carries the seven-clause
table with checked pointers, one runnable example (`examples/features/NN-ask-or-assume.ts`, name
open), a "Not covered" section and "What it lets you measure"; one CAPABILITIES row with Since
`unreleased`; a `.changes` fragment naming the widened surfaces (§ 5.4); the feature pages
`docs-next/content/docs/build/tools.mdx` (step 3) and `build/input-requests.mdx` (step 4); then
`npm run docs:regen`.

### Step 3 — assume, MCP carriage, the subflow, the row

| Type | Tests |
|---|---|
| Unit | every refusal of `assertAskOrAssume` (§ 1.3), each naming the tool and the argument; the `assume` value judged against the property's own schema, so the § 1.1 example is accepted despite its root `required`; `isMissing` on absent, `undefined`, `null`, `''` and `'  '`; `rulesOf` refusing a hand-built rule; `readToolExtras` dropping a malformed `askOrAssume` with one warning while the tool still registers; the note sentences; `appendRows` is pure and adds no conflict for argument rows; the row builders under a hiding view. |
| Functional | a ruled tool called without `window`: filled, `default` row, the note on the result, `changedArgKeys` names `window`, `tool_start` keeps the proposal, permission sees the completed arguments; a model that sends the default itself files `default` (V1). |
| Integration | MCP round trip: `mcpServe` → `mcpClient` → the fill, with a Python-shaped `_meta` bag; the "Assumed" line under `.limitsTravelWithTheAnswer()`; a continued conversation whose second turn never calls the ruled tool folds without turn 1's `default` row (the `turn` stamp); an agent without `.findings()` keeps its rows across `continueFrom` (the widened restore); a provider-only ruled tool without the builder option is refused with the warning. |
| Property | fast-check over property schemas and values: a value the property schema accepts is accepted at definition, and the filled call passes `validateToolArgs`; the decoration is a pure function of (schema, rule), so `servedView.viewOf` rebuilds the committed list byte for byte. |
| Security | a tool whose `SHOWN_ARGS` view hides a ruled argument: the ledger, the checkpoint and every event carry no raw bytes and no `valueChars`; **laundering**: the next call declares `{ argument: 'window', source: 'result', id: <the filled call> }` and must file `not-in-result`, because "2h" sits only in the library's note behind the tool-bytes boundary; the evidence gate does not ground "2h" from the note either. |
| Performance | commit-log bytes over a 50-iteration run with a ruled tool, armed against unarmed; the per-iteration cost of the mount; `appendRows` at 1,000 rows. Numbers are recorded, not claimed in advance. |
| Load | a 200-call batch over ruled tools: exactly one ledger merge per layer run (counted in the commit log), never one per call. |

### Step 4 — the batch ask for missing values

| Type | Tests |
|---|---|
| Unit | `argumentAskDeclaration` always passes `validateInputDeclaration`; the fixed question; positional field ids; `context` within 16384 characters and carrying no model value; the hook's object refused when it uses the reserved key; two period arguments share a field only when every converted choice is valid for both; an `iso-range` period never merges. |
| Functional | two calls in one batch missing `window`: one ask, one field, both calls bound and run; `answered` rows and notes; a string field with no choices files `free: true`. |
| Integration | cross-executor resume from a serialized checkpoint; the hosted path — render, answer, cancel (the cancel writes only the fixed reply and no orphan result); after the ask, a tool's own `requestInput` pauses again and resumes; a check-in after the ask; the readers of `pausedToolCallId` (`stages/window.ts`, the answer account, the commentary) with a library ask pending. |
| Property | for every answer inside the declared choices, the call runs with it and its row is `answered`; a partial answer re-pauses at the door with no model call; an integer field answered `2.5` is asked again and never bound, and the third invalid answer refuses the call. |
| Security | over any model output, the ask carries none of the model's values or choices; a `context` hook cannot overwrite the reserved key; answered values of a hidden argument appear on no row, no event, no served note and no ask `context`. |
| Performance | the resume adds no model call; the ask's build time over 32 fields. |
| Load | a batch that needs 40 fields asks in two rounds, and binds all 40. |

### Step 5 — declared sources

| Type | Tests |
|---|---|
| Unit | `readSources`: each malformed shape dropped and counted; a `from`-only `_findings` readable under the arm and ignored unarmed (byte-identical); the count lands on the basis row, or on the first argument row when there is none; each check's verdicts (V2–V6); the per-result function against the evidence index on the same results (parity); compact JSON — `{"limit":50,"ok":true}` finds `50` and `true`, and a number inside a nested array is found. |
| Functional | under the arm, an unverified value on an `ask` argument asks, and a verified quote runs; a declared phrase makes "over the last week" check out as `7d`. |
| Integration | `reflection()` wrapping an agent with a ruled tool files `composed-message`; a period answered in turn 1 as `24h` traces in turn 2 to a `-24h` argument (`matched: 'spelling'`); a `turn` claim with no earlier answer files a hint, not a source. |
| Property | for every quote q and value v not in q, with no phrase for v declared in q, an `ask` rule never runs the call without asking; every primitive leaf of `JSON.stringify(x)` is found in the result it came from. |
| Security (adversarial) | a quote found only in a library frame or a library note; the value only in a different result than the one named; a set-aside result; an evicted turn; a negation ("not the last 24h — the whole week"), which passes membership and is asserted never to count as support; a full-width quote, which files `uncheckable`; a middleware rewrite after the layer, which the fold reads as assumed. |
| Performance | tokens per call that `from` and the instruction line add, against the ceiling set before the bench; the checks' cost per batch. |
| Load | 50 calls × 5 ruled arguments, each with a `from` entry. |

---

## 9. Considered and rejected

| Proposal | Where from | Why not |
|---|---|---|
| The check inside ToolCalls' per-call loop, after permission and middleware | revision 1 | The owner's framing: a subflow before Route, once per batch. Its cost — the ask precedes permission — is stated and put to the owner (Q4). |
| One ask per call, with the batch's later calls settled on resume | revision 1 | One ask per batch, before anything runs: nothing to settle, and ToolCalls can still pause afterwards. |
| "C0": any value a middleware set is the app's | revision 1 | A normalising middleware would turn the model's guess into the app's value (devil's review), and a middleware default would outrank the same default declared as `assume` (practitioner review). The layer checks the model's value before middleware; a rewrite reads as assumed unless its origin is declared. |
| "C6": a value the library finds in the person's words becomes `said` | revision 1 | "We have 7 hosts" would have "said" `days: 7`. A library lookup is a hint (`coincides`), never a source. |
| A reading (`said`, value not in the quote) runs under an `ask` rule | revision 1 | Any exact fragment of the person's message would carry any value past the ask (devil's review). Under sources it asks; declared phrases make real paraphrases check out. |
| `tokenize` over the raw result string | revision 1 | Compact JSON glues `:` to numbers and booleans (`:50`, `:true`): a false `not-in-result` on every one. The evidence index's own per-result reading instead. |
| A second result haystack built beside the evidence index | revision 1 | The index is the one owner of "the values a run can prove it read"; this layer uses its per-result reading, exposed as one function. |
| An `answeredByPerson` stamp on tool messages | revision 1 | Its stamp on the existing `pauseHere` branch had no arm, so it changed history bytes for every `requestInput` run; and a marker on a history message does not survive compaction. The `answered` row, stamped with its `turn`, rides the ledger across turns instead, and the library's ask writes no message at all. |
| A note that names the argument without its value, so no value can launder | engineer review, second option | The model needs the value to reason ("no errors in 2h"). The haystack stops at the tool's own bytes instead. |
| Judging an `assume` value with `validateToolArgs` on `{ [arg]: value }` | revision 1 | It enforces the root `required` and refused the page's own example. The property's own schema instead. |
| The authors' questions joined into the ask's question | revision 1 | Two long questions pass definition and fail the 4096-character bound at pause time. A fixed library question; each author's question is its field's description. |
| `whenMissing` as the name | revision 1 | `ask` also fires on a present value once sources are armed. |
| A `turn` claim resolved by a library search of earlier person words, results and app text | the architecture note's wording | A search the library runs on its own is a hint under law 2; a quote or an id checks the same fact. `turn` resolves to earlier answers only (§ 10.1, R1). |
| NFKC or another normaliser inside the layer | revision 1 | Two definitions of "the same value" drift. Unicode folding, if wanted, goes into `evidence/normalize.ts` for the gate and the layer together. |
| Widening `InputField.type` with `integer` so the door rejects `2.5` | considered for this page | A public type change every host renderer would have to learn, and it covers only one constraint. The re-check at bind covers bounds and patterns too. |
| Re-asking an invalid answer through the model (refuse, let the model re-propose) | considered for this page | A model call for a typing mistake, and the model may paraphrase the question. The layer asks the field again itself. |
| Mounting the layer whenever the agent has a ToolProvider | considered for this page | Every provider-using agent's chart would change, including the provider references among the 21. A build-visible rule or one builder option arms it; an unmounted ruled tool is refused, never run unruled. |
| Refusing `ask` unless sources are armed | practitioner review | The ask for a MISSING value needs no source check and is safe to ship first; only the ask for an UNVERIFIED value waits for sources. |
| The layer as a Route branch that loops back to Route | the literal "between Route and ToolCalls" | footprintjs refuses a branch loop to anything not declared before the decider (`DeciderList._applyBranchLoop`), and Route would run twice per batch and double its events. |
| ToolCalls moved into a subflow behind the layer | a way to sit right before ToolCalls | Armed runs would move ToolCalls' stage path under a subflow prefix and break every matcher keyed on the bare `tool-calls` id (agentfootprint CLAUDE.md, landmine 3). |
| Parsing the person's time phrases | — | The library never interprets free text. Authors declare phrases; anything else is a reading. |
| Nested or array arguments in v1 | — | The typed ask holds flat primitives only (`core/inputRequest.ts` · `InputField`), like MCP elicitation. |

---

## 10. Open questions for the owner

**Answered 2026-09-27.** Each question below took its recommended answer (adopted overnight on the
owner's go; the owner may overturn). [decisions.md](decisions.md) records them: Q2–Q12 keep their
numbers there, this page's Q13–Q18 are decisions.md Q14–Q19, and Q19 is decisions.md Q13. The
questions stay here as they were put.

Numbers match the architecture note's § 10 where the question is the same; this page's own start at
13.

- **Q2. Before declared sources exist**, a present but unverified value on an `ask` argument: flag
  it and run (this page, § 4.1), or ask (decision (b) read literally, at the cost of asking on
  nearly every call)?
- **Q4. The ask comes before permission.** Accept that a call permission later denies may have
  asked the person, or have the layer consult the permission checker first (a second policy call
  per ruled call)?
- **Q5. Filled values enter the call before permission**, so policy judges the call that will run.
  This bends the written law "policy must see every attempted call": it sees the completed attempt.
- **Q7. The tier `said`**, defined as `claimed` text that a library check tied to a value, in one
  lattice: `claimed` ⊑ `said` ⊑ `answered`.
- **Q8. A middleware that rewrites a ruled argument** reads as assumed unless it declares where the
  value came from. Add a typed origin to `allow(args, why, { from: { window: 'person' | 'default' |
  'app' } })`, or not? The host needs it for its absolute windows (§ 1.5).
- **Q9. Composed runs.** Which runners mark their runs (the patterns and the core-flow composers,
  this page proposes), and the marker's name.
- **Q10. Names, all open:** `askOrAssume` (`ask`, `assume`, `choices`, `said`); `ToolPeriod`
  (`argument`, `spelling`, and `lookback` · `signed-lookback` · `iso-range`); `_findings.from`
  (`user`, `result`, `turn`, `app`, `assumed`); `.findings({ argumentSources })`; `.inputsLayer()`;
  `argumentAskContext`; `argumentResolutions`; the tool-bytes field `toolChars`; the subflow id
  `sf-inputs`; `agentfootprint.findings.argument`; `resultCarries`.
- **Q12. Budgets:** the Haiku budget for the step-2, step-4 and step-5 benches.
- **Q13. A ruled tool met while the layer is not mounted:** refuse it (this page, fail-closed) or
  warn and run it unruled?
- **Q14. The app corpus** includes memory recall and retrieval passages (the evidence gate's stated
  reach). Keep them as app text for an `app` claim, or leave them out of this layer?
- **Q15. Other library suffixes** on messages the layer did not annotate (a step banner, an effect
  note, the repeated-call note): read as today (this page), or, while the layer is armed, stamp the
  tool-bytes boundary on every message a suffix joined? The second is stricter and changes what the
  evidence gate reads on armed runs.
- **Q16. The re-ask bound:** three rounds per field before the calls that needed it are refused.
- **Q17. A `from` entry on a free argument:** checked and filed in v1 (this page), or ignored until
  a later opt-in, to keep rows to ruled arguments only?
- **Q18. The explicit action** (no-model hop draft): this page recommends that `assume` fills
  through the same function and a missing `ask` argument refuses the action. It is decided on that
  page, once it is sound.
- **Q19. A `ToolPeriod` on an argument with no rule** (added by the consistency pass; the same
  number in the architecture note): refused today (§ 1.3), so only a tool that rules its period
  argument gets the results layer's `period-undeclared` check ([results.md](results.md) § 3.5). Keep the
  refusal in v1, or allow a period on a free argument?

### 10.1 Refinements to the architecture note — each needs a yes

**Adopted 2026-09-27:** all thirteen, R8's step included ([decisions.md](decisions.md) Q20–Q32).

| # | Refinement | Where the note stands | Why |
|---|---|---|---|
| R1 | A `turn` claim resolves only to an earlier `answered` row; other hits in earlier turns are hints | § 3.2 (c) lets it resolve to `said`, `result` or `app` by search | The note's own law 2: a library search is a hint. A quote or an id checks the same fact (§ 3.5 V4). |
| R2 | A present value equal to the declared default, not verified as the person's, files `default` | not covered | A model echoing the default, and a default laundered through `app` or `result` (practitioner reviews) |
| R3 | In a marked composed run, a quote from the run's own message files `failed: 'composed-message'` | law 3 says such a quote is "filed as `judged`" | The row's `model` source is the judged tier; the failed check says why. |
| R4 | `asked: 'invalid-answer'` and the re-ask loop inside the layer | the appendix: "re-check at bind, pause again" | The mechanism, bounded (§ 4.3). |
| R5 | `matched: 'spelling'` for an earlier answer matched through a declared spelling | § 3.3 carries one period across a batch | The same conversion across turns (§ 3.5 V4). |
| R6 | Row fields `malformed` and `argumentsFrom` | the appendix left both to this page | § 2.2; § 3.5 V3 |
| R7 | `argumentResolutions`: one entry per call, fills and a refusal | "the fills, as an array of `{ toolCallId, argument, value, source }`" | A refused call needs the same carrier (§ 3.1, § 4.5). |
| R8 | `Tool.period` ships with step 3 | was: step table under 7b, § 3.2 (a) carried over MCP in step 3. The consistency pass of 2026-09-26 wrote step 3 into the architecture note and the results page (7b now needs 1 and 3), because the note disagreed with itself; still yours to confirm | The rows' `period` flag and the ask's shared field need it before 7b. |
| R9 | Answered values join the evidence gate's exempt corpus (step 4) | only declared defaults (step 3) | The library's ask writes no message, so nothing else puts the person's answer in front of the gate (§ 4.3). |
| R10 | The standings projection includes this batch's own `previous[]` standings, in memory | "a projection of the standings for the results it names" | Parity with the contingent law at dispatch (§ 3.1). |
| R11 | Rules the build cannot see need `.inputsLayer()`; ToolCalls refuses an unmounted ruled tool | the arm is "a tool declares `askOrAssume`" | The chart is built once; a provider's tools are not known then (§ 6, Q13). |
| R12 | `McpToolExtrasOrigin` gains the listed tool's `inputSchema` | not covered | The first extras judged against the schema (§ 1.4). |
| R13 | Route's dispatch test becomes one exported pure predicate over five values, called by `decideBranch` | "`decideBranch` is exported as the one owner" | The layer runs in its own isolated scope and cannot hand Route's scope to `decideBranch` (§ 3.1). |

---

## Appendix — the review, finding by finding

Every finding the four-lens review raised about this page (doc "arguments" or "both"), with its
verdict. "Verified" means its evidence was re-read in the code on 2026-09-26.

| Finding | Severity | Verdict | Where |
|---|---|---|---|
| engineer: the ledger carries into the next turn; rows have no turn | MUST | verified (`checkpoint` → continue → seed restore); applied: the `turn` stamp | § 5.2 |
| engineer: library notes launder a default into `result` | MUST | verified (the committed tool message holds the suffixes); applied: the tool-bytes boundary | § 3.4; § 8 |
| engineer: `answeredByPerson` changes history bytes | MUST | resolved by dropping the stamp — answers are ledger rows, and the library's ask writes no message | § 9; § 5.2 |
| engineer: the `assume` check enforces the root `required` | MUST | verified (`validateToolArgs`); applied: the property's own schema | § 1.3 |
| engineer: a coincidental match becomes `said` | SHOULD | applied: `coincides`, a hint | § 3.5 V6 |
| engineer: served sentences promise outcomes | SHOULD | applied | § 2.3 |
| engineer: a `from`-only `_findings` is lost; its malformed count has no row | SHOULD | verified (`readDeclaration`'s `readable`); applied | § 2.2 |
| engineer: `commitWire` sees schemas only | SHOULD | verified (`mergeWire` returns name → party); applied | § 2.3 |
| engineer: a joined ask question can pass 4096 characters | SHOULD | applied: a fixed question | § 4.3 |
| engineer: one pause per resume covers more than check-in | SHOULD | verified in footprintjs; resolved by the placement | § 4.3 (5) |
| engineer: `given`, the explicit action and `solo` are not placed | SHOULD | applied | § 3.4; § 4.7 |
| engineer: a fill must update `chainedArgs` with a fresh object | NOTE | applied | § 4.6 |
| engineer: record whether the cited result's tool is in `argumentsFrom` | NOTE | applied: a flag | § 3.5 V3 |
| engineer: a host cancel runs no fold | NOTE | verified (`hosting/standingAgent.ts`); applied | § 4.3 |
| engineer: "seven frames" | NOTE | verified (six prefixes plus `injectedBy`); cited without a count | § 3.4 |
| engineer: two doc comments change meaning | NOTE | applied | § 4.6; § 5.4 |
| devil: any quote fragment passes the ask | MUST | applied: a reading asks; declared phrases | § 3.5 V2; § 4.1 |
| devil: `tokenize` over compact JSON never finds numbers or booleans | MUST | verified by running it; applied: the evidence index's per-result reading | § 3.3 |
| devil: raw values bypass the argument view | MUST | verified (no agent-level redaction policy then — `Agent.create({ redact })` now; `findings()` clones); applied | § 5.1 |
| devil: the ask fires too often; answers get evicted | SHOULD | applied: unarmed flags; answers on the ledger; the needless-ask bench | § 4.1; § 3.4; § 7.1 |
| devil: the quote check is too strict | SHOULD | partly: the hint survives a failed claim; falling back to a source rejected | § 3.5; § 9 |
| devil: a middleware turns a guess into `app` | SHOULD | applied: checked before middleware; a rewrite reads as assumed | § 4.6 |
| devil: composed patterns write the "person's" message | SHOULD | verified (`reflection`); applied | § 3.4; V2 |
| devil: the ledger's cost grows with its size | SHOULD | verified (`recordFindings`; `applyOutputMapping`); applied: one merge per batch, measured | § 5.2; § 8 |
| devil: a phantom read in PrepareFinal | SHOULD | verified; applied | § 4.2; § 6 |
| devil: a two-way import between folders | SHOULD | applied: `arguments/` is a leaf; the mount's mappers live in `honesty/` | § 3.1 |
| devil: the two notes contradict each other | SHOULD | applied: the array `from`; `user`/`result`/`turn`/`app`/`assumed`; one `failed` union; unarmed flags, not asks; `ask` refused until step 4, no C6; clause 7 as rewritten | § 2.1; § 5.1; § 4.1; § 1.3 |
| devil: `whenMissing` misleads | SHOULD | applied: `askOrAssume` | § 1.1 |
| devil: the app's run facts `given` | NOTE | applied | § 3.4 |
| devil: "declarations stay in their own keys" is contradicted by the ledger's own rows | NOTE | applied in the architecture note (law 8); this layer's rows are the model's declarations and the library's verdicts on them | § 5.1 |
| devil: public surfaces widen | NOTE | applied | § 5.4 |
| devil: `integer` asked as `number`; the strip helpers; a window-relative turn | NOTE | applied: re-check at bind; `toolChars` in both helpers; `turn` is the conversation turn | § 4.3; § 3.4; § 5.2 |
| practitioner: MCP is the production path | MUST | verified (`McpToolExtras`; the host's catalog); applied | § 1.4; § 1.5 |
| practitioner: a middleware default outranks `assume` | MUST | applied | § 3.5 V1; § 4.6 |
| practitioner: the ask before sources asks too often | MUST | applied: unarmed flags (Q2) | § 4.1 |
| practitioner: the host serves counts, not appended prose | SHOULD | verified (`coverageMark.ts`); applied | § 4.2; § 5.3; § 5.6 |
| practitioner: a library ask loses the host's state | SHOULD | verified (`brain.ts` → `restoreInputPause`); applied: the hook | § 4.3 |
| practitioner: one period, many spellings; freshness horizons | SHOULD | verified (`-24h` ≠ `24h`); applied | § 1.2 |
| practitioner: `queried` must be the read, not the call | SHOULD | applied: `DeclaredPeriod` | § 1.2 |
| practitioner: position against the host's own flow | SHOULD | verified (`queryWindowFlow.ts`); applied | § 1.5 |
| practitioner: `from` planted on every tool | SHOULD | applied: ruled tools only, with a token ceiling | § 2.3; § 7.1 |
| practitioner: a default in two places | NOTE | applied: the migration section | § 1.6 |
| research: a presence check counted as support | MUST | applied: membership never supports; the negation cases | § 3.6; § 5.5; § 8 |
| research: the trust base is unstated | SHOULD | applied | § 3.6 |
| research: free-text answers counted as support | SHOULD | applied: `free`, never support | § 4.3; § 5.1 |
| research: one vocabulary for the paper | NOTE | applied: the array form | § 2.1 |
| research: `said` beside `claimed` | NOTE | applied: the lattice (Q7) | § 5.1 |

Findings about the architecture note alone (the fold's value set, "known" from an unvouched empty
result, the outside truth, the generality claim, related work) are answered there.

---

## What the inputs layer lets you measure

From the record alone, per model and per prompt or skill version: how often a call ran on a default
nobody chose, how often the model echoed that default itself, how often the person was asked and
how often needlessly, how often the model declared a source, how often its quotes and ids checked
out (a copying measure), which checks its claims failed, how often it read a meaning into the
person's words, and how often it built on a result it had set aside. The same rows feed the bench,
the paper's planted-defect claim and the lens. They measure claims within evidence — not whether an
answer is true.
