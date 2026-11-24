/** Private request-attempt custody for the one request-only record note. */
import { LATE_RECORD_NOTE_ATTRIBUTION } from '../lib/saidByPerson.js';
import { sha256Hex } from '../lib/sha256.js';
import type { LLMCallHooks, LLMProvider, LLMResponse } from './types.js';

export type LateNoteDisposition = 'submitted' | 'omitted' | 'not-dispatched' | 'unavailable';
interface Receipt {
  readonly ordinal: number;
  readonly disposition: LateNoteDisposition;
}
export interface LateRecordNoteReceipt {
  readonly attempts: readonly Receipt[];
  readonly accepted?: Receipt;
}
export interface LateRecordNoteWireProof {
  readonly ordinal: number;
  readonly digest: string;
  readonly block: number;
}
interface Proof extends Receipt {
  readonly digest?: string;
  readonly block?: number;
}
interface Session {
  readonly text: string | undefined;
  readonly continuing: boolean;
  nextOrdinal: number;
  readonly proofs: Map<number, Proof>;
}
interface Attempt {
  readonly session: Session;
  readonly target: LLMProvider;
  readonly complete: LLMProvider['complete'];
  readonly stream: LLMProvider['stream'];
  readonly router: boolean;
  readonly parent: Attempt | undefined;
  readonly depth: number;
  readonly ordinal?: number;
  active: boolean;
  begun: boolean;
  proof?: Proof;
}
interface OwnedResponse {
  readonly session: Session;
  readonly ordinal: number;
  readonly text: string;
}
interface WireRow {
  readonly role: string;
  readonly content?: unknown;
}

const NOTE_ATTEMPT = Symbol('agentfootprint.lateRecordNote');
type NoteHooks = LLMCallHooks & { readonly [NOTE_ATTEMPT]?: object };
const owners = new WeakMap<object, Session | Attempt>();
const responses = new WeakMap<LLMResponse, OwnedResponse>();
const routers = new WeakMap<LLMProvider, Pick<LLMProvider, 'complete' | 'stream'>>();
const MAX_LEAVES = 64;
const MAX_ROUTER_DEPTH = 12;
const MAX_WIRE_BLOCKS = 4096;
const MAX_ANSWER_CHARS = 262144;

/** Only the exact owned routing functions may hand note custody to a selected child. */
export function lateRecordNoteRouter<T extends LLMProvider>(router: T): T {
  routers.set(router, { complete: router.complete, stream: router.stream });
  return router;
}

function ownsDispatch(target: LLMProvider, methods: Pick<LLMProvider, 'complete' | 'stream'>) {
  return (
    Object.getOwnPropertyDescriptor(target, 'complete')?.value === methods.complete &&
    Object.getOwnPropertyDescriptor(target, 'stream')?.value === methods.stream
  );
}

function activeThroughParents(attempt: Attempt): boolean {
  for (let node: Attempt | undefined = attempt; node !== undefined; node = node.parent) {
    if (!node.active) return false;
  }
  return true;
}

function ownerOf(hooks: LLMCallHooks | undefined): Session | Attempt | undefined {
  const token = (hooks as NoteHooks | undefined)?.[NOTE_ATTEMPT];
  return token === undefined ? undefined : owners.get(token);
}

function bind(hooks: LLMCallHooks | undefined, owner: Session | Attempt): LLMCallHooks {
  const token = Object.freeze({});
  owners.set(token, owner);
  const bound: NoteHooks = { ...hooks, [NOTE_ATTEMPT]: token };
  return bound;
}

/** Join `requestAttempt` at the actual selected provider, including owned fallback and retry leaves. */
export function scopeLateRecordNote(
  hooks: LLMCallHooks | undefined,
  target: LLMProvider | undefined,
) {
  const owner = ownerOf(hooks);
  if (owner === undefined || target === undefined) return undefined;
  const parent = 'session' in owner ? owner : undefined;
  if (
    parent !== undefined &&
    (!activeThroughParents(parent) || !parent.router || !ownsDispatch(parent.target, parent))
  )
    return undefined;
  const depth = (parent?.depth ?? 0) + 1;
  if (depth > MAX_ROUTER_DEPTH) return undefined;
  const session = 'session' in owner ? owner.session : owner;
  const methods = routers.get(target);
  const router = methods !== undefined && ownsDispatch(target, methods);
  const ordinal = router ? undefined : ++session.nextOrdinal;
  if (ordinal !== undefined && ordinal > MAX_LEAVES) return undefined;
  const attempt: Attempt = {
    session,
    target,
    complete: target.complete,
    stream: target.stream,
    router,
    parent,
    depth,
    ordinal,
    active: true,
    begun: false,
  };
  return {
    bind: (next: LLMCallHooks) => bind(next, attempt),
    close(notDispatched: boolean) {
      attempt.active = false;
      if (ordinal === undefined) return;
      const proof =
        attempt.proof ??
        ({
          ordinal,
          disposition: notDispatched ? 'not-dispatched' : 'unavailable',
        } as const);
      session.proofs.set(ordinal, proof);
    },
  };
}

