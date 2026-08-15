/**
 * artifacts/wants — ref ARGUMENTS at dispatch (Phase 2, Leg 1).
 *
 * A tool declares `wants: { dataset: 'dataset/rows' }` and the FRAMEWORK
 * resolves the ref before `execute`: the model speaks the ~26-char ticket as
 * the argument, dispatch redeems it under the run's own scope and kind-checks
 * the meta, and the handler receives the RESOLVED DATA (plus the meta on
 * `ctx.wanted`). A stale, unknown, or wrong-kind ref NEVER reaches the tool —
 * the model reads a teaching refusal that lists the live refs of the wanted
 * kind in scope (the innerRunRecords law: correct by naming what CAN resolve).
 *
 * The declare-and-push precedent, verb for verb: `needs` resolves a credential
 * before execute and injects `ctx.credential`; `wants` resolves data before
 * execute and injects it into the args. Both fail closed; neither lets the
 * model fabricate what the framework could not deliver.
 *
 * This module is the PURE half — validation at `defineTool` time and
 * resolution over the five-verb port. It never imports `core/`: the
 * tool-dispatch layer composes the scope, adapts the outcome onto the typed
 * `agentfootprint.artifacts.*` events (`op: 'dispatch'`), and refuses the
 * call. Core wires artifacts; never the reverse.
 */

import { ArtifactIntegrityError } from './types.js';
import type { ArtifactMeta, ArtifactScope, ArtifactStore } from './types.js';
import type { ArtifactRefusalReason } from './capability.js';

/**
 * The declaration on a tool: argument name → the artifact `kind` that
 * argument must resolve to (consumer vocabulary, exact-match — no wildcards,
 * no hierarchy; `'dataset/rows'` is one kind, not a family).
 */
export type ToolWants = Readonly<Record<string, string>>;

/**
 * Refuse a `wants` declaration this library cannot honor, at definition time
 * — naming the tool and the fix, never at the first dispatch of the first
 * run. Checks, per declared argument:
 *   • the kind is a non-empty string (a blank kind can never match a mint);
 *   • when the tool's `inputSchema` declares `properties`, the argument
 *     exists there (a wants-arg the model is never offered can never be
 *     filled);
 *   • when that property declares a `type`, it is `'string'` — the model
 *     passes the REF, never the bytes, so any other type is a schema that
 *     asks the model to inline what this feature exists to keep out.
 */
export function assertToolWants(
  toolName: string,
  wants: ToolWants | undefined,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): void {
  if (wants === undefined) return;
  const entries = Object.entries(wants);
  if (entries.length === 0) {
    throw new Error(
      `defineTool: tool '${toolName}' declares wants: {} — an empty declaration resolves ` +
        `nothing and reads as one that does. Name at least one argument ` +
        `(e.g. wants: { dataset: 'dataset/rows' }), or omit \`wants\` — absent means no ` +
        `argument is resolved, exactly as before.`,
    );
  }
  const properties =
    inputSchema !== undefined &&
    typeof inputSchema.properties === 'object' &&
    inputSchema.properties !== null
      ? (inputSchema.properties as Readonly<Record<string, unknown>>)
      : undefined;
  for (const [argName, kind] of entries) {
    if (typeof kind !== 'string' || kind.trim().length === 0) {
      throw new Error(
        `defineTool: tool '${toolName}' declares wants.${argName} = ${JSON.stringify(kind)}, ` +
          `which is not an artifact kind. The value is the consumer vocabulary the resolved ` +
          `artifact's meta.kind must equal exactly (e.g. 'dataset/rows').`,
      );
    }
    if (properties !== undefined && !(argName in properties)) {
      throw new Error(
        `defineTool: tool '${toolName}' declares wants.${argName}, but inputSchema.properties ` +
          `has no '${argName}' — the model is never offered that argument, so no ref could ` +
          `ever arrive to resolve. Add it to inputSchema (type: 'string' — the model passes ` +
          `the art_… ref), or drop it from \`wants\`.`,
      );
    }
    const property = properties?.[argName];
    const declaredType =
      typeof property === 'object' && property !== null
        ? (property as { type?: unknown }).type
        : undefined;
    if (declaredType !== undefined && declaredType !== 'string') {
      throw new Error(
        `defineTool: tool '${toolName}' declares wants.${argName}, but inputSchema declares ` +
          `that argument as type '${String(declaredType)}'. A wants-argument is spoken as the ` +
          `ref STRING (the model routes the ticket, never the bytes) — declare it ` +
          `{ type: 'string' }.`,
      );
    }
  }
}

