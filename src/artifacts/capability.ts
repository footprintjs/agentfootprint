/**
 * artifacts/capability — `ctx.artifacts`, the scope-bound door a tool gets.
 *
 * Shaped exactly like `ctx.credentials`:
 *   • ALWAYS present — with no store attached every method is a teaching
 *     refusal naming how to attach one, so a tool can never silently
 *     optional-chain past a store that is not there;
 *   • fail-closed — the refusal throws; `ctx.hasArtifacts` is the fact to
 *     branch on for an intentional degraded mode;
 *   • scope composed by the FRAMEWORK from the run's identity/session — the
 *     capability closes over it, so a tool cannot name, widen or replace the
 *     scope it resolves under. The five verbs here take no scope argument on
 *     purpose: that argument was already answered by whoever built the
 *     context.
 *
 * Every hop lands on the record AS IT HAPPENS: this module reports facts to a
 * neutral sink (a plain callback), and the tool-dispatch layer adapts that
 * sink onto the typed event channel. Neutral so this folder never imports the
 * event system or the agent — core wires artifacts, never the reverse.
 */

import {
  ArtifactIntegrityError,
  InvalidArtifactError,
  UnknownParentRefError,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactOrigin,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactScope,
  type ArtifactStore,
  type PutArtifactInput,
  type SweptArtifact,
} from './types.js';

/** A tool's `put` — everything the caller owns EXCEPT `origin`, which the
 *  framework stamps from the run's own facts (never invented, never spoofed). */
export type ToolArtifactPutInput = Omit<PutArtifactInput, 'origin'>;

/**
 * The capability on `ctx.artifacts` — the store's five verbs with the scope
 * already answered.
 */
export interface ToolArtifacts {
  /** Store a payload under this run's scope; returns the claim ticket. */
  put(input: ToolArtifactPutInput): Promise<ArtifactMeta>;
  /** The ticket without the payload. `null` for missing-or-expired. */
  head(ref: ArtifactRef): Promise<ArtifactMeta | null>;
  /** Ticket + payload. `null` for missing-or-expired; a digest mismatch throws. */
  get(ref: ArtifactRef): Promise<ArtifactRecord | null>;
  /** Remove one artifact this scope holds. */
  delete(ref: ArtifactRef): Promise<void>;
  /** Page through this scope's tickets, newest first. */
  list(options?: ArtifactListOptions): Promise<ArtifactListResult>;
}

// ─── The facts this door reports ─────────────────────────────────────

/** Which verb a refusal happened on. */
export type ArtifactOp = 'put' | 'head' | 'get' | 'delete' | 'list';

/** Why a verb refused (or answered "no data" on the record). */
export type ArtifactRefusalReason =
  | 'no-store'
  | 'missing-or-expired'
  | 'unknown-parent'
  | 'digest-mismatch'
  | 'invalid-input';

/** One thing that happened at this door — meta only, never payloads. */
export type ArtifactEventFact =
  | { readonly type: 'minted'; readonly meta: ArtifactMeta }
  | {
      readonly type: 'resolved';
      readonly ref: ArtifactRef;
      readonly via: 'head' | 'get';
      readonly kind: string;
      readonly bytes: number;
    }
  | { readonly type: 'expired'; readonly swept: SweptArtifact }
  | {
      readonly type: 'refused';
      readonly op: ArtifactOp;
      readonly reason: ArtifactRefusalReason;
      readonly ref?: ArtifactRef;
      readonly detail?: string;
    };

/** Where facts go. The dispatch layer adapts this onto the typed events. */
export type ArtifactEventSink = (fact: ArtifactEventFact) => void;

/** What `bindArtifacts` needs beyond the store and the scope. */
export interface BindArtifactsOptions {
  /** Stamped onto every mint — the run's own facts, absent when unknown. */
  readonly origin?: ArtifactOrigin;
  /** Fact sink. Absent = silent binding (raw store semantics, no record). */
  readonly onEvent?: ArtifactEventSink;
}

