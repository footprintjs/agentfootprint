#!/usr/bin/env bash
set -euo pipefail

# RELEASE_QUIET=1 silences the progress banners (the gates' own output and
# every error still print). For a release driven by an agent or a script
# that only needs the verdict.
say() { if [ "${RELEASE_QUIET:-0}" != "1" ]; then echo "$@"; fi; }

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
#   5.5 CI gate parity (test:types, docs:truth, publint, attw, doc-links)
#   6. Version + CHANGELOG from .changes/ fragments (scripts/release-prepare.mjs),
#      then every generated doc regenerated (npm run docs:generate)
#   Then: commit + tag + push → GitHub release → CI npm publish → docs deploy
#
# THE PREFERRED RELEASE IS THE GITHUB WORKFLOW (Actions → Release, or
# `gh workflow run publish.yml -f bump=auto`): it runs these gates on GitHub's
# runners BEFORE anything is tagged. This script is the local fallback.
#
# Usage:
#   npm run release         # version computed from .changes/ fragments
#   npm run release:patch   # 1.1.0 → 1.1.1
#   npm run release:minor   # 1.1.0 → 1.2.0
#   npm run release:major   # 1.1.0 → 2.0.0

BUMP="${1:?Usage: release.sh <auto|patch|minor|major>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Gate 1: Clean working tree ──────────────────────────────────────────
if [[ "$BUMP" != "auto" && "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Error: bump must be auto, patch, minor, or major (got: $BUMP)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

say "[1/8] Clean working tree ✓"

# ── Gate 2: Documentation check ─────────────────────────────────────────
bash scripts/check-docs.sh

say "[2/8] Documentation check ✓"

# ── Gate 2.5: Duplicate type check ──────────────────────────────────────
say "==> Checking for duplicate type definitions..."
node scripts/check-dup-types.mjs

say "[2.5/8] Duplicate type check ✓"

# ── Gate 2.75: Format check ────────────────────────────────────────────
say "==> Checking code formatting..."
if ! npm run format; then
  echo "Error: Unformatted files found. Run 'npm run format:fix' to fix."
  exit 1
fi
say "[2.75/8] Format check ✓"

# ── Gate 2.85: Lint check (errors only — warnings tolerated for now) ────
# CI on main runs eslint and FAILS on any error. Gate it here so the
# release script catches the same problem before we tag a version that
# would ship to npm with lint errors. Run with --max-warnings=Infinity
# so pre-existing warnings don't block; only errors fail the gate.
say "==> Checking lint (errors only)..."
if ! npm run lint --silent -- --max-warnings=99999; then
  echo "Error: Lint errors found. Run 'npm run lint:fix' to auto-fix where possible."
  exit 1
fi
say "[2.85/8] Lint check ✓"

# ── Gate 3: Build ───────────────────────────────────────────────────────
say "==> Building (CJS + ESM)..."
npm run build

say "[3/8] Build ✓"

# ── Gate 4: Full test suite, THE WAY CI'S COVERAGE JOB RUNS IT ──────────
# `npm run test:coverage` is `npm test` under v8 instrumentation — the same
# tests, slower. CI runs both; this script used to run only the fast one, and
# 9.86.0 shipped with `coverage` red on the release commit: two tests that
# parse all of src/ took 5.3–6.2 s each under instrumentation on the CI
# runner, past vitest's 5 s default, while passing in 1–2 s here. The local
# gate could not see what CI saw because it never ran the command CI ran.
# One command is the law now: the instrumented run is a superset of the plain
# one, so nothing the plain run would catch is lost.
say "==> Running full test suite (with coverage — the command CI's coverage job runs)..."
npm run test:coverage

say "[4/8] Full test suite ✓"

# ── Gate 5: Examples (typecheck + run end-to-end) ───────────────────────
# Source of truth for the consumer-facing surface — every .ts under
# examples/ is run as a real end-to-end test. `npm run test:examples`
# does typecheck (tsc -p examples/tsconfig.json) AND the runtime sweep
# (scripts/run-all-examples.sh).
say "==> Running all examples end-to-end (typecheck + tsx sweep)..."
if ! npm run test:examples; then
  echo ""
  echo "Error: examples/ failed."
  echo "Fix the failing examples before releasing — these are what developers copy-paste."
  exit 1
fi

say "[5/8] Examples ✓"

# ── Gate 5.5: CI GATE PARITY ────────────────────────────────────────────
# Everything CI runs on a push that this script used to skip. Before 9.59.0
# the two lists were different sets, and the publish workflow triggers on the
# `release: published` event — which `gh release create` fires SECONDS after
# the push, concurrently with CI. So a gate could be red in CI and the bytes
# still went to npm (9.58.0: `docs:truth` red on both post-release commits).
# The real interlock now lives in .github/workflows/publish.yml, whose build
# job runs docs:truth and which the publish job `needs:`. This block is the
# cheap half: fail on THIS machine, before the version bump, instead of
# discovering it at publish time with a tag already pushed.
#
# The one CI job with no counterpart here is `docs` (the docs-next Fumadocs
# build): it needs its own `npm install` inside docs-next/ and several
# minutes. It stays CI-only, on purpose.
say "==> Type-regression tests (test/type-regressions/)..."
npm run test:types

say "==> Docs-truth ratchet (new undocumented exports/events)..."
if ! npm run docs:truth; then
  echo ""
  echo "Error: docs:truth is RED. A new export or event has no prose describing it,"
  echo "or the docs point a reader at something that does not exist."
  echo "Fix the docs, or accept the debt consciously with: npm run docs:truth:baseline"
  exit 1
fi

say "==> Packed ContextFootprint dependency (isolated consumers)..."
npm run test:context-package

say "==> Packaging correctness (publint + are-the-types-wrong)..."
npx --yes publint
npx --yes @arethetypeswrong/cli --pack

say "==> Doc-link integrity (every doc:<id> cross-reference resolves)..."
npm install --no-save github-slugger >/dev/null 2>&1 || true
node scripts/check-doc-links.mjs --strict

say "[5.5/8] CI gate parity ✓"

# ── Version + CHANGELOG + generated docs ────────────────────────────────
# One script owns the bump: it folds .changes/ fragments into CHANGELOG.md,
# sets the version (package.json + lock) and fills `unreleased` capability rows.
# With no fragments it accepts a hand-written `## [X.Y.Z]` entry (the old way).
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
if ! node scripts/release-prepare.mjs --bump "$BUMP" --notes-out "$NOTES_FILE" >/dev/null; then
  echo "Error: release-prepare refused (message above). Nothing was changed."
  exit 1
fi
VERSION=$(node -p "require('./package.json').version")
say "==> Prepared v$VERSION"

# The generated docs name the version and describe the code — regenerate them
# so the release commit carries docs that match it.
say "==> Regenerating docs for v$VERSION..."
npm run docs:generate >/dev/null

say "[6/8] Version + CHANGELOG + docs ✓"

# ── Commit + tag + push ───────────────────────────────────────────────
# The tree was clean at gate 1, so everything here is the release's own change.
git add -A
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"
git push
git push --tags

say "[7/8] Commit + tag + push ✓"

# ── Create GitHub release ─────────────────────────────────────────────
if command -v gh &> /dev/null; then
  say "==> Creating GitHub release (CI will publish to npm with provenance)..."
  gh release create "v$VERSION" \
    --title "v$VERSION" \
    --notes-file "$NOTES_FILE" \
    --latest
  echo "    release: https://github.com/footprintjs/agentfootprint/releases/tag/v$VERSION"
  echo "    CI will publish to npm shortly — check Actions tab for status."
  # The docs site deploys on a release, not on every push (docs.yml).
  gh workflow run docs.yml --ref main || echo "Warning: could not start the docs deploy — run the Deploy Docs workflow by hand."
else
  echo "Warning: gh CLI not found. Skipping GitHub release creation."
  echo "Run manually: gh release create v$VERSION --title v$VERSION --latest"
fi

say "[8/8] GitHub release ✓"

echo ""
say "==> Released v$VERSION"
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
echo "  5.5   CI gate parity          ✓  (types, docs:truth, publint, attw, doc-links)"
echo "  6.    Version + CHANGELOG     ✓  (from .changes/, docs regenerated)"
echo "  7.    Commit + tag + push     ✓"
echo "  8.    GitHub release          ✓"
