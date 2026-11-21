---
type: fixed
---
A typed run with negative claims no longer leaves a stream open under deferred delivery. A failed run delivers its terminal error even with explicit summary capture. If a native emit is delivered as a summary, the run's observer statistics now report it separately from queue overflow.
