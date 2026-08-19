# ADR: The Pattern program — harness surface, recording contract, and footprint-pattern

Status: ACCEPTED (wave 0 complete, audited, committed 2026-08-18)
Date: 2026-08-18 · Decided by: review of the external strategic proposal v1.0 against the code

## Context

An external strategic proposal (reviewed 2026-08-18) asked five questions: build a second
harness library? position agentfootprint as a harness? put cross-run analytics inside it?
orchestrate the analytics with footprintjs? let the LLM mine patterns? The review accepted its
spine and corrected it where the codebase had moved past it.

## Decisions

**D1 — No second harness package.** The runtime, tools, MCP, memory, RAG, skills, hosting and
semantic events already exist in `agentfootprint`. The missing work is a surface, not an
engine. A duplicate package would fragment the story and the tests.

**D2 — `RecordingEnvelope` is the ecosystem's narrow waist.** Format literal
`agentfootprint.recording.v1`, wrapping the existing `recordRun` Recording unmodified.
Everything above produces it; everything below consumes it; dependency arrows never reverse
(`agentfootprint` never depends on Pattern). Identity is never invented (absent stays absent);
`complete`/`droppedEvents` are true facts or refusals; privacy modes not yet implemented are
REFUSED BY NAME — a false `redacted` label is worse than honest raw.

**D3 — `AgentRecipe` is a declared, versioned composition over the existing builder.** No
plugin system, no lifecycle, conflict = build-time error naming both sources, manifest rows
carry ids and versions only. The builder stays the single conflict authority.

**D4 — `footprint-pattern` is a new, independent package. LOCAL-ONLY until gated.** Generic
`PatternCase`, execution domain only in v1. Strategies are PURE functions; a footprintjs-flow
wrapper arrives in Wave 1 so "the analysis of the evidence is itself evidence" (replay =
byte-equal findings, via footprintjs replay). Deterministic mining first; the LLM investigates
findings through bounded MCP tools later — it never mines.

**D5 — v1 privacy is structure-only BY CONSTRUCTION.** The normalizer never copies free text,
so `contentMode: 'structure-only'` is true of the bytes, not a policy claim.

**D6 — Fingerprints obey the injectivity law.** A fingerprint is a mapping-used-as-a-key:
`canonicalJson` ships with its collision corpus (type confusion, separator donation, nesting)
in the same change; fingerprints bind caseSchema + policy id/version + vocabulary. The
property suite carries a gate-on-the-gate: deliberately broken canonicalizers must FAIL it and
a control must pass.

**D7 — The wedge is already field-validated in miniature.** `tools.code_run` + `codeShape()`
(9.46.x) ships normalize-shape-and-count-recurrence across runs. Pattern generalizes a
validated move; codeShape recurrence is a free early strategy; the claim to sponsors is
existence, not hypothesis.

**D8 — Sequencing.** Wave 1: this ADR final + footprintjs-flow wrapper + dogfood capture +
divergence/window-regression + release (9.48.0 candidate). Wave 2: outcome association + Lens
deep-links + the user-gated repo/npm decision. Wave 3: read-only MCP investigator (an
agentfootprint Agent — its own runs are recorded and minable; findings cite IDs and pin their
analysis version, stale references refused) + Viz bridge DTO (FDR-controlled exploration).
Wave 4: infra adapters only after design-partner pull. Parked: sponsor/funding material.

**D9 — Acceptance test for the thesis.** Pattern must run on its own analysis recordings and
on the investigator's. Self-explaining is a testable property, not a slogan.

## Consequences

- One new package only; every other capability lands inside existing repos.
- The envelope version is the compatibility contract to guard hardest; schema changes are
  additive or new-format-literal, never silent.
- Capability-index rows are part of every public addition (the index test enforces truth).
- The proposal's market citations remain unverified; verify before external use.

## Audit outcomes (wave 0 post-hoc, 2026-08-18)

- Recipes: CONFIRMED genuinely new; injective-key law honored by construction.
- Envelope: CONFIRMED faithful to the recorder (no invented facts) — but PARTIAL on
  novelty: the repo had THREE producer-owned archive shapes (Trace v1, exportBugReport,
  the envelope) with no stated relationship, because exportBugReport had NO capability-
  index row — the index's stale-by-omission weakness observed in the wild. Fixed:
  row added, relationship stated in the observability README (envelope = contract;
  the other two = presentations over it).
- Adapter event vocabulary: all 22 names verified verbatim against the registry.
- npm name: footprint-pattern is FREE (E404) — claiming it stays user-gated.
- producer.footprintjsVersion stamps 'unknown' (honest) until footprintjs ships the
  "./package.json" export added in footPrint d6b6888 (needs a 9.15.1 + dep bump).

## Follow-ups adopted into Wave 1

- [ ] agentfootprint reserves the `sf-` subflow-id prefix at the builder door
      (makes the adapter's framework filter lawful; limitation documented in
      footprint-pattern 43caf6c until then).
- [ ] exportBugReport packs an envelope instead of a bare recording.json.
- [ ] footprintjs 9.15.1 release + agentfootprint dep bump so engineVersion() resolves.
- [ ] The NEXT agentfootprint release MUST be 9.48.0 — three index rows are already
      stamped with it and become lies under any other number.

## Closed at finalize

- Post-hoc audit: recipes CONFIRMED new; envelope CONFIRMED faithful; three-archive-shapes
  overlap found and reconciled (see Audit outcomes). Adapter event names verified 22/22.
- Rail: agentfootprint 731e1d9c + 107fc726 + 7cc44d04 + 1044fb65; footPrint d6b6888;
  footprint-pattern 7219b3b + 43caf6c. Full suites green (8643 / 3598 / 296). Nothing pushed.
- npm name footprint-pattern: FREE (E404). Claiming it: user-gated.
- producer.footprintjsVersion: stamps honest unknown until footprintjs 9.15.1 ships the
  exports fix (d6b6888) and the dep bumps.

## Two laws learned shipping this

- The docs phantom-event checker reads ANY agentfootprint.<a>.<b> triple in prose as an
  event name — dotted format markers can never appear literally on a docs page; name the
  exported constant instead.
- A committed generated tree (TypeDoc api/) drifts silently and its diffs land inside
  unrelated commits; regenerate it deliberately, alone, on a schedule or per release.
