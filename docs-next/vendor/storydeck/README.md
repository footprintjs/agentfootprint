# StoryDeck documentation dependency

The docs walkthrough uses the local StoryDeck **0.2.0** `LiveSlideDeck` API.
That version was unavailable from the public npm registry when this archive was
prepared on 2026-09-15. The docs therefore install the checked-in tarball, with
its integrity recorded in `docs-next/package-lock.json`. This is a local snapshot,
not an npm release or a claim that its changes are committed upstream.

- Source repository: https://github.com/footprintjs/storydeck
- Source checkout: `code-explanation/packages/storydeck`, from the local
  `2026-09-11/cn-a/outputs` workspace.
- Git HEAD: `246d187467d8ca9d20e94b9901f5ad06faf104f9` (the committed 0.1.0 baseline).
- Working tree: **dirty**; the reviewed 0.2.0 live runtime, React adapter,
  declarations, exports and related changes were present but uncommitted.
- Archive SHA-256:
  `32bf0578756860b562353b79c9afbb43d606a9ee16cc6aade9b06c9516aaef8e`.
- License: **MIT**, as declared by the source package. Its source checkout omitted
  a license file; packaging staging adds the standard MIT text under `LICENSE`,
  with the package's declared author, Sanjay Krishna Anbalagan. Upstream source
  files were not changed.

The snapshot was made with Node 22.16.0 / npm 10.9.2: `npm pack --ignore-scripts`
from that working tree, extract into a separate staging directory, add `LICENSE`,
then `npm pack --ignore-scripts` from staging. All other packed file bytes match
the first archive. Only the package's declared library files, README, manifest
and license are included: no repository history, local site, tests, environment
files, dependency directory, recordings or private data fixtures.

To reproduce installation, use `npm ci` in `docs-next`; no access to the source
checkout is required. To reproduce the archive bytes with the same npm version,
extract this archive into an empty directory and run `npm pack --ignore-scripts`
from its `package` directory. A future source update must replace the archive,
update this provenance and refresh the lockfile together.
