# Published pause writer

The completed hosted producer installed the exact public 14.1.1 package with a
normally generated strict registry lock, then used its real Agent API and an
inert provider/tool to write one native checkpoint. Run 42290829176, attempt 1,
job 128143503581 produced artifact 13538959063. The producer is now removed and
is not rerun by these tests. This was not a model call, application run or release.

The checkpoint bytes and normal lock are unchanged from that artifact. The
committed manifest is explicitly marked `PORTABLE_PUBLISHED_NATIVE_WRITER_FIXTURE`:
its three `packageRoot` values retain their repository-relative suffix instead
of the captured runner-specific prefix. No version, registry URL, integrity,
entry hash, clock, range field or effect count changed. Its `projection` records
the source artifact/run/attempt and raw manifest SHA256
`6b5c14c04f9818b6c1caabb561e4b6bd617243c92828b58f78149e345b3008cc`.
The raw manifest remains in that artifact and the parent commit 44897797; this
portable projection is not represented as the raw writer output. The native
compatibility test independently pins the unchanged checkpoint, portable
manifest, normal lock and original writer source. The existing machine-path
guard and its allow-list remain unchanged.

The 12.3.0 fixture remains separate and unchanged.
