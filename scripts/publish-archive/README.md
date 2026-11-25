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

`tarReader.cjs` now owns that single bounded gzip/USTAR/member walk. The AF
`inspectArchive` facade keeps its existing source comparison, JSON treatment,
member policy, configurable native bounds, report and refusal codes. Header
units and the CRC law were moved unchanged; no second parser is introduced.
`archivePolicy.cjs` keeps the existing refusal identities and the closed code
policies. AF's default does not inherit any dependency-only member allowance.

## Published dependency data

`publishedDependency.cjs` exports
`inspectPublishedDependency(bytes, {name, version, integrity})` for exactly the
published FootPrint 14.0.0, Foottrace 2.3.2 and ContextFootprint 0.1.1 inputs.
The engine is pinned to the exact published version. The policy refuses
prereleases and other stable versions. This dependency profile
keeps the authored AgentFootprint source version and the default AgentFootprint
archive policy.
It accepts no caller profile, root, limit or command. The fixed dependency
bounds are 16 MiB compressed, 64 MiB expanded and 10,000 members. A bounded
owned copy of the original input must match its selected canonical SHA512 SRI
BEFORE gzip/manifest decoding. No package code, setup or lifecycle runs.

All three use the same closed header/path reader. Native dependencies retain
their known metadata/dist roots; Context additionally permits CHANGELOG.md,
NOTICE and examples/, and only its observed inert
`publishConfig: {access: 'public', registry: 'https://registry.npmjs.org/'}`.
Those values are retained data, never publishing/installation instructions.
Setup members, links, duplicate paths, file/directory and case collisions,
traversal, PAX/GNU, extra gzip members and trailing bytes remain refused.
AF's publication facade still refuses Context-only roots and publishConfig.

The dependency-only `strictJson.cjs` reuses Ho's bounded structural JSON unit
from `consumer-source-cohort-20261116/repo/scripts/publish-release/archive/strict-json.cjs`,
SHA256 `30be8b6addaffccaa6093e70e29114eb44e59b1a66d285a1c9befa75613363f7`;
only the local refusal-owner import changes. It preserves the 1 MiB, depth-64
and 100,000-value bounds and refuses decoded duplicate keys and malformed UTF8.
The old AF manifest parser is unchanged.

The result contains `manifest`, package/version, raw archive SHA256/SHA1/SRI
and byte count, plus the full `files` inventory of package-prefixed path, size
and SHA256. Installed member equality belongs to the four-root verifier; SRI
selection proves neither source-commit identity nor runtime compatibility.
Inert fixtures do not establish actual fit of the three published archives.
Run only the data fixtures with
`node --test scripts/publish-archive/publishedDependency.test.mjs`.

verify.cjs is the native data-only adapter. It rejects symlinks and nonempty
output directories, writes the inspected buffer once as package.tgz, and emits
only fixed fields/refusal names. The publishing shell runs npm in that separate
directory; artifact siblings cannot become project config. Ordinary stable
keeps npm's implicit latest; only canonical RC uses next. Shared package
distribution remains deferred until after AgentFootprint14.

The native verifier uses closed CODE limits of 20,000 members and 128 MiB expanded
data for both build and publish, preserving headroom above the current package.
The compressed-input limit is 32 MiB, checked before reading and passed to the
canonical parser. Independent stored-block gzip data admits 32 MiB minus one byte
and exactly 32 MiB, and refuses one byte above it. Member and expansion controls
admit 20,000/refuse 20,001 members and refuse expansion above 128 MiB. Format rules
stay unchanged. The actual directory setup is checked under umask 000 for mode 0700. A real offline npm pack keeps a hostile prepare lifecycle active as a
counterfactual and verifies suppression at the production npm 11 floor; npm 10
is retained as its distinct old-toolchain behavior.

## Source candidate for downstream checks

Which commit the evidence is bound to: a pull request run tests the merge of its
head into main. When the head already contains main, the tested tree is the
head's tree and the artifacts carry the head commit's name
(`agentfootprint-source-<head>`). When the pull request is behind main, they
carry the tested merge commit's name instead, because the package is not the
head's tree. To find them then, list the run's artifacts by prefix and read
`candidate.json`, or update the branch to get an artifact under the head's name.

The ordinary CI package job retains one separate offline/scripts-off pack after
its native package checks succeed. `candidate.cjs` reuses the canonical verifier,
requires the tested tree to equal the requested source head's tree, rejects dirty
tracked source, and binds the original manifest and lock bytes to Git. Every
archive member must match its actual source/build file. It writes `candidate.json`
with the source/tested identities, archive SHA256/SHA1/SRI and every member hash,
plus the original source manifest and lock. It never relabels or rewrites a pack.

The pinned upload contains that original tarball and those records. Consumers
must admit its exact successful run, artifact and bytes before their own strict
native installs; a source candidate is neither a registry publication nor proof
that a downstream library is compatible. In particular, this does not turn the
ordinary registry context control into the four-root strict paired contract.
The context runner still owns and removes its separate temporary inner archive.

Run the data-only identity/refusal fixtures with
`node --test scripts/publish-archive/candidate.test.mjs`. They execute no archive
code, package manager, install or build.
