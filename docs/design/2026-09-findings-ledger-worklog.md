# Findings ledger — worklog

One line per task, newest last. Each task: built → Opus review → Sonnet
review → fixes → bench → commit. Read before touching any step; the design
page (`2026-09-findings-ledger.md`) holds the plan, this holds what happened.

- 2026-09-16 · step 1 · bench `bench/findings-context.mjs` + baseline (no window 6/6 facts, noise 93.5%; sliding keep-6 2/6 facts). Lesson: run benches over the CJS dist on node, not tsx.
- 2026-09-16 · design refined from the owner's transcript: basis before the call (direct/exploratory + usefulness bucket + sought), ruled-out disposition, ledger-only answer turn, shuffle test, instruction as versioned artifact; prior art recorded (SLEUTH 2607.12267, 2606.04990).
- 2026-09-16 · fact · `contextfootprint` 0.1.1 is on npm and already an agentfootprint dependency (`src/integrity/assertion/`); the cross-line question is closed. Understand+design workflow launched (5 seam readers → 3 designs → judge/synthesis).
- 2026-09-16 · spec · understand+design workflow done (9 agents, ~1.7M tokens): winner 'ride-along findings' (a reserved `_findings` argument on the next tool call + a reserved answer key; zero extra calls), corrected with the record-first honesty laws; filed as `2026-09-findings-ledger-spec.md` (line numbers there are the readers' — cite symbols in code and notes).
