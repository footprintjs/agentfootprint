import { copyJson, jsonBytes, ownData } from '../../../lib/boundedJson.js';
import { linkedController, throwIfAborted } from '../../../lib/abort.js';
import { bindArtifacts } from '../../../artifacts/capability.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceIndex,
} from '../../../artifacts/sourceEvidence/types.js';
import type {
  SourceEvidenceMetadata,
  SourceEvidencePreparationContext,
  SourceEvidenceRecentResult,
} from '../../../tools/sourceEvidence.js';
import type { SourcePreparationConfiguration } from './preparationConfiguration.js';
import type { AgentInput } from '../types.js';
import type { AgentRunOptions } from '../../Agent.js';
import { assertContinuable, validateCheckpoint } from '../../runCheckpoint.js';
import { normalizeRunInput } from '../../runInput.js';
import { assertIdentityShape } from '../callerIdentity.js';
import { unionRedactionPolicies } from '../../../redaction/policy.js';
import { redactionDeclaredBy } from '../../../redaction/declared.js';
import { createSourceAdmission } from './admission.js';
import { preparationCatalog } from './preparationCatalog.js';
import { checkSourcePermission, SourceEvidencePolicyHalt } from './permissionChecks.js';
import { runSourceEvidenceFlow } from './flow.js';
import { withSourceEvidenceDeadline } from './deadline.js';
import { unavailableSourceEvidence } from './read.js';
import { boundedSourceEvidenceIndex } from './seedIndex.js';

const metadata = (candidate: SourceEvidenceCandidate): SourceEvidenceMetadata => {
  return {
    ref: candidate.ref,
    producer: candidate.producer,
    subject: candidate.subject,
    operation: candidate.operation,
    scope: candidate.scope,
    recordedAt: candidate.recordedAt,
    ...(candidate.origin !== undefined && { origin: candidate.origin }),
    ...(candidate.status !== undefined && { status: candidate.status }),
    ...(candidate.coverage !== undefined && { coverage: candidate.coverage }),
    ...(candidate.period !== undefined && { period: candidate.period }),
  };
};

