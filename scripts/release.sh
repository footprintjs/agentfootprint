#!/usr/bin/env bash
set -euo pipefail

# agentfootprint release script
# Usage: npm run release:patch | npm run release:minor | npm run release:major

BUMP="${1:-patch}"

echo "=== agentfootprint release ($BUMP) ==="

# 1. Clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

echo "[1/7] Clean working tree ✓"

# 2. Build
echo "[2/7] Building..."
npm run build

# 3. Test
echo "[3/7] Running tests..."
npm test

# 4. Check CHANGELOG
VERSION=$(node -p "require('./package.json').version")
if ! grep -q "\[Unreleased\]\|## \[" CHANGELOG.md 2>/dev/null; then
  echo "WARNING: No CHANGELOG.md found or no version entries. Consider adding one."
fi
echo "[4/7] CHANGELOG check ✓"

# 5. Version bump (no git tag — we tag after push)
echo "[5/7] Bumping version ($BUMP)..."
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")

# 6. Update lockfile
npm install --package-lock-only

# 7. Commit, tag, push
echo "[6/7] Committing v$NEW_VERSION..."
git add package.json package-lock.json
git commit -m "chore: release v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin main
git push origin "v$NEW_VERSION"

# 8. Create GitHub release (triggers publish.yml → npm publish)
echo "[7/7] Creating GitHub release..."
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --generate-notes

echo ""
echo "=== Release v$NEW_VERSION complete ==="
echo "GitHub release created → publish.yml will npm publish with provenance."
echo "Track at: https://github.com/footprintjs/agentfootprint/actions"
