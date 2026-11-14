import { copyJson, jsonBytes } from '../../../lib/boundedJson.js';
import { throwIfAborted, untilAborted } from '../../../lib/abort.js';
import type { ToolArtifacts } from '../../../artifacts/capability.js';
import type { Tool, ToolExecutionContext } from '../../../tools/tools.js';
import {
  sourceEvidenceDescriptor,
  type ResolvedSourceEvidenceOptions,
} from '../../../tools/sourceEvidence.js';
import type { SourceEvidenceAccess } from '../../../tools/sourceEvidenceAccess.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceIndex,
  SourceEvidenceFindArgs,
  SourceEvidenceReadArgs,
} from '../../../artifacts/sourceEvidence/types.js';
import {
  SOURCE_EVIDENCE_KIND,
  sourceEvidenceProjection,
} from '../../../artifacts/sourceEvidence/guards.js';
import { sameSourceValue } from '../../../artifacts/sourceEvidence/datasets.js';
import { withSourceEvidenceDeadline } from './deadline.js';
import { runSourceEvidenceFlow } from './flow.js';
import { readSourceCandidate, readSourceDataset, unavailableSourceEvidence } from './read.js';
import { SourceEvidencePolicyHalt } from './permissions.js';
import { findArgs, readArgs } from './requests.js';

export interface SourceEvidenceAccessBindings {
  readonly options: ResolvedSourceEvidenceOptions;
  readonly artifacts: ToolArtifacts;
  readonly index: () => SourceEvidenceIndex | undefined;
  readonly currentProducer: (name: string) => Tool | undefined;
  /** Current native metadata/capability check; source-scope authority remains mandatory admit's job. */
  readonly permit: (
    candidate: SourceEvidenceCandidate,
    context: ToolExecutionContext,
  ) => Promise<boolean>;
  readonly active: () => boolean;
}

