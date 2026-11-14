import type { Watcher } from '../../watch.js';

/**
 * Refuse two DIFFERENT observers that share one id (8.13.0).
 *
 * footprintjs de-duplicates attached recorders by id — `attachScopeRecorder` and
 * `attachFlowRecorder` both `filter(r => r.id !== recorder.id)` before pushing —
 * so of two objects carrying one id, only the LAST ever fires. The first is
 * removed before the run starts and reports nothing at all, which is
 * indistinguishable from an observer whose events simply never happened.
 *
 * Keyed on OBJECT IDENTITY, not on the id alone. Handing the same reference to
 * `.watch()` twice is
 * harmless and stays one attachment — the fp dedupe is doing exactly what it is
 * for. It is two DIFFERENT observers under one name that loses a whole observer.
 *
 * Deliberately does NOT reserve the `agentfootprint.` id prefix: the factories in
 * `agentfootprint/observe` carry ids in that namespace and consumers are meant to
 * `.watch()` them.
 */
function assertNoCollidingObserverIds(observers: readonly Watcher[]): void {
  const byId = new Map<string, Watcher>();
  for (const observer of observers) {
    const id = observer.id;
    const seen = byId.get(id);
    if (seen === undefined) {
      byId.set(id, observer);
      continue;
    }
    if (seen === observer) continue; // same reference — one attachment, by design
    throw new Error(
      `AgentBuilder.watch: two different observers were given the id '${id}'. Only the LAST ` +
        `one ever fires — footprintjs de-duplicates attached recorders by id, so the earlier ` +
        `one is dropped before the first run and reports nothing. Rename one of them; passing ` +
        `the SAME object twice is fine (it stays one attachment).`,
    );
  }
}

export { assertNoCollidingObserverIds };
