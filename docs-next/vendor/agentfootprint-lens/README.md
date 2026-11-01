# Lens source archive for AgentFootprint 13 docs

Published `agentfootprint-lens@0.78.0` accepts AgentFootprint only through version 12.
These docs build against the local AgentFootprint 13 source, so they consume
this separately reviewed, committed Lens source archive with the expanded
peer range. Its source manifest still says 0.78.0. This archive is **different
from npm 0.78.0**; it is a docs-only dependency, not a registry release or a
version rewrite.

- Source: https://github.com/footprintjs/agentfootprint-lens
- Exact commit: `2ceebf9e6b787aa254c38221043eacb561b42b82`
- Tree: `d9544857894d206d19264c6f333005d13b15a874`
- Archive: `agentfootprint-lens-2ceebf9e6b787aa254c38221043eacb561b42b82.tgz`
- SHA256: `511469095a09d64af781340a4388fd8aef8bb5b304716391fa58d7f83415ec51`
- SHA512 integrity: `sha512-FcLF+MHEAEwj34CUPjrsc5+6vXYzXpRi3fYyyhMmrabc61PtPzhbY3aS8FMNkMV7mhFFg1h9S2//DaYe4kmMZg==`
- Build: Node 22.23.4, npm 11.19.0, macOS arm64; normal declared development
  dependency `agentfootprint@10.1.0`, with no temporary local dependency path.

`provenance.json` records the exact published file hashes, source identities,
build inputs and packed compatibility target. `build-lock.json` preserves this
artifact's normal build dependency resolution. It is an artifact receipt;
Lens's repository keeps its own existing cross-platform fresh-install policy.
No workspace paths, source overrides, credentials, installed dependency tree
or private data are shipped in these provenance files.

## Rebuild and pack

From an AgentFootprint checkout, using the recorded Node/npm versions and
build platform, create a separate Lens checkout and use the retained inputs:

```sh
git clone https://github.com/footprintjs/agentfootprint-lens.git ../lens-source
git -C ../lens-source checkout --detach 2ceebf9e6b787aa254c38221043eacb561b42b82
cp docs-next/vendor/agentfootprint-lens/build-lock.json ../lens-source/package-lock.json
cd ../lens-source
npm ci --strict-peer-deps
npm run build
npm pack --ignore-scripts --json
```

The normal npm filename is `agentfootprint-lens-0.78.0.tgz`; only its external
filename is qualified with the source commit when copied into this directory.
The manifest and packed file bytes are not edited. The source commit, input
lock and toolchain bind this build; rebuilds on other platforms or dependency
updates need their own checks and hashes.

For docs installation, `npm ci --strict-peer-deps` in `docs-next` uses this
archive and the integrity in its normal package lock. Compatibility checks use
actual unmodified AgentFootprint 13 source and the existing strict runtime,
record-owner, byte-identity and declaration probes. They do not publish a
package. A future normal compatible Lens npm release can replace this source
archive through an ordinary reviewed dependency update.
