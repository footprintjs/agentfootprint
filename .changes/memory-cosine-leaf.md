---
type: internal
---
Move the shared cosine calculation into a neutral leaf so memory stores and embedding stages have one dependency direction, keeping its calculation and public memory export unchanged.
