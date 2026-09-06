**Support** — declared per-scope rules (retry / fail-fast / continue) evaluated
at a gate subflow, plus a breaker that holds state across calls.

## What it reads / what it writes
- Reads the thrown error's classification and the declared rules.
- Writes the gate's decision into the chart's own branch. It is policy about
  whether the WALK continues, never about what the model sees.

## The one law here
A retry is telemetry, not content: it rides the emit channel and the record, and
adds no sentence to the wire.

## Files
- `types.ts` — the rules vocabulary.
- `buildReliabilityGateChart.ts` — the gate as a subflow.
- `classifyError.ts` — thrown error → coarse kind.
- `CircuitBreaker.ts` — the pure state machine.
- `index.ts`.
