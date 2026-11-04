/** Internal field-reader refusal; native checkpoint decoding remains footprintjs-owned. */
export type ResumeCheckpointReason = 'invalid-domain';

/** No captured identity, request, path or value appears in the error. */
export class ResumeCheckpointError extends TypeError {
  readonly code = 'ERR_RESUME_CHECKPOINT' as const;

  constructor(readonly reason: ResumeCheckpointReason) {
    super('Agent.resume: the tool-call checkpoint domain is missing or malformed.');
    this.name = 'ResumeCheckpointError';
  }
}