/**
 * Bind a store to one run's scope — the framework's move, made where the
 * scope is known and a tool cannot reach.
 */
export function bindArtifacts(
  store: ArtifactStore,
  scope: ArtifactScope,
  options: BindArtifactsOptions = {},
): ToolArtifacts {
  const { origin, onEvent } = options;
  const report = (fact: ArtifactEventFact): void => {
    onEvent?.(fact);
  };

  return {
    async put(input: ToolArtifactPutInput): Promise<ArtifactMeta> {
      try {
        // `origin` is the framework's field: whatever a caller managed to put
        // there is discarded in favor of the run's own facts.
        const result = await store.put(scope, {
          ...input,
          ...(origin !== undefined ? { origin } : {}),
        });
        for (const swept of result.swept) report({ type: 'expired', swept });
        report({ type: 'minted', meta: result.meta });
        return result.meta;
      } catch (err) {
        if (err instanceof UnknownParentRefError) {
          report({ type: 'refused', op: 'put', reason: 'unknown-parent', detail: err.message });
        } else if (err instanceof InvalidArtifactError) {
          report({ type: 'refused', op: 'put', reason: 'invalid-input', detail: err.message });
        }
        throw err;
      }
    },

    async head(ref: ArtifactRef): Promise<ArtifactMeta | null> {
      const meta = await store.head(scope, ref);
      if (meta === null) {
        report({ type: 'refused', op: 'head', reason: 'missing-or-expired', ref });
        return null;
      }
      report({ type: 'resolved', ref: meta.ref, via: 'head', kind: meta.kind, bytes: meta.bytes });
      return meta;
    },

    async get(ref: ArtifactRef): Promise<ArtifactRecord | null> {
      let record: ArtifactRecord | null;
      try {
        record = await store.get(scope, ref);
      } catch (err) {
        if (err instanceof ArtifactIntegrityError) {
          report({
            type: 'refused',
            op: 'get',
            reason: 'digest-mismatch',
            ref,
            detail: err.message,
          });
        }
        throw err;
      }
      if (record === null) {
        report({ type: 'refused', op: 'get', reason: 'missing-or-expired', ref });
        return null;
      }
      report({
        type: 'resolved',
        ref: record.meta.ref,
        via: 'get',
        kind: record.meta.kind,
        bytes: record.meta.bytes,
      });
      return record;
    },

    delete(ref: ArtifactRef): Promise<void> {
      return store.delete(scope, ref);
    },

    list(options?: ArtifactListOptions): Promise<ArtifactListResult> {
      return store.list(scope, options);
    },
  };
}

/**
 * The fail-closed capability used when NO store is attached. Every verb
 * throws the same teaching refusal — loud, named, and on the record — so
 * `ctx.artifacts` is never `undefined` and a missing store can never read as
 * an empty one. Branch on `ctx.hasArtifacts` for an intentional no-store
 * mode. (The `unconfiguredCredentialProvider` law, verb for verb.)
 */
export function unconfiguredArtifacts(onEvent?: ArtifactEventSink): ToolArtifacts {
  const refuse = (op: ArtifactOp, ref?: ArtifactRef): Promise<never> => {
    onEvent?.({ type: 'refused', op, reason: 'no-store', ...(ref !== undefined && { ref }) });
    return Promise.reject(
      new Error(
        `No artifact store is attached, but this tool called ctx.artifacts.${op}(...). ` +
          `Pass \`artifacts\` to Agent.create({ ..., artifacts }) — inMemoryArtifacts() for ` +
          `an in-process store, fileArtifacts({ directory }) or sqliteArtifacts({ file }) for ` +
          `one that survives a restart. A tool that intentionally supports running without a ` +
          `store should branch on \`ctx.hasArtifacts\` instead of catching this.`,
      ),
    );
  };
  return {
    put: () => refuse('put'),
    head: (ref) => refuse('head', ref),
    get: (ref) => refuse('get', ref),
    delete: (ref) => refuse('delete', ref),
    list: () => refuse('list'),
  };
}