/** Scope alone is not fresh authorization. Every candidate crosses native and host admission again. */
export function createSourceEvidenceAccess(
  bindings: SourceEvidenceAccessBindings,
): SourceEvidenceAccess {
  const { options, artifacts } = bindings;
  async function retainedNow(candidate: SourceEvidenceCandidate, context: ToolExecutionContext) {
    if (!bindings.active() || !bindings.index()?.refs.includes(candidate.ref)) return false;
    const meta = await untilAborted(artifacts.head(candidate.ref), context.signal);
    throwIfAborted(context.signal);
    return meta?.kind === SOURCE_EVIDENCE_KIND && meta.createdAt === candidate.recordedAt;
  }
  async function admitted(
    ref: string,
    index: SourceEvidenceIndex | undefined,
    context: ToolExecutionContext,
  ) {
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
  const bounded = (value: unknown) =>
    jsonBytes(value) <= options.limits.maxResponseBytes ? value : unavailableSourceEvidence();

  return {
    async find(value, originalContext) {
      try {
        return await withSourceEvidenceDeadline(
          originalContext,
          options.limits.timeoutMs,
          async (context) => {
            let args: SourceEvidenceFindArgs,
              index: SourceEvidenceIndex | undefined,
              offset = 0;
            const candidates: SourceEvidenceCandidate[] = [];
            let scanned = 0,
              more = false,
              total = 0,
              withheld = false;
            await runSourceEvidenceFlow(context, [
              {
                id: 'validate-source-query',
                run() {
                  args = findArgs(value);
                  index = bindings.index();
                  total = (index?.refs.length ?? 0) + (index?.omitted ?? 0);
                  if (!Number.isSafeInteger(total)) throw new Error('Unavailable source cursor.');
                  if (args.cursor !== undefined) {
                    const [, previousTotal, previousOffset] = args.cursor.split(':').map(Number);
                    if (
                      !Number.isSafeInteger(previousTotal) ||
                      !Number.isSafeInteger(previousOffset) ||
                      previousTotal! > total ||
                      previousOffset! > previousTotal! ||
                      previousOffset! > 128
                    )
                      throw new Error('Unavailable source cursor.');
                    const position = previousOffset! + total - previousTotal!;
                    if (!Number.isSafeInteger(position))
                      throw new Error('Unavailable source cursor.');
                    if (position > (index?.refs.length ?? 0))
                      throw new Error('Unavailable source cursor.');
                    offset = position;
                  }
                },
              },
              {
                id: 'read-and-admit-retained-sources',
                async run() {
                  const refs = index?.refs ?? [],
                    limit = args.limit ?? 20;
                  while (
                    offset < refs.length &&
                    scanned < options.limits.maxScanned &&
                    candidates.length < limit
                  ) {
                    const ref = refs[offset++]!;
                    scanned++;
                    const candidate = await admitted(ref, index, context);
                    if (
                      !candidate ||
                      !sameSourceValue(candidate.subject, args.subject) ||
                      (args.operation !== undefined && candidate.operation !== args.operation) ||
                      (args.scope !== undefined && !sameSourceValue(candidate.scope, args.scope))
                    )
                      continue;
                    const trial = {
                      historical: true,
                      candidates: [...candidates, candidate],
                      shown: candidates.length + 1,
                      complete: false,
                      nextCursor: `se1:${total}:${offset}`,
                    };
                    if (jsonBytes(trial) > options.limits.maxResponseBytes) {
                      if (candidates.length === 0)
                        throw new Error('Source candidate exceeds response bound.');
                      offset--;
                      withheld = true;
                      break;
                    }
                    candidates.push(candidate);
                  }
                  more = offset < refs.length;
                },
              },
              {
                id: 'bound-retained-source-page',
                async run() {
                  throwIfAborted(context.signal);
                  for (const candidate of candidates)
                    if (!(await retainedNow(candidate, context)))
                      throw new Error('Unavailable retained source.');
                },
              },
            ]);
            return bounded({
              historical: true,
              candidates,
              shown: candidates.length,
              complete: !more && !withheld && (index?.omitted ?? 0) === 0,
              ...(more ? { nextCursor: `se1:${total}:${offset}` } : {}),
            });
          },
        );
      } catch (error) {
        if (error instanceof SourceEvidencePolicyHalt) throw error;
        return unavailableSourceEvidence();
      }
    },
    async read(value, originalContext) {
      try {
        return await withSourceEvidenceDeadline(
          originalContext,
          options.limits.timeoutMs,
          async (context) => {
            let args: SourceEvidenceReadArgs, candidate: SourceEvidenceCandidate | undefined;
            let result: unknown = unavailableSourceEvidence();
            await runSourceEvidenceFlow(context, [
              {
                id: 'validate-issued-source-ref',
                run() {
                  args = readArgs(value);
                },
              },
              {
                id: 'recheck-current-source-admission',
                async run() {
                  candidate = await admitted(args.ref, bindings.index(), context);
                },
              },
              {
                id: 'read-permitted-source-value',
                async run() {
                  if (!candidate) return;
                  if (args.dataset === undefined) {
                    result = { historical: true, receipt: candidate };
                    return;
                  }
                  const dataset = candidate.datasets?.find((item) => item.key === args.dataset);
                  if (!dataset) return;
                  result = await readSourceDataset(
                    artifacts,
                    candidate,
                    dataset,
                    args,
                    options.limits.maxResponseBytes,
                    context.signal,
                  );
                },
              },
              {
                id: 'bound-historical-source-response',
                async run() {
                  throwIfAborted(context.signal);
                  if (candidate && !(await retainedNow(candidate, context)))
                    result = unavailableSourceEvidence();
                },
              },
            ]);
            return bounded(result);
          },
        );
      } catch (error) {
        if (error instanceof SourceEvidencePolicyHalt) throw error;
        return unavailableSourceEvidence();
      }
    },
  };
}
