# The recordings bench — does a recording grow with the run, or with its square?

A mock-provider agent calls one tool K times; every call returns R rows (default 1,000). The bench
reports, for each K, what the recording holds and what keeping it costs. Counts, not times — the run
time is printed for orientation only. No paid calls.

```text
$ npm run build && npm run bench:recordings
$ KS=10,20,40,80,100 ROWS=1000 npm run bench:recordings
```

Linear means four times the iterations cost about four times. Measured with R = 1,000:

| K | events (default cap) | dropped | first iteration kept | plain recording | packed recording | packer reads |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 266 | 0 | 1 | 67 MB | 1.27 MB | 150,266 |
| 20 | 716 | 0 | 1 | 223 MB | 2.60 MB | 327,835 |
| 40 | 2,216 | 0 | 1 | 808 MB — past JSON's string limit | 5.56 MB | 785,385 |
| 80 | 7,616 | 0 | 1 | past the limit | 12.64 MB | 2,109,909 |
| 100 | 11,516 | 0 | 1 | past the limit | 16.76 MB | 2,976,351 |

Before the change (the release it was cut from): the plain recording was the only one; at K = 100
the default 10,000-event cap dropped 1,516 events and the recording opened at iteration 34.

**Reading the columns.**

- *plain → packed.* The plain recording repeats each result once per place that saw it (each
  iteration's slot subflows, the boundary log's subflow input and output, `iteration_end`, every
  re-announcement), so it grows ~K²·R — 3.3× from K = 10 to 20, 3.6× from 20 to 40. Packed, each
  value is written once: 4.4× from K = 10 to 40, 4.9× from 20 to 80.
- *packer reads* (`packCounted`, every member value read on both passes): 5.2× from K = 10 to 40,
  6.4× from 20 to 80. Not 4×: the in-memory recording really holds each iteration's own context
  records (one per history message, rewritten every call — equal content, new objects) and every
  re-announcement's envelope. Packing writes them once; it has to read them to find them equal.
- *events.* Every call re-announces its context, so the stream still grows with K², but a repeat
  holds no slot under the cap (`src/events/eventTail.ts`), so a long run keeps its start.

The receipt mint's work (SHA-256 input and UTF-8 encoding per call) needs a hook into the hash that
the built package does not expose, so it is counted in
`test/lib/time-travel/receipt-incremental.test.ts`. Measured on the same runs through that hook:

| K | SHA-256 input — before | after | per call, last — before | after | receipt share of run — before | after |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.99 MB | 0.36 MB | 362 KB | 37 KB | 24% | 7% |
| 20 | 7.65 MB | 0.73 MB | 733 KB | 37 KB | 35% | 5% |
| 40 | 30.1 MB | 1.48 MB | 1,475 KB | 37 KB | 48% | 4% |
| 80 | 119.5 MB | 2.96 MB | 2,959 KB | 37 KB | 45% | 4% |
| 100 | 186.5 MB | 3.70 MB | 3,702 KB | 38 KB | 51% | 3% |

37 KB is one 1,000-row tool result: each call hashes what it added.
