/** Fixed refusal codes: no reference, callback failure, payload or signal reason is echoed. */
export type ArtifactDetailErrorCode =
  | 'ERR_ARTIFACT_DETAIL_INVALID'
  | 'ERR_ARTIFACT_DETAIL_UNAVAILABLE'
  | 'ERR_ARTIFACT_DETAIL_CANCELLED';

const messages = {
  ERR_ARTIFACT_DETAIL_INVALID: 'Invalid artifact detail request.',
  ERR_ARTIFACT_DETAIL_UNAVAILABLE: 'Artifact detail is unavailable.',
  ERR_ARTIFACT_DETAIL_CANCELLED: 'Artifact detail request was cancelled.',
} as const;

/** A bounded detail request was malformed, could not be admitted, or was cancelled. */
export class ArtifactDetailError extends Error {
  constructor(readonly code: ArtifactDetailErrorCode) {
    super(messages[code]);
    this.name = 'ArtifactDetailError';
  }
}

export function invalidDetail(): never {
  throw new ArtifactDetailError('ERR_ARTIFACT_DETAIL_INVALID');
}

export function unavailableDetail(): never {
  throw new ArtifactDetailError('ERR_ARTIFACT_DETAIL_UNAVAILABLE');
}
