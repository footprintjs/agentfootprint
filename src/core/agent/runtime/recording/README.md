**Trace** — `recording.ts` attaches the existing recorder and files its finished run.

The supplied runner is the original native runner; the supplied invocation
owns event membership, finalizers and the finished identity. Configuration
does not select a run. Registration order remains stop, file, then component
cleanup, so native reverse finalization cleans up, files, then detaches.

An unfinished or paused turn files nothing. A store refusal emits the existing
artifact refusal and preserves the answer. The saved recording precedes its
own mint event. `recording.test.ts` keeps the existing resource-finalization
scenario beside this owner; broader artifact-store tests remain in `test/artifacts`.
