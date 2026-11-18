# Lens snapshot for the AgentFootprint 15 train

The docs install the original Lens package from source commit
[`a37c7e63ee84bfe37dcbc80cfe8266896705b2d6`](https://github.com/footprintjs/agentfootprint-lens/commit/a37c7e63ee84bfe37dcbc80cfe8266896705b2d6).
[Lens CI run 44242737338, attempt 1](https://github.com/footprintjs/agentfootprint-lens/actions/runs/44242737338)
produced these exact bytes in [artifact 14400007902](https://github.com/footprintjs/agentfootprint-lens/actions/runs/44242737338/artifacts/14400007902).
The tarball SHA-256 is `08315dd1e3aa98b2e7b5c9742c0778767584c4249f57462aa4022f16872d7022`.
The docs lock records its npm integrity. The engine, reader and renderer come from npm.

Remove the archive when a published Lens accepts the planned AgentFootprint release
and the docs' locked FootPrint 14, Foottrace 2, renderer and other peers. The docs CI
check reports the compatible release. Switch to that npm release, regenerate the
docs lock, and remove this directory and the CI step that calls its check.
