# The Served graph — held, served, and withheld, at one call (design, 2026-09-10)

**Status:** DESIGN. Approved by the owner 2026-09-10 ("ok"). Renderer only: no library
change is required for the first version. Built as a VIEW TOGGLE inside the Why Lens's
Served tab, on the one cursor — never a fourth lens, never a second stepper.

## The question it answers

The family has two graphs. The **skill graph** draws where a run may go and where it went.
The **data graph** draws where a value came from. Neither answers the question an operator
asks at 2am: *what was this one call actually made of, and what did we hold back?*

The Served tab answers it today as a list of sections. A list is right for checking one row
and wrong for seeing that the system string was assembled from a base plus one skill body
plus two injections while three tools were withheld. That is one picture.

## The word

`ledger` and `wire` were retired as public words on 2026-09-06 (see
`served_ledger_design`). The shipped vocabulary is **receipt** (the proof), **epoch** (the
call), **Served** (the view). This is the **Served graph**. The owner's "our internal
ledger" is, in the shipped words, **the fold at the stop**.

## Three bands, left to right

1. **HELD — what the record holds at this stop.** The fold: `iteration`, `currentSkillId`,
   `stepPointer`, `mapEngagement`, `activeInjections`, `hiddenSkillIds`, plus the fold's own
   honesty flags (`basis`, `redacted`, `skipped`, `foldError`). Source: the lens's
   `foldFactsAt(recording, cursor)`.
2. **SERVED — what crossed into the call.** `servedAt(snapshot, k)`: the system pieces in
   wire order (each `{ text, slot, source }`), the messages as sent, the request-only lines
   (each with the library's own `reason`), the tool names and schemas, the forced tool.
   Every edge badged by the receipt through the lens's `verify()`: Verified, Reconstructed,
   Damaged, Not on record.
3. **WITHHELD — held and not sent.** The difference, each with its reason, never inferred:
   `tools.withheld`, `Receipt.omittedForAttention`, `hiddenSkillIds` (from the FOLD, never
   the receipt — a receipt carries no authority names by law), redacted values, and any
   field a `ServedGapKind` covers.

Band 3 is the reason to build this. The model never learns what it was denied; the operator
should. This is where "a lens may omit, never deny" stops being a sentence in a document.

## The fourth thing: what changed

The lens already computes, between two epochs, `sincePrevious`: system `changed` + word
diff, `piecesEntered` / `piecesLeft`, messages `entered` / `left`, tools `added` /
`removed` / `schemaChanged`. Render it as edge STATE on the same graph — entered, left,
unchanged — so "since the last call, this injection entered and that tool went hidden" is
read off the picture, not reconstructed by the reader.

## Node and edge vocabulary (all from shipped data)

- **Slot nodes** — exactly three, the library's `ContextSlot`: `system-prompt`, `messages`,
  `tools`. Never invented, never renamed.
- **Source nodes** — the library's `ContextSource`: `rag`, `skill`, `memory`,
  `instructions`, `steering`, `fact`, `custom`, `user`, `tool-result`, `assistant`, `base`,
  `registry`. A piece's `source` names its node; a piece's `slot` names its edge's target.
- **The call node** — `epoch` + `callRuntimeStageId` + `basis` (model, provider, run id)
  when a receipt was read.
- **Edge = one piece.** Its badge is the verification of that piece. Its state is
  entered / left / unchanged from `sincePrevious`.
- **Withheld edges** are drawn greyed to the same slot, labelled with the library's own
  reason string — printed verbatim, never paraphrased.

## Laws this view keeps

1. **One cursor.** The graph is a rendering of the stop the lens is already on.
2. **No sentence of the lens's own.** Every explanation is a library constant, a computed
   value, or a label. The allowlist test covers the new component.
3. **Verified means the hashes agree.** A badge is never softened for a prettier picture.
4. **Absent is not none.** A field a gap covers renders the gap, not an empty node. And the
   fold can only show what was COMMITTED: a value the run computed but never wrote is "not
   on record", never an empty box that reads as "nothing was there".
5. **Authority omissions come from the fold, not the receipt.**

## Deliberately out of scope for v1

An edge from a served piece back to the STAGE that wrote it (click a fragment, land on its
commit). It needs a commit-log walk keyed by piece text or slot, it is the part most likely
to rot, and it is not needed to answer the question. Measure it separately; ship the fan-in
without it if the measurement is bad.

## Packet

One lens minor: `src/core/served/servedGraphAt.ts` (pure, frozen, no React — builds the
three bands and the edges from `foldFactsAt` + `servedAt` + `verify` + `sincePrevious`),
`<ServedGraph>` beside `<ServedTab>`'s list with a view toggle, LABELS extended, the
allowlist test extended, and a test per law above measured on the eight real fixtures —
including one where a tool is withheld and one where a skill is hidden by role.