/** Native continuation metadata; the caller never supplies a store capability or fake tool context. */
export function sourcePreparation(
  configuration: SourcePreparationConfiguration,
  runner: object,
  input: AgentInput | string,
  options: AgentRunOptions | undefined,
  inherited?: SourceEvidenceIndex,
) {
  const mounted = configuration.sourceEvidenceConfig;
  if (!mounted?.preparation || !configuration.artifactStore) return undefined;
  const preparation = mounted.preparation;
  const request = normalizeRunInput<AgentInput>(input, 'Agent.run');
  const checkpoint =
    request.continueFrom === undefined ? undefined : validateCheckpoint(request.continueFrom);
  if (checkpoint) assertContinuable(checkpoint, configuration.explicitId, 'Agent.run');
  const index = boundedSourceEvidenceIndex(
    checkpoint?.sourceEvidence ?? inherited,
    mounted.limits.maxReceipts,
  );
  assertIdentityShape(request.identity, 'Agent.run');
  assertIdentityShape(options?.identity, 'Agent.run');
  const suppliedIdentity = request.identity ?? options?.identity ?? checkpoint?.identity;
  const identity =
    suppliedIdentity === undefined ? undefined : Object.freeze({ ...suppliedIdentity });
  const artifactScope =
    identity ??
    (options?.sessionId === undefined ? undefined : { conversationId: options.sessionId });
  const { controller, unlink } = linkedController(options?.env?.signal, options?.signal);
  const redact = unionRedactionPolicies(redactionDeclaredBy(runner), options?.redact);
  const context: SourceEvidencePreparationContext = Object.freeze({
    ...(identity && { identity }),
    signal: controller.signal,
    ...(redact && { redact }),
  });
  const catalog = preparationCatalog(configuration);
  let active = true,
    halt: unknown;
  const close = () => {
    active = false;
    controller.abort();
    unlink();
  };
  const artifacts =
    artifactScope === undefined
      ? undefined
      : bindArtifacts(configuration.artifactStore, artifactScope);
  let producers: ReadonlyMap<string, import('../../../tools/tools.js').Tool> = new Map();
  const admission =
    artifacts === undefined
      ? undefined
      : createSourceAdmission({
          artifacts,
          options: {
            limits: mounted.limits,
            admit: async (candidate, ctx: SourceEvidencePreparationContext) => {
              const supplied = await preparation.admit(metadata(candidate), ctx);
              return supplied;
            },
          },
          index: () => index,
          currentProducer: (name) => producers.get(name),
          active: () => active && !controller.signal.aborted,
          permit: (candidate, ctx) => {
            const producer = producers.get(candidate.producer.name);
            return producer === undefined
              ? Promise.resolve(false)
              : checkSourcePermission(configuration.permissionChecker, producer, candidate, ctx);
          },
        });
  const recent = async (value: unknown = {}): Promise<SourceEvidenceRecentResult> => {
    if (!active || controller.signal.aborted || !admission) return unavailableSourceEvidence();
    try {
      return await withSourceEvidenceDeadline(context, mounted.limits.timeoutMs, async (ctx) => {
        let offset = 0,
          total = 0,
          limit = 20,
          scanned = 0,
          more = false;
        const candidates: SourceEvidenceMetadata[] = [];
        await runSourceEvidenceFlow(ctx, [
          {
            id: 'validate-source-metadata-query',
            async run() {
              const args = ownData(copyJson(value, 4096, true), ['limit', 'cursor']);
              if (
                args.limit !== undefined &&
                (!Number.isSafeInteger(args.limit) ||
                  (args.limit as number) < 1 ||
                  (args.limit as number) > 20)
              )
                throw new TypeError('Invalid source metadata query.');
              limit = (args.limit as number) ?? 20;
              total = (index?.refs.length ?? 0) + (index?.omitted ?? 0);
              if (!Number.isSafeInteger(total)) throw new TypeError('Invalid source cursor.');
              if (args.cursor !== undefined) {
                if (
                  typeof args.cursor !== 'string' ||
                  !/^se1:(0|[1-9]\d{0,15}):(0|[1-9]\d{0,15})$/.test(args.cursor)
                )
                  throw new TypeError('Invalid source cursor.');
                const parts = args.cursor.split(':').map(Number);
                const previousTotal = parts[1] ?? -1,
                  previousOffset = parts[2] ?? -1;
                if (
                  !Number.isSafeInteger(previousTotal) ||
                  !Number.isSafeInteger(previousOffset) ||
                  previousTotal < 0 ||
                  previousOffset < 0 ||
                  previousTotal > total ||
                  previousOffset > previousTotal
                )
                  throw new TypeError('Invalid source cursor.');
                offset = previousOffset + total - previousTotal;
                if (!Number.isSafeInteger(offset) || offset > (index?.refs.length ?? 0))
                  throw new TypeError('Invalid source cursor.');
              }
              if (index.refs.length > 0) producers = await catalog(ctx);
            },
          },
          {
            id: 'admit-retained-source-metadata',
            async run() {
              const refs = index?.refs ?? [];
              while (
                offset < refs.length &&
                scanned < mounted.limits.maxScanned &&
                candidates.length < limit
              ) {
                const ref = refs[offset++];
                if (ref === undefined) throw new TypeError('Invalid source index.');
                const candidate = await admission.admitted(ref, index, ctx);
                scanned++;
                if (!candidate) continue;
                const entry = metadata(candidate);
                if (
                  jsonBytes({
                    historical: true,
                    candidates: [...candidates, entry],
                    shown: candidates.length + 1,
                    complete: false,
                    nextCursor: `se1:${total}:${offset}`,
                  }) > mounted.limits.maxResponseBytes
                ) {
                  if (candidates.length === 0)
                    throw new Error('Source metadata exceeds response bound.');
                  offset--;
                  break;
                }
                candidates.push(entry);
              }
              more = offset < refs.length;
            },
          },
          {
            id: 'recheck-retained-source-metadata',
            async run() {
              throwIfAborted(ctx.signal);
              for (const candidate of candidates)
                if (!(await admission.retainedNow(candidate, ctx)))
                  throw new Error('Unavailable source metadata.');
            },
          },
        ]);
        return {
          historical: true,
          candidates,
          shown: candidates.length,
          complete: !more && (index?.omitted ?? 0) === 0,
          ...(more ? { nextCursor: `se1:${total}:${offset}` } : {}),
        };
      });
    } catch (error) {
      if (error instanceof SourceEvidencePolicyHalt) {
        halt = error;
        throw error;
      }
      return unavailableSourceEvidence();
    }
  };
  return {
    capability: Object.freeze({ recent }),
    close,
    beforeProceed() {
      close();
      if (halt) throw halt;
    },
  };
}
