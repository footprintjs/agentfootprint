---
type: added
---
**Distinguish retrieval timeouts from empty searches.** Memory and RAG accept outcome-aware store reads. The answer warning can explain a recorded timeout or selection limit when the run proves that no recalled content reached a model request. Successful empty searches preserve the ordinary answer. Set `recording: 'ids-only'` for RAG, semantic Top-K or episodic recall to keep identifiers and selection metadata in retrieval evidence while serving the same context to the model.
