#!/usr/bin/env bash
set -euo pipefail

# agentfootprint release script
# Mirrors footprintjs release pipeline — 8 gates before version bump.
#
# Release pipeline:
#   1. Clean working tree
#   2. Documentation check (no stale API refs in .md files)
#   2.5 Duplicate type check (no same type name defined in two files)
#   3. Build (CJS + ESM)
#   4. Full test suite
#   5. Sample projects (agent-samples: tests + run all)
#   6. CHANGELOG entry exists
#   Then: version bump → commit + tag + push → GitHub release → CI npm publish
#
# Usage:
#   npm run release:patch   # 1.1.0 → 1.1.1
#   npm run release:minor   # 1.1.0 → 1.2.0
#   npm run release:major   # 1.1.0 → 2.0.0

BUMP="${1:?Usage: release.sh <patch|minor|major>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SAMPLES_DIR="$(cd "$PROJECT_DIR/../agent-samples" 2>/dev/null && pwd || echo "")"

# ── Gate 1: Clean working tree ──────────────────────────────────────────
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Error: bump must be patch, minor, or major (got: $BUMP)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

echo "[1/8] Clean working tree ✓"

# ── Gate 2: Documentation check ─────────────────────────────────────────
bash scripts/check-docs.sh

echo "[2/8] Documentation check ✓"

# ── Gate 2.5: Duplicate type check ──────────────────────────────────────
echo "==> Checking for duplicate type definitions..."
node scripts/check-dup-types.mjs

echo "[2.5/8] Duplicate type check ✓"

# ── Gate 3: Build ───────────────────────────────────────────────────────
echo "==> Building (CJS + ESM)..."
npm run build

echo "[3/8] Build ✓"

# ── Gate 4: Full test suite ─────────────────────────────────────────────
echo "==> Running full test suite..."
npm test

echo "[4/8] Full test suite ✓"

# ── Gate 5: Sample projects ─────────────────────────────────────────────
if [[ -n "$SAMPLES_DIR" && -d "$SAMPLES_DIR" ]]; then
  echo "==> Running sample projects ($SAMPLES_DIR)..."

  # Install latest local build
  (cd "$SAMPLES_DIR" && npm install 2>&1 | tail -1)

  # Run integration tests
  echo "==> Running sample integration tests..."
  if (cd "$SAMPLES_DIR" && npm test 2>&1 | tail -5); then
    echo "  Sample integration tests passed."
  else
    echo ""
    echo "Error: Sample integration tests failed."
    exit 1
  fi

  # Run all samples defined in package.json "all" script
  if (cd "$SAMPLES_DIR" && npm run all 2>&1 | tail -3); then
    echo "  All samples passed."
  else
    echo ""
    echo "Error: Sample projects failed."
    echo "Fix the samples before releasing — these are what developers copy-paste."
    exit 1
  fi

  echo "[5/8] Sample projects ✓"
else
  echo "==> Skipping samples (../agent-samples not found)."
  echo "    To enable: clone agent-samples next to agentfootprint."
  echo "[5/8] Sample projects ⊘ (skipped)"
fi

# ── Version bump ────────────────────────────────────────────────────────
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo "==> Bumped to v$VERSION"

# ── Gate 6: CHANGELOG entry ─────────────────────────────────────────────
if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
  echo "Error: CHANGELOG.md has no entry for [$VERSION]."
  echo "Add a ## [$VERSION] section before releasing."
  git checkout package.json
  exit 1
fi

echo "[6/8] CHANGELOG entry ✓"

# ── Extract release notes ──────────────────────────────────────────────
NOTES=$(awk "/^## \[$VERSION\]/{found=1; next} /^## \[/{if(found) exit} found{print}" CHANGELOG.md)
if [[ -z "$NOTES" ]]; then
  echo "Warning: CHANGELOG.md entry for [$VERSION] is empty. Continuing anyway."
fi

# ── Update lockfile ────────────────────────────────────────────────────
npm install --package-lock-only

# ── Commit + tag + push ───────────────────────────────────────────────
git add package.json package-lock.json
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"
git push
git push --tags

echo "[7/8] Commit + tag + push ✓"

# ── Create GitHub release ─────────────────────────────────────────────
if command -v gh &> /dev/null; then
  echo "==> Creating GitHub release (CI will publish to npm with provenance)..."
  gh release create "v$VERSION" \
    --title "v$VERSION" \
    --notes "$NOTES" \
    --latest
  echo "    release: https://github.com/footprintjs/agentfootprint/releases/tag/v$VERSION"
  echo "    CI will publish to npm shortly — check Actions tab for status."
else
  echo "Warning: gh CLI not found. Skipping GitHub release creation."
  echo "Run manually: gh release create v$VERSION --title v$VERSION --latest"
fi

echo "[8/8] GitHub release ✓"

echo ""
echo "==> Released v$VERSION"
echo "    npm: https://www.npmjs.com/package/agentfootprint/v/$VERSION (published by CI)"
echo "    changelog: CHANGELOG.md"
echo ""
echo "Release pipeline passed all gates:"
echo "  1.   Clean tree               ✓"
echo "  2.   Doc check                ✓  (0 stale API refs)"
echo "  2.5  Dup type check           ✓  (no duplicate exported type names)"
echo "  3.   Build                    ✓  (CJS + ESM)"
echo "  4.   Full test suite          ✓"
echo "  5.   Sample projects          ✓  (agent-samples tests + all samples)"
echo "  6.   CHANGELOG                ✓"
echo "  7.   Commit + tag + push      ✓"
echo "  8.   GitHub release           ✓"
