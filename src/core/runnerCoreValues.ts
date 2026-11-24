import type { RedactionPolicy } from 'footprintjs';
import type { RunRedaction } from '../redaction/runRedaction.js';
import type { PrivateRecordFields } from '../redaction/privateFields.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import type { RequestContext } from '../identity/requestContext.js';
import type { ParentRunRecord } from './memberRun.js';

export interface RunnerCoreValues {
  /** Native emit envelopes delivered as summaries on this execution's observer queue. */
  summarizedEmits?: number;
  /** Private policy/serving for this execution; never tracked chart state. */
  redaction?: RunRedaction;
  privateFields?: PrivateRecordFields;
  /** Conservative native marks remain record-only, never caller-policy provenance. */
  recordMarks?: RedactionPolicy;
  parentIdentity?: MemoryIdentity;
  parentRequest?: RequestContext;
  parentRun?: ParentRunRecord;
}
