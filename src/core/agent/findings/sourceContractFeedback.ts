/** Map — pure per-batch projection of native omission names into bounded protocol feedback. */
import { TOOL_BATCH_FRAME_PREFIX } from '../../../lib/saidByPerson.js';
import { utf8Length } from '../../../lib/utf8.js';
import { MAX_ASK_ARGUMENTS } from '../../../tools/declare.js';
import { sourceDeclarationSchema } from './reserved.js';

const NOTICE_BYTES = 8 * 1024;
const BATCH_BYTES = 64 * 1024;
const HELD_NOTICE =
  `${TOOL_BATCH_FRAME_PREFIX} — framework feedback: source-declaration-required. ` +
  'No calls in that batch ran. ' +
  'That call was held because another call in that batch lacked an argument-source declaration. ' +
  'Submit a new batch.]';

/** No values enter this port. Undefined preserves the native human fallback before spend. */
export function prepareSourceContractFeedback(
  calls: readonly { readonly id: string }[],
  omissions: readonly { readonly toolCallId: string; readonly argument: string }[],
  findings: boolean,
): readonly string[] | undefined {
  const names = new Map<string, Set<string>>();
  for (const omission of omissions) {
    // UTF-8 JSON cannot be shorter than this UTF-16 character count.
    if (omission.argument.length > NOTICE_BYTES) return undefined;
    const missing = names.get(omission.toolCallId) ?? new Set<string>();
    missing.add(omission.argument);
    if (missing.size > MAX_ASK_ARGUMENTS) return undefined;
    names.set(omission.toolCallId, missing);
  }
  const contents: string[] = [];
  let total = 0;
  for (const call of calls) {
    const missing = names.get(call.id);
    const content =
      missing === undefined
        ? HELD_NOTICE
        : `${TOOL_BATCH_FRAME_PREFIX} — framework feedback: No calls in that batch ran. Submit a new batch.\n${JSON.stringify(
            {
              code: 'source-declaration-required',
              path: ['_findings', 'from'],
              missingArguments: [...missing],
              declarationSchema: sourceDeclarationSchema(findings),
            },
          )}\n]`;
    const bytes = utf8Length(content);
    total += bytes;
    if (bytes > NOTICE_BYTES || total > BATCH_BYTES) return undefined;
    contents.push(content);
  }
  return Object.freeze(contents);
}
