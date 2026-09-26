#!/usr/bin/env bash
# Runs every .ts example under examples/ end-to-end via tsx, in parallel.
# Used by `npm run test:examples` (after the typecheck) — locally, in CI's
# test job and in the Release workflow.
#
# Forces the paths-free runtime tsconfig so footprintjs/* subpaths
# resolve through node + package.json exports instead of the root
# tsconfig's `paths` block (which points to .d.ts files for tsc).
#
# PARALLEL: one tsx process per example, EXAMPLES_JOBS at a time (default:
# the CPU count). Run serially — and through `npx` per file — this took
# ~13 minutes in CI, most of it process start-up rather than the examples.
# Parallel is safe because every example that touches the machine uses a
# fresh mkdtemp directory or port 0; an example that needs a FIXED resource
# (a port, a path) must not be added without guarding it.
# EXAMPLES_JOBS=1 restores the one-at-a-time run for debugging.
set -euo pipefail

export TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json

JOBS="${EXAMPLES_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

# Resolve tsx ONCE (npx per file re-resolves the package every time).
TSX="$(npx --yes -p tsx -c 'command -v tsx')"

shopt -s nullglob
files=(examples/*/*.ts)
total=${#files[@]}
results="$(mktemp -d)"
trap 'rm -rf "$results"' EXIT

# A hung example (a server or timer left open) must fail the sweep, not stall
# CI for hours: each one gets EXAMPLE_TIMEOUT seconds (default 300). Uses
# coreutils `timeout` where it exists (Linux CI); macOS without coreutils runs
# unbounded, as before.
EXAMPLE_TIMEOUT="${EXAMPLE_TIMEOUT:-300}"
LIMIT=""
if command -v timeout >/dev/null 2>&1; then LIMIT="timeout $EXAMPLE_TIMEOUT"; fi

# One example. stdin from /dev/null: the sweep is a GATE, never a
# conversation — an example that asks a person (34-checkin-coworker prompts
# when stdin is a TTY) must take its non-interactive branch here (9.94.2).
# Output is kept only for a failure, so the failure is diagnosable.
run_one() {
  local f="$1" key status=0
  key="$(echo "$f" | tr '/' '~')"
  $LIMIT "$TSX" "$f" >"$results/$key.log" 2>&1 </dev/null || status=$?
  if [ "$status" -eq 124 ]; then
    echo "(timed out after ${EXAMPLE_TIMEOUT}s)" >>"$results/$key.log"
  fi
  if [ "$status" -eq 0 ]; then
    echo "  ✓ $f"
    rm -f "$results/$key.log"
  else
    echo "  ✗ $f"
    : >"$results/$key.failed"
  fi
}
export -f run_one
export TSX results LIMIT EXAMPLE_TIMEOUT

echo "Running $total examples, $JOBS at a time..."
printf '%s\n' "${files[@]}" | xargs -P "$JOBS" -I{} bash -c 'run_one "$1"' _ {}

fail=0
for marker in "$results"/*.failed; do
  fail=$((fail + 1))
  key="$(basename "${marker%.failed}")"
  echo
  echo "=== FAILED: ${key//\~//} — last 30 lines ==="
  tail -n 30 "$results/$key.log"
done

echo
echo "$((total - fail))/$total examples passed"
exit $fail
