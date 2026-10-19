import {
  sessionArtifactAdmission,
  type ArtifactRecord,
  type ArtifactReadingOptions,
  type SessionArtifactAdmission,
  type SessionArtifactAdmissionOptions,
  type ToolExecutionContext,
} from '../../src/index.js';

const admission: SessionArtifactAdmissionOptions = {
  kinds: ['tool-result/inventory'],
  maxBytes: 1024,
  check: (record: ArtifactRecord, context: ToolExecutionContext) =>
    record.meta.kind === 'tool-result/inventory' && context.sessionId !== undefined,
};
const read: SessionArtifactAdmission = sessionArtifactAdmission(admission);
const reading: ArtifactReadingOptions = { admission, name: 'open_saved_json' };
void read;
void reading;

const replacement: SessionArtifactAdmissionOptions = {
  kinds: ['report'],
  maxBytes: 1024,
  // @ts-expect-error A narrowing check must explicitly admit or deny, never replace data.
  check: () => ({ data: 'forged' }),
};
void replacement;
// @ts-expect-error Model-supplied scope is not part of reading configuration.
const foreignScope: ArtifactReadingOptions = { admission, scope: { conversationId: 'another' } };
void foreignScope;
