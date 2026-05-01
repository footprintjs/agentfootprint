#!/usr/bin/env bash
set -euo pipefail

# agentfootprint release script
# Mirrors footprintjs release pipeline — 8 gates before version bump.
#
# Release pipeline:
#   1. Clean working tree
#   2. Documentation check (no stale API refs in .md files)
#   2.5 Duplicate type check (no same type name defined in two files)
#   2.75 Format check (prettier --list-different)
#   3. Build (CJS + ESM)
#   4. Full test suite
#   5. Examples (typecheck + tsx end-to-end run for every example)
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

# ── Gate 2.75: Format check ────────────────────────────────────────────
echo "==> Checking code formatting..."
if ! npm run format; then
  echo "Error: Unformatted files found. Run 'npm run format:fix' to fix."
  exit 1
fi
echo "[2.75/8] Format check ✓"

# ── Gate 2.85: Lint check (errors only — warnings tolerated for now) ────
# CI on main runs eslint and FAILS on any error. Gate it here so the
# release script catches the same problem before we tag a version that
# would ship to npm with lint errors. Run with --max-warnings=Infinity
# so pre-existing warnings don't block; only errors fail the gate.
echo "==> Checking lint (errors only)..."
if ! npm run lint --silent -- --max-warnings=99999; then
  echo "Error: Lint errors found. Run 'npm run lint:fix' to auto-fix where possible."
  exit 1
fi
echo "[2.85/8] Lint check ✓"

# ── Gate 3: Build ───────────────────────────────────────────────────────
echo "==> Building (CJS + ESM)..."
npm run build

echo "[3/8] Build ✓"

# ── Gate 4: Full test suite ─────────────────────────────────────────────
echo "==> Running full test suite..."
npm test

echo "[4/8] Full test suite ✓"

# ── Gate 5: Examples (typecheck + run end-to-end) ───────────────────────
# Source of truth for the consumer-facing surface — every .ts under
# examples/ is run as a real end-to-end test. `npm run test:examples`
# does typecheck (tsc -p examples/tsconfig.json) AND the runtime sweep
# (scripts/run-all-examples.sh).
echo "==> Running all examples end-to-end (typecheck + tsx sweep)..."
if ! npm run test:examples; then
  echo ""
  echo "Error: examples/ failed."
  echo "Fix the failing examples before releasing — these are what developers copy-paste."
  exit 1
fi

echo "[5/8] Examples ✓"

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

# ── Update lockfile (skip if gitignored — platform-specific native deps) ──
if ! git check-ignore -q package-lock.json 2>/dev/null; then
  npm install --package-lock-only
fi

# ── Commit + tag + push ───────────────────────────────────────────────
git add package.json
# Add lockfile only if tracked
git add package-lock.json 2>/dev/null || true
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
echo "  1.    Clean tree              ✓"
echo "  2.    Doc check               ✓  (0 stale API refs)"
echo "  2.5   Dup type check          ✓  (no duplicate exported type names)"
echo "  2.75  Format check            ✓  (prettier clean)"
echo "  2.85  Lint check              ✓  (eslint errors = 0)"
echo "  3.    Build                   ✓  (CJS + ESM)"
echo "  4.    Full test suite         ✓"
echo "  5.    Examples                ✓  (typecheck + tsx end-to-end run)"
echo "  6.    CHANGELOG               ✓"
echo "  7.    Commit + tag + push     ✓"
echo "  8.    GitHub release          ✓"
