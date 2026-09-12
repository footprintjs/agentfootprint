#!/usr/bin/env bash
# Runs every .ts example under examples/ end-to-end via tsx.
# Used by `npm run examples:run-all` to verify runtime behavior, not
# just typecheck (`npm run test:examples` covers types).
#
# Forces the paths-free runtime tsconfig so footprintjs/* subpaths
# resolve through node + package.json exports instead of the root
# tsconfig's `paths` block (which points to .d.ts files for tsc).
set -euo pipefail

export TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json

shopt -s nullglob
fail=0
total=0

for f in examples/*/*.ts; do
  total=$((total + 1))
  echo "=== $f ==="
  # stdin from /dev/null: the sweep is a GATE, never a conversation. An example
  # that asks a person (34-checkin-coworker prompts when stdin is a TTY) must
  # take its non-interactive branch here — from a real terminal it otherwise
  # waited on an invisible prompt, with stdout already in /dev/null (9.94.2).
  if ! npx --yes tsx "$f" >/dev/null 2>&1 </dev/null; then
    echo "  ✗ FAILED"
    fail=$((fail + 1))
  else
    echo "  ✓ ok"
  fi
done

echo
echo "$((total - fail))/$total examples passed"
exit $fail
