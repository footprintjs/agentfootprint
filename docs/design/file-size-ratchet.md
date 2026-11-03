# Source file-size ratchet

The shared `footprintjs/ci` check counts every tracked file under `src/`, including Markdown, from the committed Git tree. The ceiling is 600 physical lines. `.file-size-baseline.json` records existing larger files at their measured sizes; there are no excluded source files.

A new oversized file fails. A baselined file cannot grow, its recorded count must tighten whenever it shrinks, and its entry must disappear at 600 lines or below or after deletion. The check compares baseline changes with the PR base or previous push; increasing a number cannot make the gate green. A rename above the ceiling must also be split.

Both CI and the release workflow call the same reviewed full shared-tool commit. The release check uses the actual pinned plan commit and its first parent, and its successful result is mandatory for `build`, including the existing fallback that reruns other gates. The local `npm run build` command alone does not invoke this repository check. Main's ruleset must require the actual emitted CI context before adoption is complete.

No generated, vendored or test files are guessed or excluded. The shared baseline format supports explicit exact file paths or trailing-slash directories, with generated/vendored/test reasons; after initial adoption that exclusion list may only shrink. Check local committed work with the shared tool's `scripts/file-size.mjs --repo . --base FULL_BASE_SHA`.
