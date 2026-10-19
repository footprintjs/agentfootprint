import { throwIfAborted, untilAborted } from '../lib/abort.js';
import { copyJson, ownData } from '../lib/boundedJson.js';
import type { ArtifactRef } from '../artifacts/types.js';
import { DETAIL_LIMITS, readDetailArgs } from '../artifacts/detailRequest.js';
import { ArtifactDetailError, unavailableDetail } from '../artifacts/detailError.js';
import { projectArtifactDetail } from '../artifacts/detailView.js';
import type { ArtifactDetailArgs, ArtifactDetailResult } from '../artifacts/detailTypes.js';
import { defineTool, type Tool, type ToolExecutionContext } from './tools.js';

/** Trusted host admission and presentation; neither callback is controlled by model arguments. */
export interface ArtifactDetailOptions {
  readonly name: string;
  /** Re-authorize this reference for the caller on EVERY navigation call. No implicit store read occurs. */
  readonly admit: (ref: ArtifactRef, ctx: ToolExecutionContext) => Promise<unknown>;
  /** Presentation only, nested under context; it cannot override ref, path, mode or pagination. */
  readonly context?: (root: unknown, path: string) => Readonly<Record<string, unknown>>;
}

/**
 * Open bounded JSON sections through a host-authenticated reference.
 *
 * The host owns scope, run, source, kind, integrity and domain checks in `admit`.
 * This helper never reads a store automatically or grants claim authority. Every
 * call re-admits, then detaches/freezes at most 1 MiB of ordinary JSON (depth 100).
 * Paths have at most 16 segments and 2048 UTF-16 characters; pages contain at most
 * 20 children. Whole responses are bounded to 12 KiB UTF-8, including at most
 * 4 KiB host context; inline values are at most 8 KiB. Large scalars are omitted
 * whole. Bounds do not preempt synchronous host code or arbitrary Proxy traps.
 *
 * Callback failures use fixed refusal text. Cancellation stops waiting and late
 * results cannot be served, but does not claim the underlying work stopped.
 */
export function artifactDetailTool(
  options: ArtifactDetailOptions,
): Tool<ArtifactDetailArgs, ArtifactDetailResult> {
  const configured = ownData(options, ['name', 'admit', 'context']);
  if (
    typeof configured.name !== 'string' ||
    typeof configured.admit !== 'function' ||
    (configured.context !== undefined && typeof configured.context !== 'function')
  )
    throw new Error('Invalid artifact detail configuration.');
  const name = configured.name;
  const admit = configured.admit as ArtifactDetailOptions['admit'];
  const context = configured.context as ArtifactDetailOptions['context'];
  return defineTool<ArtifactDetailArgs, ArtifactDetailResult>({
    name,
    description:
      'Open a bounded section of an authorized stored JSON proof. Use the complete issued ref and JSON pointer (empty path opens its root). Small sections return actual values; larger containers return child actions and exact shown/total/complete/nextOffset. Large scalars are omitted whole. Reading a section grants no additional claim authority.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ref', 'path'],
      properties: {
        ref: {
          type: 'string',
          description:
            'Complete issued artifact reference: art_ followed by 22 base62 characters, for example art_0123456789ABCDEFGHIJKL. Never a file, URL or storage scope.',
        },
        path: {
          type: 'string',
          maxLength: DETAIL_LIMITS.path,
          description:
            'Safe JSON pointer; escape ~ as ~0 and / as ~1. Empty string opens the root; at most 16 segments.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          maximum: DETAIL_LIMITS.offset,
          description:
            'Direct-child offset from nextOffset; default zero. Scalars accept only zero and are returned whole or explicitly omitted.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: DETAIL_LIMITS.page,
          description:
            'Direct children per page, from 1 to 20; default 20. Follow actual child actions or nextOffset; shown/total/complete describe the page, not proof completeness.',
        },
      },
    },
    async execute(value, ctx) {
      const args = readDetailArgs(value);
      try {
        throwIfAborted(ctx.signal);
        const supplied = await untilAborted(
          Promise.resolve().then(() => {
            throwIfAborted(ctx.signal);
            return admit(args.ref, ctx);
          }),
          ctx.signal,
        );
        throwIfAborted(ctx.signal);
        const root = copyJson(supplied, DETAIL_LIMITS.inputBytes, true);
        throwIfAborted(ctx.signal);
        const presented = context?.(root, args.path);
        const domain =
          presented === undefined
            ? undefined
            : ownData(copyJson(presented, DETAIL_LIMITS.contextBytes, true));
        throwIfAborted(ctx.signal);
        return projectArtifactDetail(root, args, name, domain);
      } catch {
        if (ctx.signal?.aborted) throw new ArtifactDetailError('ERR_ARTIFACT_DETAIL_CANCELLED');
        return unavailableDetail();
      }
    },
  });
}