/** One dispatch-time refusal — the fact the tool-calls stage puts on the
 *  record (`artifacts.refused`, `op: 'dispatch'`) beside the teaching
 *  sentence the model reads. */
export interface WantsRefusal {
  readonly argName: string;
  /** The kind the declaration wanted. */
  readonly kind: string;
  readonly reason: Extract<
    ArtifactRefusalReason,
    'invalid-input' | 'missing-or-expired' | 'kind-mismatch' | 'digest-mismatch'
  >;
  /** The ref the model spoke, when it spoke one. */
  readonly ref?: string;
  /** The teaching sentence for THIS argument (the combined refusal the model
   *  reads joins every argument's sentence). */
  readonly detail: string;
}

/** What resolving a tool's `wants` produced. Exactly one arm. */
export type WantsResolution =
  | {
      readonly ok: true;
      /** The call args with every resolved argument REPLACED by its data. */
      readonly args: Readonly<Record<string, unknown>>;
      /** The claim tickets behind each resolved argument — `ctx.wanted`. */
      readonly wanted: Readonly<Record<string, ArtifactMeta>>;
      /** The refs that resolved, in declaration order — for the record. */
      readonly resolved: ReadonlyArray<{ readonly argName: string; readonly meta: ArtifactMeta }>;
    }
  | {
      readonly ok: false;
      readonly refusals: readonly WantsRefusal[];
      /** The one teaching refusal the model reads — every failed argument's
       *  sentence, joined. */
      readonly refusal: string;
    };

/** How many live refs a refusal lists, and how many rows the listing pages
 *  through to find them. Bounded — a refusal is a lesson, not a catalog. */
const LIVE_REF_LIST_LIMIT = 10;
const LIVE_REF_SCAN_LIMIT = 200;

/**
 * Which arguments this tool's OWN schema marks required — the half of the
 * contract that says whether an omitted ref is a choice or a hole.
 *
 * Read here rather than trusted to the args gate: `toolArgValidation` is an
 * agent-wide dial that an operator may set to `'warn'` or `'off'`, and a
 * `wants` declaration is a promise about DELIVERED DATA, not about schema
 * hygiene. The belt already refuses a non-string ref behind a disabled gate
 * (`'ref STRING'`); omission is the same class of hole and gets the same belt.
 */
function requiredArgNames(
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): ReadonlySet<string> {
  const required = inputSchema?.required;
  if (!Array.isArray(required)) return new Set();
  return new Set(required.filter((name): name is string => typeof name === 'string'));
}

/** The live refs of `kind` in scope, newest first, bounded — what a refusal
 *  names so the model can correct instead of retrying the same dead ref. */
