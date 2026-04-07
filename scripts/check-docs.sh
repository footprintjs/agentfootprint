#!/usr/bin/env bash
set -euo pipefail

# Pre-release documentation check.
# Scans all .md files for references to removed/deprecated APIs.
# If any are found, the release is blocked.
#
# Usage: bash scripts/check-docs.sh
# Called by: scripts/release.sh (before version bump)

REMOVED_APIS="getGroundingSources|getLLMClaims|getFullLLMContext|CostRecorderV2|truncateToCharBudget"

echo "==> Checking documentation for deprecated API references..."

FAILURES=0
while IFS= read -r file; do
  count=$(grep -cE "$REMOVED_APIS" "$file" 2>/dev/null || true)
  if [[ "$count" -gt 0 ]]; then
    echo "  FAIL: $file ($count references to removed APIs)"
    grep -nE "$REMOVED_APIS" "$file" | head -5
    FAILURES=$((FAILURES + count))
  fi
done < <(find . -name "*.md" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "CHANGELOG.md")

if [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "Error: $FAILURES references to removed APIs found in documentation."
  echo "Update these files before releasing."
  echo ""
  echo "Removed APIs (use these instead):"
  echo "  getGroundingSources()   → ExplainRecorder.explain().sources"
  echo "  getLLMClaims()          → ExplainRecorder.explain().claims"
  echo "  getFullLLMContext()     → ExplainRecorder.explain()"
  echo "  CostRecorderV2          → CostRecorder"
  echo "  truncateToCharBudget()  → charBudget({ maxChars }) from agentfootprint/providers"
  exit 1
fi

echo "  All documentation is up to date."
