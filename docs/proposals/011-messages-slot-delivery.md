# 011 — Honest messages-slot delivery

Status: DESIGN (Round A). Nothing here is built; Round B builds exactly this and
nothing beyond it. Names are working names until a release ships them.

## Evidence (measured, 2026-08-03)

The docs promised that a `slot:'messages'` injection "appears alongside fresh
tool results in the message history." Measured on a real run: nothing from
`inject.messages` ever reached the wire at any role — the slot's output was an
observability projection only. Worse, the promise could not be kept naively:
Anthropic-family providers (Anthropic, Browser, Bedrock) drop a `role:'system'`
message inside the `messages` array (system rides a separate top-level field),
while OpenAI-family providers carry it. Wiring the slot straight to the wire
would have made the recording provider-dependently true — worse than uniformly
false, because nothing in the recording distinguishes the two. 7.19.1 therefore
refused the declaration by name. This proposal is the acceptance that refusal
holds the door for.

## D1 — a delivered injection is part of the window, or it is a lie

The window law (window.ts): everything downstream sees ONE window; no component
gets a different past than the model. Therefore delivered messages-slot
injections enter `scope.history` itself — never a parallel array spliced at
send time. Consequences, all deliberate:
- window strategies (compaction, slidingWindow, tokenBudget) see them, count
  them, and may fold them under the standard refusal rules;
- the commit log records their arrival as a write by the injection engine's
  stage (provenance: who let it in, per the existing injected events);
- `traceVariable`/slices read them with zero changes.
The injected message carries a stable marker in committed metadata (not in the
content) so the wire-truth test can find it: the 7.19.1 refusal-shaped test
flips to acceptance-shaped by asserting the marked message's content appears in
the captured request.

## D2 — the provider role capability, feature-detected

A provider adapter declares what the wire can carry:
`carriesInMessages: readonly ('system' | 'user' | 'assistant')[]` (working
name), alongside its existing surface. The engine consults it at DELIVERY time:
- role supported → delivered as declared;
- role unsupported → REFUSED at run start, naming the provider and the roles it
  carries (never silently re-roled: changing who appears to speak is a meaning
  change the app must make, not the library).
Capability absent (third-party adapter) → treated as user/assistant-only, the
floor every known wire supports; stated in the adapter guide.

## D3 — the sequence rule

Providers reject malformed alternation (two consecutive user turns after tool
results, etc.). The rule: a delivered injection is placed at the END of the
history the iteration assembled, and if its role would collide with the
adjacent turn's role, delivery for THIS iteration is deferred to the next
boundary and the deferral is recorded (a named note on the injection's event,
never a silent drop, never a reorder). Injections never split a
tool_use/tool_result pair — the same unbreakable-pair law the window family
enforces.

## D4 — the cache-marker index fix (mandatory here)

`CacheMarker{field:'messages'}` counted injection indices but was stamped onto
wire-message indices — unreachable since 7.19.1, reachable again the moment
delivery lands. Round B recomputes marker boundaries against the ACTUAL wire
array after delivery and windowing, and adds a marker-truth pin beside the
wire-truth test: a marker's index names the message it claims to name.

## D5 — asRole's decision point

`defineMemory({asRole})` was refused in 7.20.0 as never-read. If field evidence
asks for role-differentiated recall, it rides THIS machinery: a recall formatter
becomes a messages-slot injection with a declared role, subject to D2's
capability check and D3's sequence rule. Absent evidence, the refusal stands.

## Refused in Round A (recorded so Round B does not re-litigate)

- Silent re-roling on unsupported providers (a meaning change is the app's).
- Wire-time splicing that bypasses history (breaks the window law).
- Delivering to SOME providers and recording success uniformly (the original
  provider-dependent lie, in feature clothing).

## Round B test list (minimum)

1. The wire-truth test flips: a delivered slot:'messages' injection's content
   appears in the captured request, on a provider that carries its role.
2. Unsupported role → run-start refusal naming provider + carried roles.
3. Window integration: a delivered injection folds under compaction like any
   turn; the unbreakable-pair law holds around it.
4. Sequence deferral: a colliding role defers with a named note, delivers next
   boundary, never reorders.
5. Marker-truth: cache marker indices name the wire messages they claim.
6. Recording agreement: context.injected slot, the delivery write's commit, and
   the wire agree — one truth, three surfaces (extends 7.20.0's test).
7. Third-party adapter without the capability: user/assistant delivered,
   system refused by the floor rule.
