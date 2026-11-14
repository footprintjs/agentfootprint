import type { TypedScope } from 'footprintjs';
import { throwIfAborted, untilAborted } from '../../../lib/abort.js';
import { copyJson } from '../../../lib/boundedJson.js';
import type { Tool, ToolExecutionContext } from '../../../tools/tools.js';
import {
  sourceEvidenceDescriptor,
  type ResolvedSourceEvidenceOptions,
} from '../../../tools/sourceEvidence.js';
import type { ToolResultStatus } from '../../../semantics/toolOutcome.js';
import type { ArtifactMeta } from '../../../artifacts/types.js';
import { readCoverageResult, strip } from '../../../semantics/coverage/read.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import { listsWithoutRecordOnly } from '../../../semantics/coverage/items.js';
import {
  sourceEvidenceDeclaration,
  SOURCE_EVIDENCE_KIND,
} from '../../../artifacts/sourceEvidence/guards.js';
import {
  containsSourceRef,
  containsSourceScalar,
  declaredSourceDatasets,
  sameArtifactMeta,
  sameSourceValue,
} from '../../../artifacts/sourceEvidence/datasets.js';
import type { SourceEvidenceIndex } from '../../../artifacts/sourceEvidence/types.js';
import type { AgentState } from '../types.js';
import { takeSourcePublications, closeSourcePublications } from './publications.js';
import { withSourceEvidenceDeadline } from './deadline.js';

export interface SourceCaptureLanding {
  readonly eligible: boolean;
  readonly status?: ToolResultStatus;
}
export interface NativeSourceCapture {
  (served: unknown, landing: SourceCaptureLanding): Promise<void>;
  /** Detach native publication membership immediately at actual execute return. */
  returned(): void;
  /** A native after-tool denial withdraws this occurrence before retention. */
  withheld(): void;
}

