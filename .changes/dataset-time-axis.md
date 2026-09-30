---
type: added
---
**Declare which column of a dataset is time.** `put` (and `stageDatasetArtifacts`)
accept `timeAxis`: the time column, its unit (`'iso'`, `'epoch-s'`, `'epoch-ms'`),
an IANA zone for wall-clock ISO values, and how each row summarises its interval
(`interval: '1h'`, `aggregate: 'avg'` or per measure `{ avg_iops: 'avg', peak_iops: 'max' }`,
or `'raw'`). It rides `ArtifactMeta.timeAxis` through every store and the
`artifacts.minted` event, so a viewer draws a time series without guessing.
`readTimeAxis(meta)` reads it and `describeTimeAxis(axis)` gives the shared title
wording ("hourly avg and max"). A malformed declaration is refused at mint, never
repaired. `sqliteArtifacts` adds its new column in place on an existing file.
Undeclared datasets are unchanged.
