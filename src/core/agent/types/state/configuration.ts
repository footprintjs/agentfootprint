import type { OntologyRecord } from '../../../../ontology/types.js';

export interface ConfigurationState {
  // ── The declared ontology (`.ontology()`) ──────────────────────
  /**
   * The declared map, on the record (9.106.0) — a RUN CONSTANT written
   * ONCE by `stages/seed.ts` on every run of an agent built with
   * `.ontology(map)`: the ontology's `id`, `version` and `hash` (the
   * identities the served event carries) and the WHOLE `spec`, so the piece
   * the model is served (`ontology/serve.ts · ontologyPiece`), the rebuild
   * (`servedView.ts · viewOf`, through `readRunConstant`) and a lens need
   * nothing but the record. Absent for every other agent, which is what
   * keeps `seed`'s committed key set unchanged for them (the
   * `findingsServe` shape). Never written again during a run — the map is
   * declared, not learned.
   */
  ontology?: OntologyRecord;

  // ── Per-run configuration (`.configure()`) ─────────────────────
  /** The model `.configure()` resolved for THIS run, written by seed and read
   *  by CallLLM. Present only when a resolver returned one — a run that did
   *  not change its model records nothing here, so an agent without
   *  `.configure()` commits exactly what it always did. The point of writing
   *  it at all is that the trace must say which model actually answered:
   *  a run that switched models without recording it would be a trace that
   *  lies about its own most expensive fact. */
  resolvedModel?: string;
  /** The base system prompt `.configure()` resolved for THIS run, replacing
   *  `.system(...)`. Same rule: absent unless a resolver returned one. */
  resolvedInstructions?: string;
}
