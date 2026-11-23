import type { MemoryEntry } from '../../../memory/entry/index.js';
import type {
  AgentCoreEventPayloadChoice,
  AgentCoreEventPayloadSelector,
  AgentCoreLikeClient,
  BedrockAgentCoreSdkModule,
} from './contract.js';

const MAX_TEXT_SCALARS = 100_000;
const MAX_TEXT_BYTES = 100_000;
const MAX_MIXED_EVENT_BYTES = 10_000_000;
const ROLES = { user: 'USER', assistant: 'ASSISTANT', tool: 'TOOL', other: 'OTHER' } as const;

/** An unreadable optional declaration grants no authority, while blob choices need none. */
export function clientForwardsEventPayload(client: AgentCoreLikeClient): boolean {
  try {
    return client.forwardsEventPayload === true;
  } catch {
    return false;
  }
}

/** Stop at the first malformed scalar or exceeded bound, without an encoded copy. */
function scanUnicode(
  text: string,
  scalarLimit: number,
  byteLimit: number,
): 'valid' | 'malformed' | 'large' {
  let scalars = 0;
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return 'malformed';
      index++;
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return 'malformed';
    } else {
      bytes += unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
    }
    scalars++;
    if (scalars > scalarLimit || bytes > byteLimit) return 'large';
  }
  return 'valid';
}

function invalidChoice(): never {
  throw new TypeError(
    'AgentCoreStore: eventPayload must return a plain own-data choice: ' +
      '{ kind: "blob" } or { kind: "conversational", role, text }, with no other fields.',
  );
}

/** Read the closed union once through descriptors; foreign accessors never run. */
function ownedChoice(value: unknown): AgentCoreEventPayloadChoice {
  if (value === null || typeof value !== 'object') return invalidChoice();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidChoice();
  const keys = Reflect.ownKeys(value);
  if ((keys.length !== 1 && keys.length !== 3) || !keys.includes('kind')) {
    return invalidChoice();
  }
  let kind: unknown;
  let role: unknown;
  let text: unknown;
  for (const key of keys) {
    if (key !== 'kind' && key !== 'role' && key !== 'text') return invalidChoice();
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field === undefined || !Object.hasOwn(field, 'value')) return invalidChoice();
    if (key === 'kind') kind = field.value;
    else if (key === 'role') role = field.value;
    else text = field.value;
  }
  if (kind === 'blob' && keys.length === 1) return { kind: 'blob' };
  if (
    kind !== 'conversational' ||
    keys.length !== 3 ||
    typeof role !== 'string' ||
    !Object.hasOwn(ROLES, role) ||
    typeof text !== 'string'
  ) {
    return invalidChoice();
  }
  const measured = scanUnicode(text, MAX_TEXT_SCALARS, MAX_TEXT_BYTES);
  if (measured === 'malformed') {
    throw new TypeError('AgentCoreStore: eventPayload text must contain valid Unicode scalars.');
  }
  if (text.length === 0 || measured === 'large') {
    throw new RangeError(
      'AgentCoreStore: eventPayload text must contain 1–100,000 Unicode scalars ' +
        'and at most 100,000 UTF-8 bytes; it is never truncated.',
    );
  }
  return { kind: 'conversational', role: role as keyof typeof ROLES, text };
}

/** Snapshot before foreign projection; neither its input nor the client's entry is the original. */
export function captureEventPayload(
  entry: MemoryEntry,
  selector: AgentCoreEventPayloadSelector,
): { entry: MemoryEntry; eventPayload: AgentCoreEventPayloadChoice; blob: string } {
  const blob = JSON.stringify(entry);
  if (typeof blob !== 'string') {
    throw new TypeError('AgentCoreStore: eventPayload requires a JSON-storable memory entry.');
  }
  const detached = JSON.parse(blob) as MemoryEntry;
  const clientEntry = JSON.parse(blob) as MemoryEntry;
  if (typeof selector !== 'function') {
    throw new TypeError('AgentCoreStore: eventPayload must be a synchronous selector function.');
  }
  const eventPayload = ownedChoice(selector(detached));
  return { entry: clientEntry, eventPayload, blob };
}

/** The canonical blob is always first; conversation is an additional item in the same body. */
export function eventPayloadItems(blob: string, eventPayload?: AgentCoreEventPayloadChoice) {
  return [
    { blob },
    ...(eventPayload?.kind === 'conversational'
      ? [
          {
            conversational: {
              content: { text: eventPayload.text },
              role: ROLES[eventPayload.role],
            },
          },
        ]
      : []),
  ];
}

/** A conservative library ceiling on the generated mixed body, not an AWS unit conversion. */
export function assertMixedEventSize(input: {
  memoryId: string;
  actorId: string;
  sessionId: string;
  blob: string;
  eventPayload: AgentCoreEventPayloadChoice;
  extractionMode?: 'SKIP';
  extractionConfig?: { readonly namespaceVariables: Readonly<Record<string, string>> };
}): void {
  if (input.eventPayload.kind !== 'conversational') return;
  const body = {
    memoryId: input.memoryId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    // A normal Date serializes to this fixed 24-character ISO shape.
    eventTimestamp: '2000-01-01T00:00:00.000Z',
    payload: eventPayloadItems(input.blob, input.eventPayload),
    ...(input.extractionMode !== undefined && { extractionMode: input.extractionMode }),
    ...(input.extractionConfig !== undefined && {
      extractionConfig: {
        namespaceVariables: { ...input.extractionConfig.namespaceVariables },
      },
    }),
  };
  if (
    scanUnicode(JSON.stringify(body), Number.POSITIVE_INFINITY, MAX_MIXED_EVENT_BYTES) !== 'valid'
  ) {
    throw new RangeError(
      'AgentCoreStore: eventPayload mixed event body exceeds the library ceiling of ' +
        '10,000,000 UTF-8 bytes; it is never truncated.',
    );
  }
}

/** Read only static schema tags and member names, never lazy type entries. */
function modelHas(value: unknown, tag: 3 | 4, required: readonly string[]): boolean {
  if (!Array.isArray(value)) return false;
  if (Object.getOwnPropertyDescriptor(value, '0')?.value !== tag) return false;
  const members: unknown = Object.getOwnPropertyDescriptor(value, '4')?.value;
  if (!Array.isArray(members)) return false;
  const missing = new Set(required);
  for (let index = 0; index < members.length && missing.size > 0; index++) {
    const name: unknown = Object.getOwnPropertyDescriptor(members, String(index))?.value;
    if (typeof name === 'string') missing.delete(name);
  }
  return missing.size === 0;
}

/** SDK export getters are supported; an unreadable or older model grants no capability. */
export function sdkModelsEventPayload(mod: BedrockAgentCoreSdkModule): boolean {
  try {
    const create = mod.CreateEventInput$;
    const payload = mod.PayloadType$;
    const conversational = mod.Conversational$;
    const content = mod.Content$;
    return (
      modelHas(create, 3, ['memoryId', 'payload']) &&
      modelHas(payload, 4, ['conversational', 'blob']) &&
      modelHas(conversational, 3, ['content', 'role']) &&
      modelHas(content, 4, ['text'])
    );
  } catch {
    return false;
  }
}
