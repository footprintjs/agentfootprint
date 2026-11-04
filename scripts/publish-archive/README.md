# Canonical publish archive

This folder reads package data, checks it against the pinned source manifest
except version, and stages exactly those bytes into an empty publish directory.
It executes no package/helper/lifecycle code and owns no credential or effect.

archive.cjs copies the canonical archive and source-manifest units from
footprintjs/foottrace commit3f4bbb6bd44e1046ab769a337a954e700bff4cad,
scripts/release-archive.cjs. The unrelated artifact-ZIP reader is omitted.
The format limits and strict header/gzip checks stay unchanged. The closed
AgentFootprint member policy additionally admits ai-instructions/, bin/ and its
known AGENTS.md, CAPABILITIES.md and canonical-notes.json roots. Manifest parsing
is delayed until all members pass; a bad root path fails archive-path first.
Missing/non-string/wrong planned versions fail manifest-version explicitly.
No PAX, prefix, long-path or other format extension is enabled.

verify.cjs is the native data-only adapter. It rejects symlinks and nonempty
output directories, writes the inspected buffer once as package.tgz, and emits
only fixed fields/refusal names. The publishing shell runs npm in that separate
directory; artifact siblings cannot become project config. Ordinary stable
keeps npm's implicit latest; only canonical RC uses next. Shared package
distribution remains deferred until after AgentFootprint14.

The native verifier uses closed CODE limits of 20,000 members and 128 MiB expanded
data for both build and publish, preserving headroom above the current package.
The compressed-input limit remains 16 MiB. Boundary controls admit 20,000/refuse
20,001 members and refuse expansion above 128 MiB; format rules stay unchanged.
