# Candidate docs dependencies

PR #383 builds the docs against the original Lens package from reviewed commit
`fcd9fbc3`, AgentFootprint from `37985a9c`, and the UI from PR #64
(`0af1a2d0`). The engine and reader come from npm at `14.0.0-rc.0` and
`2.1.0`. The normal development checkout still links AgentFootprint via
`file:..`.

The docs CI job opens a temporary checkout of its tested commit. It fetches the
three original archives by the artifact IDs in `pins.json`, verifies their
producer runs, trees and digests, and copies the selected package tarballs into
that checkout. If an archive is unavailable the check fails. The coordinator can
identify the retained original from the producer run and digest.

`lock-delta.json` contains the dependency rows npm changed when resolving the
five exact inputs. Applying it to the committed docs lock must reproduce the
complete npm lock byte for byte. The docs job runs a strict `npm ci` including
Fumadocs postinstall. It compares both installed lockfiles, file contents and
engine/reader resolution against the original packages before running the
Try-it demo, static export, generated-page comparison and existing site budgets.
The Node 24 source job compares its ordinary AF package to the admitted tarball.

Every output stays in the disposable checkout. The final step removes it and
checks the original checkout, manifests, lock and StoryDeck archive. This
candidate check is scoped to the same-repository PR. Once published versions
are available the normal docs manifest and lock can select them independently.
