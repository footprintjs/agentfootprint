**Support** — the packed recording’s existing JSON member-reading law.

`walk.ts` owns the single `SKIP` sentinel, normalization, boxed-primitive probes
and array/object member reads. It applies `toJSON`, the canonical
[wire rule](../../../lib/wireJson.ts), then the existing primitive/omission rules.
The optional work counter counts every visited index or own enumerable key.

The [facade](../recordingPack.ts) imports this sealed child. Its public types,
constants and error constructors, reference/escape format, pooling, unpacking,
UTF-8 expansion bounds and own-property assignment retain their original owners.
The child depends only on the canonical wire rule and has no facade return edge.

This is step 1 / Stage A: whole existing units moved with their comments and
blank lines intact. Both production files are within the 600-line limit.
Normalization order, receiver identity, reads, omissions and refusals are unchanged.

Adjacent `walk.test.ts` pins the member-reading behavior. The
[existing public tests](../../../../test/recorders/observability/recordingPack.test.ts)
cover wire-byte roundtrips, marker escaping, canonical errors, shared references,
reader integration, counted work and expansion refusal before decoding.
The scalar JSON sizing allowance stays with `jsonString` in the facade.
