**Support** — format one S3 Vectors record key.

`vectorKey.ts` holds the existing key formatting used by `../s3Vectors.ts`.

The law: join the namespace and record id with the existing `#` separator without rewriting either input. Namespace filtering and backend operations stay in the adapter.
