---
type: changed
---
**The npm package no longer ships the contributor map or the full changelog, and
`npx agentfootprint-setup` no longer writes a `CLAUDE.md` into your project.**
The setup used to copy the library's own contributor file — a ~93 KB map of its
internals — into your project root, where Claude Code loaded it into every
session (~23k tokens) whatever the task. It now installs only the
`agentfootprint` skill, which loads when the task is about agentfootprint. If an
earlier setup left that `CLAUDE.md` in your project and you did not edit it, you
can delete it. The package now ships `CAPABILITIES.md` — the "it may already
exist" index of what the library does, keyed by what you would call each
feature — and leaves `CLAUDE.md` and the 1.4 MB `CHANGELOG.md` out of the
tarball; release notes are on each GitHub release.
