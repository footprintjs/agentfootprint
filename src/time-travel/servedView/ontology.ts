import { ontologyPiece } from '../../ontology/serve.js';
import type { OntologyRecord } from '../../ontology/types.js';
import type { EpochLocation } from '../epochs.js';
import { readAtCall, readRunConstant } from './recordReads.js';

/**
 * The declared ontology `seed` put on the record (`ontology`, 9.106.0),
 * narrowed the way every run constant is: only a record carrying a `spec`
 * with `nodes` and `sources` records composes a piece, and an absent key —
 * every agent without `.ontology()` — composes nothing, which is what the
 * wire did (`callLLM.ts · buildCallLLMStage`, under `deps.ontology`).
 */
function ontologyOf(
  value: unknown,
): { spec: OntologyRecord['spec']; tools?: OntologyRecord['tools'] } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const { spec, tools } = value as { spec?: unknown; tools?: unknown };
  if (spec === null || typeof spec !== 'object') return undefined;
  const { nodes, sources } = spec as { nodes?: unknown; sources?: unknown };
  if (
    nodes === null ||
    typeof nodes !== 'object' ||
    sources === null ||
    typeof sources !== 'object'
  ) {
    return undefined;
  }
  // The tool → skills join (9.108.0), taken as the record holds it — a
  // record without the key (9.106.0, or a map naming only static tools)
  // composes the bytes it always did.
  const join = toolsJoinOf(tools);
  return { spec: spec as OntologyRecord['spec'], ...(join !== undefined && { tools: join }) };
}

/** `tools` narrowed by shape: string → string[]; anything else is no join. */
function toolsJoinOf(value: unknown): OntologyRecord['tools'] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, readonly string[]> = {};
  for (const [name, ids] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
      out[name] = ids as string[];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Rebuild the declared ontology under the recorded hidden-skill selection. */
export function ontologyAt(
  location: EpochLocation,
  served: boolean,
): ReturnType<typeof ontologyPiece> | undefined {
  // ── the declared ontology, served (9.106.0) ────────────────────────────
  // The SAME pure function the stage used, over the run constant `seed`
  // wrote (the `findingsServe` precedent — a build-time fact read from the
  // RECORD, never from the receipt this view is checked against). No
  // `.ontology()` ⇒ no key ⇒ no piece, and the rebuild is the bytes it
  // always was.
  const ontologyRecord = ontologyOf(readRunConstant(location, 'ontology', served));
  // The hidden skill ids the call was composed under (9.108.0) — a per-epoch
  // key the Injection Engine's mount publishes, read at the call as the stage read it.
  const hiddenAtCall = readAtCall(location, 'hiddenSkillIds', served) as
    | readonly string[]
    | undefined;
  const ontology =
    ontologyRecord === undefined
      ? undefined
      : ontologyPiece(ontologyRecord.spec, {
          ...(ontologyRecord.tools !== undefined && { tools: ontologyRecord.tools }),
          ...(hiddenAtCall !== undefined && { hiddenSkillIds: hiddenAtCall }),
        });
  return ontology;
}
