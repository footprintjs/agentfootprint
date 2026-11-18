import type { ToolExecutionContext } from './tools.js';
import type {
  SourceEvidenceFindArgs,
  SourceEvidenceReadArgs,
} from '../artifacts/sourceEvidence/types.js';

/** Internal read-only native capability. It has no mint or index mutation operation. */
export interface SourceEvidenceAccess {
  find(args: SourceEvidenceFindArgs, context: ToolExecutionContext): Promise<unknown>;
  read(args: SourceEvidenceReadArgs, context: ToolExecutionContext): Promise<unknown>;
}
const access = Symbol('agentfootprint.sourceEvidenceAccess');
export function bindSourceEvidenceAccess(value: SourceEvidenceAccess): object {
  return { [access]: value };
}
export function sourceEvidenceAccess(context: ToolExecutionContext): SourceEvidenceAccess {
  const value = (context as ToolExecutionContext & { [access]?: SourceEvidenceAccess })[access];
  if (!value) throw new Error('Retained source evidence requires an opted-in native Agent.');
  return value;
}
