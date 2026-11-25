---
type: fixed
---
**A recording over the invocation limit is refused as over the limit on every Node version.** On Node 22, saving a deep recording with more invocations than the parts layout allows was refused as unserialisable instead of over the limit, because the recording was serialised before its invocations were counted and Node 22's smaller stack overflowed first. The bounds are now decided from the iterative walk's counts before anything is serialised. Opening a hand-filed packed recording, or a packed part, too deep to expand now answers a reason (`invalid-recording`, or `too-large` for a part) instead of throwing a stack overflow. For an account over a parts recording, `maxRecordingBytes` bounds the stored part bytes, not the recording's plain bytes.
