---
type: fixed
---
**Privacy-hidden request fields stay uncertain when a native safe replay base is present.** Saved request views now carry a distinct `privacy-policy` caveat from the recording's positive policy marker. Empty reconstructed system, message and tool values do not establish that the request contained nothing. The native snapshot is forwarded unchanged, including older engines' absent bases and newer engines' safe bases; `no-fold-base` continues to mean an actually missing fold base. Public retained values and stored receipt hashes remain unchanged.
