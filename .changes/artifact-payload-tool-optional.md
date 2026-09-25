---
type: changed
---
**`ArtifactMintedPayload.tool` and `ArtifactExpiredPayload.tool` are optional**, as they already were at run time: the run's own recording mint and now a host's filing carry no tool (the precedent `resolved` / `refused` already set). A reader that assumed a string was already reading `undefined` for those events. The commentary line for a tool-less mint now names the app ("The app itself (not a tool) checked …") instead of printing an empty tool name and claiming the model was handed the ticket.
