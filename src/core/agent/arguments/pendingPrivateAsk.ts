/** Pending privacy is a request-bound declaration of names, never a saved mapper or policy. */
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { PRIVATE_FIELD_LIMITS, type PrivateFieldRoot } from '../../../redaction/privateFields.js';
import { carriesArgumentView } from '../../toolShownArgs.js';
import type { ArgumentAskState } from './ask.js';
import type { ToolOf } from './resolve.js';
import type { AwaitingInput } from '../../../tools/inputRequest.js';
import { PrivateArgumentRecordError } from './privateAnswers.js';

export interface AskWaiting {
  readonly requestId: string;
  /** Positions into the actual state's fields, in the fitted question's f1…fn order. */
  readonly fieldIndexes: readonly number[];
  readonly awaiting: AwaitingInput;
  /** Closed request-bound names; explicit empty is distinct from an omitted declaration. */
  readonly privateFields?: PendingPrivateAsk;
}

export interface PendingPrivateAsk {
  readonly version: 1;
  readonly fields: readonly {
    readonly index: number;
    /** Only original mapper-bearing members; plain members of a shared field stay eligible. */
    readonly members: readonly number[];
  }[];
}

const refuse = (): never => {
  throw new PrivateArgumentRecordError(
    'A private argument question requires its saved declaration and argument-view capability.',
  );
};
const indexFits = (value: unknown, length: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < length;

/** Missing is allowed only for an ordinary run with no private recording capability/carrier. */
export function readPendingPrivateAsk(
  raw: unknown,
  state: ArgumentAskState,
  required: boolean,
): PendingPrivateAsk | undefined {
  if (raw === undefined && !required) return undefined;
  try {
    const waiting = state.waiting;
    if (waiting === undefined) return refuse();
    const record = ownData(copyJson(raw, PRIVATE_FIELD_LIMITS.bytes, false, 5), [
      'version',
      'fields',
    ]);
    if (
      record.version !== 1 ||
      !Array.isArray(record.fields) ||
      record.fields.length > waiting.fieldIndexes.length
    )
      return refuse();
    const seen = new Set<number>();
    const fields = record.fields.map((rawField) => {
      const field = ownData(rawField, ['index', 'members']);
      const index = field.index;
      if (
        !indexFits(index, state.fields.length) ||
        !waiting.fieldIndexes.includes(index) ||
        seen.has(index)
      )
        return refuse();
      seen.add(index);
      if (
        !Array.isArray(field.members) ||
        field.members.length === 0 ||
        field.members.length > state.fields[index].members.length
      )
        return refuse();
      const seenMembers = new Set<number>();
      const members = field.members.map((member) => {
        if (!indexFits(member, state.fields[index].members.length) || seenMembers.has(member))
          return refuse();
        seenMembers.add(member);
        return member;
      });
      return Object.freeze({ index, members: Object.freeze(members) });
    });
    return Object.freeze({ version: 1, fields: Object.freeze(fields) });
  } catch {
    return refuse();
  }
}

/** Read only the waiting object's own data declaration, never an inherited/getter value. */
export function pendingPrivateAskOf(
  state: ArgumentAskState,
  required: boolean,
): PendingPrivateAsk | undefined {
  if (state.waiting === undefined) return required ? refuse() : undefined;
  const descriptor = Object.getOwnPropertyDescriptor(state.waiting, 'privateFields');
  if (descriptor !== undefined && !('value' in descriptor)) return refuse();
  return readPendingPrivateAsk(descriptor?.value, state, required);
}

/** Called after the actual fitted question is stamped, before any raw working-state write. */
export function declarePendingPrivateAsk(
  state: ArgumentAskState,
  toolOf: ToolOf,
  protectedRun: boolean,
): PendingPrivateAsk | undefined {
  const waiting = state.waiting;
  if (waiting === undefined) return refuse();
  const fields: { index: number; members: number[] }[] = [];
  for (const index of waiting.fieldIndexes) {
    if (!indexFits(index, state.fields.length)) return refuse();
    const members: number[] = [];
    state.fields[index].members.forEach((member, memberIndex) => {
      const tool = toolOf(member.toolName);
      // Missing ordinary implementations gain no private declaration. Saved private
      // members are checked separately before a resumed answer can be bound.
      if (carriesArgumentView(tool)) members.push(memberIndex);
    });
    if (members.length > 0) fields.push({ index, members });
  }
  // A late mapper may use an already armed caller rule even before a private
  // carrier exists. These names grant no authority: native registration and
  // requirePrivateQuestionSupport still refuse an unarmed question.
  if (!protectedRun && fields.length === 0) return undefined;
  // Explicit empty is distinct from missing, including an ordinary question in a protected run.
  return readPendingPrivateAsk({ version: 1, fields }, state, true);
}

/** Fields are selected before answers exist; a sibling-dependent mapper cannot prove publicness. */
export function pendingPrivateSelections(
  declaration: PendingPrivateAsk | undefined,
  state?: ArgumentAskState,
): { readonly root: PrivateFieldRoot; readonly path: string }[] {
  if (declaration?.fields.some(({ index }) => state?.fields[index]?.window?.reply !== undefined))
    return [{ root: 'argumentAsk', path: '' }];
  return (declaration?.fields ?? []).flatMap(({ index }) => [
    { root: 'argumentAsk' as const, path: `progress.${index}.answer` },
    { root: 'argumentAsk' as const, path: `progress.${index}.fills` },
  ]);
}

/** Validate the parsed declaration BEFORE interrupt/readAskAnswer/bindAnswer or any raw write. */
export function requirePendingPrivateViews(
  state: ArgumentAskState,
  declaration: PendingPrivateAsk | undefined,
  toolOf: ToolOf,
): void {
  for (const field of declaration?.fields ?? []) {
    for (const memberIndex of field.members) {
      const member = state.fields[field.index]?.members[memberIndex];
      if (member === undefined || !carriesArgumentView(toolOf(member.toolName))) return refuse();
    }
  }
}
