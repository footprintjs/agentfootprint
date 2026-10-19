/** Opt-in composition of the existing session admission and JSON detail viewer. */
import { ownData } from '../lib/boundedJson.js';
import { assertValidToolName } from '../lib/toolName.js';
import { ArtifactDetailError } from '../artifacts/detailError.js';
import { storedJson } from '../artifacts/storedJson.js';
import type { ArtifactMeta } from '../artifacts/types.js';
import type { ArtifactDetailArgs, ArtifactDetailResult } from '../artifacts/detailTypes.js';
import { artifactDetailTool } from './artifactDetailTool.js';
import {
  sessionArtifactAdmission,
  hasArtifactSession,
  type SessionArtifactAdmissionOptions,
} from './sessionArtifactAdmission.js';
import type { Tool } from './tools.js';

/** Mount a bounded stored-data reader; omitted means the existing catalog is unchanged. */
export interface ArtifactReadingOptions {
  /** Exact allowed kinds, payload ceiling and optional narrowing domain check. */
  readonly admission: SessionArtifactAdmissionOptions;
  /** Ordinary tool name; defaults to artifact_detail and is reserved only when enabled. */
  readonly name?: string;
}

/** Internal construction facts shared by catalog composition and placement. */
export interface ConfiguredArtifactReading {
  readonly name: string;
  readonly tool: Tool;
  readonly maxChars: number;
  allows(meta: ArtifactMeta, sessionId: unknown): boolean;
}

export const READING_UNAVAILABLE = new ArtifactDetailError('ERR_ARTIFACT_DETAIL_UNAVAILABLE')
  .message;

export function configureArtifactReading(
  value: ArtifactReadingOptions,
  maxChars: number,
): ConfiguredArtifactReading {
  const fields = ownData(value, ['name', 'admission']);
  const name = fields.name === undefined ? 'artifact_detail' : fields.name;
  assertValidToolName(name);
  if (maxChars < READING_UNAVAILABLE.length)
    throw new Error('Artifact reading requires room for a fixed unavailable response.');
  ownData(fields.admission, ['kinds', 'maxBytes', 'check']);
  const admit = sessionArtifactAdmission(value.admission);
  const kinds = new Set(value.admission.kinds);
  const maxBytes = value.admission.maxBytes;
  // A mapped argument object fits the existing heterogeneous Tool registry without casts.
  type Args = { [Key in keyof ArtifactDetailArgs]: ArtifactDetailArgs[Key] };
  const tool: Tool<Args, ArtifactDetailResult> = artifactDetailTool({
    name,
    async admit(ref, context) {
      return storedJson(await admit(ref, context));
    },
  });
  return Object.freeze({
    name,
    tool,
    maxChars,
    allows: (meta: ArtifactMeta, sessionId: unknown) =>
      hasArtifactSession(sessionId) && kinds.has(meta.kind) && meta.bytes <= maxBytes,
  });
}
