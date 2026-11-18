import { copyJson } from '../../lib/boundedJson.js';
import type { ContextRecordedPayload } from '../../events/payloads/contextRecorded.js';
import type { ContextRecordedPiece } from '../../events/payloads/contextRecorded.js';
import type { LLMToolSchema } from '../../provider-contract/types.js';
import { runKeepsOut, wantsRecordedContext } from '../../redaction/runRedaction.js';
import { SERVED_PLACEHOLDER } from '../../redaction/served.js';
import { typedEmit, type EmitableScope } from './typedEmit.js';

interface SystemPiece {
  readonly rawContent?: string;
  readonly contentSummary?: string;
  readonly source: string;
  readonly sourceId?: string;
}

/** Values already assembled by the calling stage. No scope read or reassembly. */
export interface ModelContextFrame {
  readonly iteration: number;
  readonly systemPieces: readonly SystemPiece[];
  readonly tools: readonly LLMToolSchema[];
  readonly requestOnly?: readonly {
    readonly message: { readonly content: string };
    readonly reason: string;
  }[];
}

/**
 * Capture at the actual call, only when requested. Serving happens through
 * typedEmit BEFORE native emit, so deferred observers and every sink agree.
 * This neither edits nor wraps a provider request. A source-key refusal must
 * survive projecting a slot's value into a differently named event field.
 */
export function recordModelContext(scope: EmitableScope, readFrame: () => ModelContextFrame): void {
  if (!wantsRecordedContext(scope)) return;
  let payload: ContextRecordedPayload;
  try {
    payload = capture(scope, readFrame());
  } catch {
    // Capture is optional evidence, never a change to model execution. A
    // fixed refusal cannot leak a thrown value, getter or incomplete schema.
    payload = { omission: 'not-json', pieces: [] };
  }
  typedEmit(scope, 'agentfootprint.context.recorded', payload);
}

function capture(scope: EmitableScope, frame: ModelContextFrame): ContextRecordedPayload {
  const pieces: ContextRecordedPiece[] = frame.systemPieces.map((piece) => ({
    source: piece.source,
    ...(piece.sourceId !== undefined && { sourceId: piece.sourceId }),
    rawContent: runKeepsOut(
      scope,
      piece.source === 'ontology' ? 'ontology' : 'systemPromptInjections',
    )
      ? SERVED_PLACEHOLDER
      : piece.rawContent ?? piece.contentSummary ?? '',
  }));
  for (const tool of frame.tools) {
    pieces.push({
      source: 'registry',
      sourceId: tool.name,
      schema:
        runKeepsOut(scope, 'dynamicToolSchemas') || runKeepsOut(scope, 'toolSchemas')
          ? SERVED_PLACEHOLDER
          : tool,
    });
  }
  for (const line of frame.requestOnly ?? []) {
    pieces.push({
      source: 'request-only',
      sourceId: line.reason,
      rawContent: line.message.content,
    });
  }
  // Own and freeze ONLY the capture, never the caller's/provider's objects.
  // The existing descriptor-based copier invokes no getter or toJSON. Refuse
  // non-JSON data and capture larger than 8 MiB instead of silently truncating.
  return copyJson(
    { iteration: frame.iteration, pieces },
    8 * 1024 * 1024,
    true,
  ) as ContextRecordedPayload;
}
