/** Map — pure per-batch projection of native omission names into bounded protocol feedback. */
import { TOOL_BATCH_FRAME_PREFIX } from '../../../lib/saidByPerson.js';
import { utf8Length } from '../../../lib/utf8.js';
import { MAX_ASK_ARGUMENTS } from '../../../tools/declare.js';
import { FINDINGS_ARGUMENT_SCHEMA_WITH_FROM, FINDINGS_SOURCES_SCHEMA } from './reserved.js';
import { SOURCE_DECLARATION_PATH, sourceDeclarationView } from '../sourceContract.js';
import { batchAddress, type BatchAddress } from '../arguments/batchAddress.js';
import type { CallOccurrenceKey } from '../../../lib/callOccurrence.js';

const LEDGER_SOURCE_CONTRACT = sourceDeclarationView(FINDINGS_ARGUMENT_SCHEMA_WITH_FROM);
const SOURCE_CONTRACT = sourceDeclarationView(FINDINGS_SOURCES_SCHEMA);

/** Native error data only; served ASK contracts and optional observations share the same grammar. */
export function sourceDeclarationSchema(findings: boolean): Readonly<Record<string, unknown>> {
  return findings ? LEDGER_SOURCE_CONTRACT : SOURCE_CONTRACT;
}

const NOTICE_BYTES = 8 * 1024;
const BATCH_BYTES = 64 * 1024;
const HELD_NOTICE =
  `${TOOL_BATCH_FRAME_PREFIX} — framework feedback: source-declaration-required. ` +
  'No calls in that batch ran. ' +
  'That call was held because another call in that batch lacked an argument-source declaration. ' +
  'Submit a new batch.]';

/** No values enter this port. Undefined preserves the native human fallback before spend. */
export function prepareSourceContractFeedback(
  calls: readonly { readonly id: string; readonly callOccurrenceKey?: CallOccurrenceKey }[],
  omissions: readonly {
    readonly toolCallId: string;
    readonly argument: string;
    readonly callOccurrenceKey?: CallOccurrenceKey;
  }[],
  findings: boolean,
): readonly string[] | undefined {
  const names = new Map<BatchAddress, Set<string>>();
  for (const omission of omissions) {
    // UTF-8 JSON cannot be shorter than this UTF-16 character count.
    if (omission.argument.length > NOTICE_BYTES) return undefined;
    const address = batchAddress(omission.toolCallId, omission.callOccurrenceKey);
    const missing = names.get(address) ?? new Set<string>();
    missing.add(omission.argument);
    if (missing.size > MAX_ASK_ARGUMENTS) return undefined;
    names.set(address, missing);
  }
  const contents: string[] = [];
  let total = 0;
  for (const call of calls) {
    const missing = names.get(batchAddress(call.id, call.callOccurrenceKey));
    const content =
      missing === undefined
        ? HELD_NOTICE
        : `${TOOL_BATCH_FRAME_PREFIX} — framework feedback: No calls in that batch ran. Submit a new batch.\n${JSON.stringify(
            {
              code: 'source-declaration-required',
              path: SOURCE_DECLARATION_PATH,
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
