---
type: breaking
---
**Require the new engine and raise the minimum Foottrace version.** The previous
engine major and the first release of the current Foottrace major fall outside
the supported ranges.

Migration: select a supported `footprintjs` version and a `foottrace` version
that satisfies its peer dependency. For prerelease testing, pin the engine
candidate explicitly. Regenerate the application lockfile with strict peer
resolution and run the consumer checks. The application and engine must
resolve one physical Foottrace package image; matching version strings alone are
insufficient.

The native record now retains explicit read-window commit counts where a step
observed state before a sibling committed. Record readers must preserve `beganAt`
and `sawUntil`; these are commit-count boundaries rather than wall clocks. Do not
date such reads at the later commit or discard the new provenance fields.