function responseText(response: LLMResponse): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(response, 'content')?.value;
  return typeof value === 'string' && value.length <= MAX_ANSWER_CHARS ? value : undefined;
}

/** Admit the note at an owned native encoder, before the request can be signed. */
export function beginLateRecordNote(
  hooks: LLMCallHooks | undefined,
  target: LLMProvider,
  route: 'plain' | 'signing',
) {
  const owner = ownerOf(hooks);
  if (
    owner === undefined ||
    !('session' in owner) ||
    !activeThroughParents(owner) ||
    owner.begun ||
    owner.target !== target ||
    !ownsDispatch(target, owner) ||
    owner.ordinal === undefined
  )
    return undefined;
  owner.begun = true;
  const ordinal = owner.ordinal;
  const note = route === 'plain' && !owner.session.continuing ? owner.session.text : undefined;
  let handedOff = false;
  const hasFrame = (content: unknown) =>
    typeof content === 'string' && content.startsWith(LATE_RECORD_NOTE_ATTRIBUTION);
  let blocksLeft = MAX_WIRE_BLOCKS;
  const noteFree = ({ role, content }: WireRow) => {
    if (role !== 'user') return true;
    if (!Array.isArray(content)) return !hasFrame(content);
    blocksLeft -= content.length;
    return (
      blocksLeft >= 0 &&
      content.every(
        (block: unknown) =>
          typeof block !== 'object' ||
          block === null ||
          !hasFrame(Object.getOwnPropertyDescriptor(block, 'text')?.value),
      )
    );
  };
  return {
    note,
    handoff(rows: readonly WireRow[], ownBlock?: object) {
      if (!activeThroughParents(owner) || handedOff || rows.length > MAX_WIRE_BLOCKS) return;
      handedOff = true;
      if (note === undefined) {
        if (ownBlock === undefined && rows.every(noteFree))
          owner.proof = { ordinal, disposition: 'omitted' };
        return;
      }
      const last = rows.at(-1);
      if (
        last !== ownBlock ||
        last?.role !== 'user' ||
        last.content !== note ||
        rows.some((row, i) => i < rows.length - 1 && (row === ownBlock || !noteFree(row)))
      )
        return;
      owner.proof = {
        ordinal,
        disposition: 'submitted',
        digest: sha256Hex(JSON.stringify(note)),
        block: rows.length - 1,
      };
    },
    accept(response: LLMResponse) {
      if (!activeThroughParents(owner) || responses.has(response)) return;
      const text = responseText(response);
      if (text !== undefined) responses.set(response, { session: owner.session, ordinal, text });
    },
  };
}

/** Library-owned copies can preserve an association only for the same answer bytes. */
export function carryLateRecordNoteResponse(from: LLMResponse, to: LLMResponse): LLMResponse {
  const observed = responses.get(from);
  if (
    observed !== undefined &&
    observed.text === responseText(from) &&
    observed.text === responseText(to) &&
    !responses.has(to)
  )
    responses.set(to, observed);
  return to;
}

function publicRow({ ordinal, disposition }: Proof): Receipt {
  return { ordinal, disposition };
}

/** One note gathered for this native call. No raw note or hash becomes public evidence. */
export function trackLateRecordNote(text: string | undefined, continuing: boolean) {
  const session: Session = { text, continuing, nextOrdinal: 0, proofs: new Map() };
  return {
    hooks: (hooks: LLMCallHooks) => bind(hooks, session),
    privateProofs(): readonly LateRecordNoteWireProof[] {
      return [...session.proofs.values()].flatMap(({ ordinal, digest, block }) =>
        digest === undefined || block === undefined ? [] : [{ ordinal, digest, block }],
      );
    },
    receipt(answer?: LLMResponse): LateRecordNoteReceipt {
      const named = answer === undefined ? undefined : responses.get(answer);
      const accepted =
        named?.session === session &&
        answer !== undefined &&
        named.text === responseText(answer) &&
        session.nextOrdinal <= MAX_LEAVES
          ? session.proofs.get(named.ordinal)
          : undefined;
      const attempts = [...session.proofs.values()]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(publicRow);
      return { attempts, ...(accepted !== undefined && { accepted: publicRow(accepted) }) };
    },
  };
}
