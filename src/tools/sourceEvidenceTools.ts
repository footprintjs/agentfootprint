import { defineTool, type Tool } from './tools.js';
import { sourceEvidenceAccess } from './sourceEvidenceAccess.js';
import type {
  SourceEvidenceFindArgs,
  SourceEvidenceReadArgs,
} from '../artifacts/sourceEvidence/types.js';

/** @internal Mounted once by the explicit native feature; ordinary tool collision rules apply. */
export function sourceEvidenceTools(): readonly Tool[] {
  const subject = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'value'],
    properties: {
      kind: { type: 'string', minLength: 1, maxLength: 128 },
      value: { type: 'string', minLength: 1, maxLength: 512 },
    },
  };
  return [
    defineTool<SourceEvidenceFindArgs, unknown>({
      name: 'find_source_evidence',
      capabilities: ['user_data'],
      description:
        'Find retained historical source observations for an exact declared subject, operation and scope. This never queries or refreshes a source. Distinct observations remain distinct; a page is not proof of source completeness. Read an issued candidate ref to inspect its permitted stored evidence.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['subject'],
        properties: {
          subject,
          operation: { type: 'string', minLength: 1, maxLength: 128 },
          scope: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
          },
          cursor: { type: 'string', maxLength: 40 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
      execute: (args, context) => sourceEvidenceAccess(context).find(args, context),
    }),
    defineTool<SourceEvidenceReadArgs, unknown>({
      name: 'read_source_evidence',
      capabilities: ['user_data'],
      description:
        'Read an issued historical source receipt, or a bounded section of one named associated dataset. Use the receipt ref returned by find_source_evidence; a dataset ref alone is not a receipt. Every read rechecks current admission. No refresh, current truth or answer-completeness guarantee is implied.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['ref'],
        properties: {
          ref: { type: 'string', description: 'The complete issued source receipt reference.' },
          dataset: { type: 'string', minLength: 1, maxLength: 128 },
          path: { type: 'string', maxLength: 2048 },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
      execute: (args, context) => sourceEvidenceAccess(context).read(args, context),
    }),
  ] as unknown as readonly Tool[];
}
