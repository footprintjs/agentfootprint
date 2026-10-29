---
type: internal
---
**Comments, TSDoc and READMEs now state four guarantees no wider than the code keeps them.** Wording only, no behaviour change: `readOwnList` covers ordinary (non-Proxy) arrays; ignoring `CredentialRequest.signal` is safe on the gateway route, not on a direct `withCredentialRetry` call; after a listing `mcpClient` did not send, a call to a tool it handed out can bypass both of its checks; and a connection of its own still needs the SDK's automatic tool discovery off.
