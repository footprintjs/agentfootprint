# ContextFootprint dependency

This reviewed archive was built from ContextFootprint commit `5755eb072d19dae4948cc7be3898dc2d43721be4`.
Source repository: https://github.com/footprintjs/contextfootprint.
Version: 0.1.0, private npm package. License and original AgentFootprint attribution
are included in the archive. No npm publication is required for this integration.

Archive: `contextfootprint-0.1.0-5755eb0.tgz`
SHA-256: `a5653cb8d21b37af63a0caf0d612da7eb26571d11ea341c873d105ded9d8fd19`

The manifest pins version 0.1.0. A clean source checkout installs the reviewed
archive through the tracked lockfile, whose resolved path and integrity are pinned.
Keep that lockfile: regenerating it from the manifest alone would query npm for
the private version. `bundleDependencies` includes the installed shared
runtime in AgentFootprint's npm archive, so a packaged consumer does not resolve
a relative vendor path or an unpublished registry version. Do not remove bundling
without replacing this distribution contract.

To update: verify the chosen ContextFootprint commit, build and pack it, record
the new commit-qualified filename and hash here, and update the dependency and
lockfile. Then run the Agent regression suite and `npm run test:context-package`
after the normal build. This script installs Agent's packed archive offline with
an empty npm cache and checks CJS, ESM and TypeScript resolution.
