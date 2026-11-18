import { copyJson } from '../../../lib/boundedJson.js';
import { throwIfAborted, untilAborted } from '../../../lib/abort.js';
import type { ToolArtifacts } from '../../../artifacts/capability.js';
import type { Tool } from '../../../tools/tools.js';
import type { SourceEvidencePreparationContext } from '../../../tools/sourceEvidence.js';
import { sourceEvidenceDescriptor } from '../../../tools/sourceEvidence.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceIndex,
  SourceEvidenceLimits,
  SourceEvidenceProjection,
} from '../../../artifacts/sourceEvidence/types.js';
import {
  SOURCE_EVIDENCE_KIND,
  sourceEvidenceProjection,
} from '../../../artifacts/sourceEvidence/guards.js';
import { sameSourceValue } from '../../../artifacts/sourceEvidence/datasets.js';
import { readSourceCandidate } from './read.js';

export interface SourceAdmissionBindings<C extends SourceEvidencePreparationContext> {
  readonly options: {
    readonly limits: Readonly<Required<SourceEvidenceLimits>>;
    readonly admit: (
      candidate: SourceEvidenceCandidate,
      context: C,
    ) => SourceEvidenceProjection | undefined | Promise<SourceEvidenceProjection | undefined>;
  };
  readonly artifacts: ToolArtifacts;
  readonly index: () => SourceEvidenceIndex | undefined;
  readonly currentProducer: (name: string) => Tool | undefined;
  readonly permit: (candidate: SourceEvidenceCandidate, context: C) => Promise<boolean>;
  readonly active: () => boolean;
}

/** The same integrity, producer, native permission and host privacy fence for every reader. */
export function createSourceAdmission<C extends SourceEvidencePreparationContext>(
  bindings: SourceAdmissionBindings<C>,
) {
  const { options, artifacts } = bindings;
  async function retainedNow(candidate: SourceEvidenceCandidate, context: C) {
    if (!bindings.active() || !bindings.index()?.refs.includes(candidate.ref)) return false;
    const meta = await untilAborted(artifacts.head(candidate.ref), context.signal);
    throwIfAborted(context.signal);
    return meta?.kind === SOURCE_EVIDENCE_KIND && meta.createdAt === candidate.recordedAt;
  }
  async function admitted(ref: string, index: SourceEvidenceIndex | undefined, context: C) {
    throwIfAborted(context.signal);
    if (!bindings.active()) return undefined;
    const candidate = await readSourceCandidate(
      artifacts,
      index,
      ref,
      options.limits.maxReceiptBytes,
      context.signal,
    );
    if (!candidate) return undefined;
    const current = bindings.currentProducer(candidate.producer.name);
    if (
      !current ||
      current.source !== candidate.producer.source ||
      !sourceEvidenceDescriptor(current)
    )
      return undefined;
    if (!(await untilAborted(bindings.permit(candidate, context), context.signal)))
      return undefined;
    const supplied = await untilAborted(
      Promise.resolve().then(() => options.admit(candidate, context)),
      context.signal,
    );
    throwIfAborted(context.signal);
    if (supplied === undefined || !bindings.active()) return undefined;
    const projection = sourceEvidenceProjection(candidate, supplied);
    const retained = await readSourceCandidate(
      artifacts,
      bindings.index(),
      ref,
      options.limits.maxReceiptBytes,
      context.signal,
    );
    throwIfAborted(context.signal);
    if (!retained || !sameSourceValue(retained, candidate) || !bindings.active()) return undefined;
    return copyJson(
      {
        ...projection,
        ref: candidate.ref,
        producer: candidate.producer,
        recordedAt: candidate.recordedAt,
        ...(candidate.origin !== undefined && { origin: candidate.origin }),
      },
      options.limits.maxReceiptBytes + 2048,
      true,
    ) as SourceEvidenceCandidate;
  }
  return { admitted, retainedNow };
}
