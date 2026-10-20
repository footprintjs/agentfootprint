# Legacy layout witness

`layout-legacy-10.9.0.json.gz` contains one synthetic three-request run and the
served views captured from the actual published baseline package. The manifest
pins the archive used for that capture and both raw and compressed fixture
hashes. No customer data, credentials, network calls or paid model were used.
`layout-legacy.test.ts` bounds decompression and compares every rebuilt view to
the stored baseline, without removing fields or normalizing the output.

To create another witness from a separately installed baseline package:

```sh
node test/core/agent/findings/fixtures/capture-legacy.mjs /path/to/node_modules/agentfootprint /tmp/new-legacy-witness
```

The output folder must not exist. Each new run has fresh engine identities, so
its hashes will differ; review any replacement fixture and its new manifest.