/** Only actual native execution can create this closure; producer callbacks cannot append the index. */
export function nativeSourceCapture(
  scope: TypedScope<AgentState>,
  tool: Tool,
  context: ToolExecutionContext,
  options: ResolvedSourceEvidenceOptions | undefined,
  active: () => boolean,
): NativeSourceCapture | undefined {
  if (!options) return undefined;
  const descriptor = sourceEvidenceDescriptor(tool);
  if (!descriptor || !context.hasArtifacts) return undefined;
  let closed = false;
  let publications: ReadonlyMap<string, ArtifactMeta> | undefined;
  const capture = async (served: unknown, landing: SourceCaptureLanding) => {
    if (closed) return;
    closed = true;
    try {
      await withSourceEvidenceDeadline(context, options.limits.timeoutMs, async (context) => {
        if (
          !landing.eligible ||
          !active() ||
          ['failure', 'denied', 'invalid', 'pending'].includes(landing.status ?? '')
        )
          return;
        throwIfAborted(context.signal);
        let value = served;
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch {
            /* Actual served string. */
          }
        }
        const governed = copyJson(value, 1048576, true);
        const governedStatus = readToolResultEnvelope(governed)?.status;
        if (['failure', 'denied', 'invalid', 'pending'].includes(governedStatus ?? '')) return;
        const status =
          landing.status === 'partial' || governedStatus === 'partial'
            ? 'partial'
            : landing.status ?? governedStatus;
        if (publications === undefined) return;
        const sources = await declaredSourceDatasets(
          descriptor.datasets,
          governed,
          context.artifacts,
          publications,
          context.signal,
        );
        const declarations = await untilAborted(
          Promise.resolve(descriptor.describe(governed, sources)),
          context.signal,
        );
        if (declarations === undefined) return;
        if (!Array.isArray(declarations) || declarations.length > 8) return;
        const visible = readCoverageResult(strip(governed));
        if ((visible?.declared.length ?? 0) > 1) return; // No invented merge of distinct coverage boundaries.
        const boundary = visible?.declared[0];
        for (const raw of declarations) {
          throwIfAborted(context.signal);
          if (!active()) return;
          const declaration = sourceEvidenceDeclaration(raw, options.limits.maxReceiptBytes);
          const authorizedValues = [governed, sources];
          if (
            !authorizedValues.some((value) =>
              containsSourceScalar(value, declaration.subject.value),
            ) ||
            Object.values(declaration.scalars ?? {}).some(
              (scalar) => !authorizedValues.some((value) => containsSourceScalar(value, scalar)),
            )
          )
            throw new Error('Unassociated governed source value.');
          const parents: string[] = [];
          const datasets = [];
          for (const dataset of declaration.datasets ?? []) {
            const authorization = descriptor.datasets?.find((entry) => entry.key === dataset.key);
            const source = sources[dataset.key];
            if (
              !authorization ||
              !source ||
              source.ref !== dataset.ref ||
              authorization.kind !== dataset.kind ||
              dataset.fields === undefined ||
              Object.entries(dataset.fields).some(
                ([key, path]) =>
                  !Object.hasOwn(authorization.fields, key) ||
                  !sameSourceValue(path, authorization.fields[key]),
              )
            )
              throw new Error('Undeclared source field retention.');
            const published = publications.get(dataset.ref);
            const current = published
              ? await untilAborted(context.artifacts.head(dataset.ref), context.signal)
              : undefined;
            throwIfAborted(context.signal);
            if (
              !published ||
              !current ||
              !sameArtifactMeta(published, current) ||
              published.kind !== dataset.kind ||
              (dataset.digest !== undefined && dataset.digest !== published.digest) ||
              !containsSourceRef(governed, dataset.ref)
            )
              throw new Error('Unassociated source dataset.');
            parents.push(dataset.ref);
            datasets.push({
              ...dataset,
              ...(published.digest !== undefined && { digest: published.digest }),
            });
          }
          const body = copyJson(
            {
              ...declaration,
              ...(declaration.datasets !== undefined && { datasets }),
              producer: { name: tool.schema.name, ...(tool.source && { source: tool.source }) },
              ...(status !== undefined && { status }),
              ...(boundary !== undefined && {
                coverage: listsWithoutRecordOnly(boundary.coverage),
              }),
              ...(boundary?.period !== undefined && { period: boundary.period }),
            },
            options.limits.maxReceiptBytes,
            true,
          );
          const meta = await untilAborted(
            context.artifacts.put({
              kind: SOURCE_EVIDENCE_KIND,
              mediaType: 'application/json',
              data: body,
              digest: 'sha-256',
              ...(parents.length > 0 && { parentRefs: parents }),
            }),
            context.signal,
          );
          throwIfAborted(context.signal);
          if (!active() || !(await untilAborted(context.artifacts.head(meta.ref), context.signal)))
            return;
          for (const ref of parents)
            if (!(await untilAborted(context.artifacts.head(ref), context.signal))) return;
          throwIfAborted(context.signal);
          if (!active()) return;
          const index: SourceEvidenceIndex = scope.sourceEvidence ?? {
            version: 1,
            refs: [],
            omitted: 0,
          };
          const refs = [meta.ref, ...index.refs];
          const dropped = Math.max(0, refs.length - options.limits.maxReceipts);
          if (!Number.isSafeInteger(index.omitted + dropped)) return;
          scope.sourceEvidence = {
            version: 1,
            refs: refs.slice(0, options.limits.maxReceipts),
            omitted: index.omitted + dropped,
          };
        }
      });
    } catch {
      // Source delivery must retain its own truth. Failed retention advertises no new authority.
    } finally {
      closeSourcePublications(context.artifacts);
    }
  };
  return Object.assign(capture, {
    returned() {
      publications ??= takeSourcePublications(context.artifacts);
    },
    withheld() {
      closed = true;
      closeSourcePublications(context.artifacts);
    },
  });
}