async function liveRefsOfKind(
  store: ArtifactStore,
  scope: ArtifactScope,
  kind: string,
): Promise<readonly ArtifactMeta[]> {
  const found: ArtifactMeta[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  // Page cap beside the row cap: a misbehaving BYO store that returns empty
  // pages with a never-advancing cursor must not spin this loop forever — the
  // row-based SCAN_LIMIT only advances when pages carry rows.
  let pages = 0;
  do {
    const page = await store.list(scope, { ...(cursor !== undefined && { cursor }) });
    for (const meta of page.artifacts) {
      scanned += 1;
      if (meta.kind === kind) found.push(meta);
      if (found.length >= LIVE_REF_LIST_LIMIT || scanned >= LIVE_REF_SCAN_LIMIT) return found;
    }
    cursor = page.cursor === cursor ? undefined : page.cursor;
    pages += 1;
  } while (cursor !== undefined && pages < 50);
  return found;
}

/** `art_h7Kq… ('Q3 rows', 6100 bytes)` — one listed live ref. */
function describeLiveRef(meta: ArtifactMeta): string {
  return `${meta.ref}${
    meta.label !== undefined ? ` ('${meta.label}', ${meta.bytes} bytes)` : ` (${meta.bytes} bytes)`
  }`;
}

/** What the model actually put in the argument, named the way a reader would
 *  say it — `typeof null` is `'object'`, and a refusal that says "not a
 *  object" about a `null` teaches the wrong correction. */
function describeSpokenValue(spoken: unknown): string {
  if (spoken === null) return 'null';
  if (Array.isArray(spoken)) return 'an array';
  if (typeof spoken === 'string') return 'an empty string';
  return `a ${typeof spoken}`;
}

/** The correcting clause: what CAN resolve, or the honest "nothing can". */
function liveRefsClause(kind: string, live: readonly ArtifactMeta[]): string {
  if (live.length === 0) {
    return (
      `No live '${kind}' artifacts exist in this run's scope right now — produce one first ` +
      `(a tool that stores '${kind}', or re-run the step that minted it).`
    );
  }
  return `Live '${kind}' refs in scope: ${live
    .map(describeLiveRef)
    .join(', ')}. Pass one of these.`;
}

/**
 * Resolve one tool's declared `wants` against the run's scope — the whole
 * Leg-1 law in one place, shared by every dispatch door.
 *
 * An ABSENT declared argument is judged by the tool's own schema (9.38.0):
 * `required` there means the tool cannot do its job without the data, so
 * dispatch refuses BY NAME rather than executing a handler that believes its
 * payload was resolved; anything else is optional, and the model choosing not
 * to pass one is legitimate (`ctx.wanted` simply has no entry for it — absent
 * and empty are different facts). Pass the tool's `inputSchema` to have that
 * judged; omit it and every declared argument is treated as optional, which is
 * what a door that genuinely has no schema can honestly say.
 *
 * Per declared argument that is PRESENT in the call args:
 *   • a non-string value is refused (`invalid-input`) — the argument is
 *     spoken as the ref string, never the bytes;
 *   • a ref that does not resolve in scope is refused
 *     (`missing-or-expired`), listing the live refs of the wanted kind;
 *   • a ref whose meta.kind differs from the declaration is refused
 *     (`kind-mismatch`), naming both kinds and listing what would fit;
 *   • a stored payload failing its digest re-check is refused
 *     (`digest-mismatch`) — corrupt bytes never reach the tool as if whole.
 *
 * ALL declared args are judged before answering, so one refusal teaches the
 * whole correction rather than one argument per retry loop.
 */
export async function resolveToolWants(
  store: ArtifactStore,
  scope: ArtifactScope,
  toolName: string,
  wants: ToolWants,
  args: Readonly<Record<string, unknown>>,
  inputSchema?: Readonly<Record<string, unknown>>,
): Promise<WantsResolution> {
  const refusals: WantsRefusal[] = [];
  const wanted: Record<string, ArtifactMeta> = {};
  const resolvedList: Array<{ argName: string; meta: ArtifactMeta }> = [];
  const nextArgs: Record<string, unknown> = { ...args };
  const required = requiredArgNames(inputSchema);

  for (const [argName, kind] of Object.entries(wants)) {
    if (!(argName in args) || args[argName] === undefined) {
      // Optional: the model chose not to pass one. Nothing to resolve, and
      // nothing to complain about.
      if (!required.has(argName)) continue;
      // Required: the tool declared it wants '<kind>' HERE and its schema
      // declared the argument mandatory. Executing anyway would hand the
      // handler an argument it believes the framework resolved and did not —
      // accepted-and-silently-wrong, in the one place this feature exists to
      // make impossible.
      const live = await liveRefsOfKind(store, scope, kind);
      refusals.push({
        argName,
        kind,
        reason: 'invalid-input',
        detail:
          `'${argName}' is required and no value was passed — this tool declares it wants a ` +
          `'${kind}' artifact there, and the framework resolves the ref BEFORE the tool runs, ` +
          `so the tool is never executed without it. Pass the art_… ref as '${argName}'. ` +
          `${liveRefsClause(kind, live)}`,
      });
      continue;
    }
    const spoken = args[argName];
    if (typeof spoken !== 'string' || spoken.trim().length === 0) {
      const live = await liveRefsOfKind(store, scope, kind);
      refusals.push({
        argName,
        kind,
        reason: 'invalid-input',
        detail:
          `'${argName}' must be an artifact ref STRING (an art_… ticket), not ` +
          `${describeSpokenValue(spoken)} — this tool declares ` +
          `it wants '${kind}' there and the framework resolves the ref for you; never inline ` +
          `the data. ${liveRefsClause(kind, live)}`,
      });
      continue;
    }
    let record;
    try {
      record = await store.get(scope, spoken);
    } catch (err) {
      if (err instanceof ArtifactIntegrityError) {
        refusals.push({
          argName,
          kind,
          reason: 'digest-mismatch',
          ref: spoken,
          detail:
            `'${argName}' = ${spoken} failed its integrity re-check — the stored payload no ` +
            `longer matches its minted digest, and corrupt bytes are never delivered as ` +
            `whole. Re-create the artifact from its source, then pass the new ref.`,
        });
        continue;
      }
      throw err;
    }
    if (record === null) {
      const live = await liveRefsOfKind(store, scope, kind);
      refusals.push({
        argName,
        kind,
        reason: 'missing-or-expired',
        ref: spoken,
        detail:
          `'${argName}' = ${spoken} does not resolve in this run's scope — expired, swept, ` +
          `or never stored here. ${liveRefsClause(kind, live)}`,
      });
      continue;
    }
    if (record.meta.kind !== kind) {
      const live = await liveRefsOfKind(store, scope, kind);
      refusals.push({
        argName,
        kind,
        reason: 'kind-mismatch',
        ref: spoken,
        detail:
          `'${argName}' = ${spoken} resolves, but it is '${record.meta.kind}' and this ` +
          `argument wants '${kind}' — the wrong parcel for this ticket window. ` +
          `${liveRefsClause(kind, live)}`,
      });
      continue;
    }
    nextArgs[argName] = record.data;
    wanted[argName] = record.meta;
    resolvedList.push({ argName, meta: record.meta });
  }

  if (refusals.length > 0) {
    return {
      ok: false,
      refusals,
      refusal:
        `Tool '${toolName}' was not executed — its declared artifact argument` +
        `${refusals.length > 1 ? 's' : ''} did not resolve. ` +
        refusals.map((r) => r.detail).join(' '),
    };
  }
  return { ok: true, args: nextArgs, wanted, resolved: resolvedList };
}

/**
 * The teaching refusal for a `wants`-declaring tool dispatched where NO
 * artifact store is attached — fail-closed, naming the config fix, because
 * running the tool with the raw ref string where it expects resolved data
 * would be accepted-and-silently-wrong. (Agent dispatch refuses this at
 * BUILD for statically registered tools; this sentence serves the doors
 * that only meet the tool at dispatch — provider-served tools, `mcpServe`.)
 */
export function wantsNeedsStoreRefusal(toolName: string, wants: ToolWants): string {
  const declared = Object.entries(wants)
    .map(([arg, kind]) => `${arg}: '${kind}'`)
    .join(', ');
  return (
    `Tool '${toolName}' declares artifact arguments (wants: { ${declared} }) but no artifact ` +
    `store is attached here, so its refs cannot be resolved and the tool was not executed. ` +
    `This is configuration, not something to retry: attach a store ` +
    `(Agent.create({ ..., artifacts }) — inMemoryArtifacts(), fileArtifacts({ directory }), ` +
    `or sqliteArtifacts({ file })), or serve this tool from an agent that has one.`
  );
}
