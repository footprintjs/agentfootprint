/**
 * replay — who may send an MCP tool call again, and what is known of what each
 * attempt did: two facts, decided apart and recorded apart.
 *
 * Pattern: a declaration read once + one permission rule + one accumulator.
 * Role:    Layer-3 tool transport. `mcpClient({ replay })` reads the app's
 *          declaration (`replayDeclarationOf`) when the client is built. The
 *          call's retry series (`throttleRetry.ts` · `Series`) asks `permit`
 *          before every repeat and records the answer beside the attempt;
 *          `SeriesKnowledge` carries what is known of the series' effect from
 *          one attempt to the next.
 *
 * ── THE LAW ──────────────────────────────────────────────────────────────────
 * PERMISSION to repeat comes only from the app: the (server, tool) pairs it
 * declares — the server is the client the declaration is given to — and the
 * failure kinds each tool may be repeated on. Never from the model, a tool's
 * description or a server's annotations (`readOnlyHint`): nothing here reads
 * them. It is configuration, read once when the client is built — never a
 * per-call question.
 *
 * KNOWLEDGE of whether an attempt ran comes only from the record and from a
 * documented service guarantee. `none` needs one: AgentCore Runtime documents
 * its session-busy refusal as made while the session is starting or stopping
 * (`adapters/mcp/agentcoreRuntime/sessionBusy.ts` cites it). A 429 is not one:
 * RFC 6585 §4 defines it as rate limiting, and `Retry-After` says when to ask
 * again, not that asking is safe. A vendor's own SDK may retry its own 429s
 * because the vendor documents its own service; a generic MCP client cannot
 * assume that of an arbitrary server.
 *
 * Neither is read from the other: a permission never makes an effect known,
 * and an effect never grants a permission.
 *
 * ── WHAT A REPEAT IS ─────────────────────────────────────────────────────────
 * The same validated, authorized request sent again: the same body — the same
 * arguments — to the same server, in the same session, as the same identity.
 * Nothing is re-planned. A credential the library vends, or a signature, is
 * made afresh for each attempt (signatures expire), for that same identity.
 *
 * ── THE POLICIES ─────────────────────────────────────────────────────────────
 *   'compatibility' — the 11.x default, today's behaviour by name: a 429 is
 *       repeated for every tool, on the ASSUMPTION that the server refused it
 *       before running it. Each such repeat records that assumption; the
 *       attempt's effect stays `unknown`.
 *   'app-authorized' — opt-in now, the default in the next major: a 429 or a
 *       network failure is repeated only when the app's entry for the tool
 *       names it.
 *
 * Under both, a documented pre-execution refusal from the adapter the app chose
 * is repeated within the budget, and THE SIDE-EFFECT GUARD holds: a tool the
 * app declares as making changes is never repeated automatically unless the
 * server is declared to deduplicate by an idempotency key the call carries —
 * footprintjs's law, a retry of an effect without a key can apply it twice. A
 * key protects only when the server uses it; the library cannot check that.
 *
 * The protocol's own requests (`initialize`, `tools/list`, notifications) run
 * no tool. The declaration does not govern them, and a 429 on one is asked
 * again under both policies, as it always was. They file no record.
 */

import { errorCategory } from 'footprintjs';

import type {
  ToolRequestEffect,
  ToolRequestGuarantee,
  ToolRequestPermission,
  ToolRequestReason,
  ToolRequestReplayKind,
} from '../events/payloads.js';

// ─── The declaration, as the app writes it ───────────────────────────

/**
 * Which rule decides whether a tool call is sent again after a refusal or a
 * failure. `'compatibility'` is the default in 11.x; `'app-authorized'` becomes
 * the default in the next major.
 */
export type McpReplayPolicy = 'app-authorized' | 'compatibility';

/**
 * A failure kind the app may declare a tool repeatable on: HTTP 429
 * (`'throttle'`), or a request that failed in transport without an answer
 * (`'network'`, footprintjs's category: a dropped or refused connection, or a
 * timeout raised below the retry series). Either may have run on the server, so
 * a repeat after it leaves the call's effect `unknown`.
 */
export type McpReplayKind = ToolRequestReplayKind;

/** One tool's entry in {@link McpReplayOptions.tools}. */
export interface McpReplayTool {
  /**
   * The failure kinds this tool may be sent again on. Default: none. Under
   * `'compatibility'` a 429 is repeated without it, recorded as an assumption;
   * under `'app-authorized'` only what is named here is repeated.
   */
  readonly on?: readonly McpReplayKind[];
  /**
   * `true` — this tool makes changes. It is then never sent again
   * automatically, under either policy, unless the server is declared to
   * deduplicate (`deduplicates`) and the call carries the key.
   */
  readonly changes?: boolean;
}

/**
 * How the server deduplicates a tool call: by an idempotency key the call
 * carries in the named argument. Declare it only when the server does; a key
 * protects only when the server uses it.
 */
export interface McpReplayDeduplication {
  /**
   * The argument that carries the key — present as a non-empty string in the
   * call for a repeat to be allowed. Set it in your code (a `toolMiddleware`
   * that writes it from the call), never from what the model wrote: a key the
   * model reuses for a different operation makes the server drop that one.
   */
  readonly argument: string;
}

/**
 * The app's replay declaration for one MCP server — its client. Read once when
 * the client is built; a field it does not know is refused there, so a
 * misspelled `changes` cannot quietly switch the side-effect guard off.
 */
export interface McpReplayOptions {
  /** Default `'compatibility'` in 11.x. */
  readonly policy?: McpReplayPolicy;
  /** The tools of this server, by the name the server lists them under. */
  readonly tools?: Readonly<Record<string, McpReplayTool>>;
  /** The server deduplicates by an idempotency key the call carries. */
  readonly deduplicates?: McpReplayDeduplication;
}

// ─── The declaration, as read ────────────────────────────────────────

interface ToolEntry {
  readonly on: ReadonlySet<McpReplayKind>;
  readonly changes: boolean;
}

/** @internal A declaration, read and checked once. */
export interface ReplayDeclaration {
  readonly policy: McpReplayPolicy;
  readonly tools: ReadonlyMap<string, ToolEntry>;
  /** The argument the server deduplicates by, when it is declared to. */
  readonly keyArgument?: string;
}

/** @internal No declaration: the compatibility policy, no tool named. */
export const COMPATIBILITY: ReplayDeclaration = Object.freeze({
  policy: 'compatibility',
  tools: new Map<string, ToolEntry>(),
});

const POLICIES: ReadonlySet<string> = new Set<McpReplayPolicy>(['app-authorized', 'compatibility']);
const KINDS: ReadonlySet<string> = new Set<McpReplayKind>(['throttle', 'network']);

/**
 * @internal `options` read as a declaration — `undefined` is the compatibility
 * policy with nothing named.
 *
 * @throws TypeError naming the field, never echoing a value, for anything the
 *   rule cannot mean: an unknown field, a policy or kind it does not know, an
 *   argument name that is not one.
 */
export function replayDeclarationOf(options: unknown, where: string): ReplayDeclaration {
  if (options === undefined) return COMPATIBILITY;
  const read = new DeclarationReader(`${where}: \`replay\``);
  const top = read.record(options, '', ['policy', 'tools', 'deduplicates']);
  const policy = top.policy === undefined ? 'compatibility' : read.policy(top.policy);
  const tools = new Map<string, ToolEntry>();
  if (top.tools !== undefined) {
    const named = read.record(top.tools, '.tools', undefined);
    for (const [tool, entry] of Object.entries(named)) {
      if (tool.length === 0) read.refuse('.tools', 'tool names that are not empty');
      tools.set(tool, read.tool(entry, tool));
    }
  }
  const keyArgument =
    top.deduplicates === undefined ? undefined : read.deduplication(top.deduplicates);
  return Object.freeze({
    policy,
    tools,
    ...(keyArgument !== undefined && { keyArgument }),
  });
}

/** Reads one declaration, refusing by field what it cannot mean. */
class DeclarationReader {
  constructor(private readonly where: string) {}

  /** A plain object, its own keys within `allowed` (any key when `undefined`). */
  record(
    value: unknown,
    at: string,
    allowed: readonly string[] | undefined,
  ): Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.refuse(at, 'an object');
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (allowed !== undefined) {
      for (const key of Object.keys(record)) {
        if (!allowed.includes(key)) {
          this.refuse(at, `an object with only ${allowed.map((k) => `\`${k}\``).join(', ')}`);
        }
      }
    }
    return record;
  }

  policy(value: unknown): McpReplayPolicy {
    if (typeof value === 'string' && POLICIES.has(value)) return value as McpReplayPolicy;
    return this.refuse('.policy', "'app-authorized' or 'compatibility'");
  }

  tool(value: unknown, tool: string): ToolEntry {
    const at = `.tools[${JSON.stringify(tool)}]`;
    const entry = this.record(value, at, ['on', 'changes']);
    const on = new Set<McpReplayKind>();
    if (entry.on !== undefined) {
      if (!Array.isArray(entry.on)) this.refuse(`${at}.on`, "an array of 'throttle' or 'network'");
      for (const kind of entry.on as readonly unknown[]) {
        if (typeof kind !== 'string' || !KINDS.has(kind)) {
          this.refuse(`${at}.on`, "an array of 'throttle' or 'network'");
        }
        on.add(kind as McpReplayKind);
      }
    }
    if (entry.changes !== undefined && typeof entry.changes !== 'boolean') {
      this.refuse(`${at}.changes`, 'a boolean');
    }
    return Object.freeze({ on, changes: entry.changes === true });
  }

  deduplication(value: unknown): string {
    const declared = this.record(value, '.deduplicates', ['argument']);
    const { argument } = declared;
    if (
      typeof argument === 'string' &&
      argument.length >= 1 &&
      argument.length <= 128 &&
      !hasControl(argument)
    ) {
      return argument;
    }
    return this.refuse(
      '.deduplicates.argument',
      'an argument name of 1–128 characters with no control character',
    );
  }

  refuse(at: string, wanted: string): never {
    throw new TypeError(`${this.where}${at} must be ${wanted}.`);
  }
}

// ─── What a request is, as the declaration reads it ──────────────────

/**
 * @internal One request, as the permission rule needs it: the protocol's own,
 * or a `tools/call` — its tool when the body names one, and whether its
 * arguments carry the key the server deduplicates by.
 */
export type ReplayTarget =
  | { readonly kind: 'protocol' }
  | { readonly kind: 'tool'; readonly name?: string; readonly keyCarried: boolean };

const PROTOCOL: ReplayTarget = Object.freeze({ kind: 'protocol' });
/** A request that may be a tool call and names no tool the rule can read: no entry applies. */
const UNNAMED_TOOL: ReplayTarget = Object.freeze({ kind: 'tool', keyCarried: false });

/**
 * @internal `body` — the request exactly as it will be sent — read as a
 * target. A declaration that names nothing under `'compatibility'` decides the
 * same for every request, so its bodies are never parsed.
 */
export function replayTargetOf(body: unknown, declaration: ReplayDeclaration): ReplayTarget {
  if (declaration.policy === 'compatibility' && declaration.tools.size === 0) return UNNAMED_TOOL;
  if (body === undefined || body === null) return PROTOCOL;
  if (typeof body !== 'string') return UNNAMED_TOOL;
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return UNNAMED_TOOL;
  }
  if (Array.isArray(message)) return message.some(isToolCall) ? UNNAMED_TOOL : PROTOCOL;
  if (!isToolCall(message)) return PROTOCOL;
  const params = (message as { readonly params?: unknown }).params;
  if (!isRecord(params)) return UNNAMED_TOOL;
  const { name, arguments: args } = params as {
    readonly name?: unknown;
    readonly arguments?: unknown;
  };
  const { keyArgument } = declaration;
  return {
    kind: 'tool',
    ...(typeof name === 'string' && { name }),
    keyCarried: keyArgument !== undefined && carriesKey(args, keyArgument),
  };
}

function isToolCall(message: unknown): boolean {
  return isRecord(message) && (message as { readonly method?: unknown }).method === 'tools/call';
}

/** The arguments hold a key under `argument`: a non-empty string. The server judges the rest. */
function carriesKey(args: unknown, argument: string): boolean {
  if (!isRecord(args) || !Object.prototype.hasOwnProperty.call(args, argument)) return false;
  const key = (args as Readonly<Record<string, unknown>>)[argument];
  return typeof key === 'string' && key.length > 0;
}

function isRecord(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ─── The permission rule ─────────────────────────────────────────────

/** @internal A failure the series met, as the permission rule reads it. */
export interface MetFailure {
  /** A refusal a rule recognised (`throttle`, `session-busy`), or a request that failed in transport. */
  readonly kind: 'throttle' | 'session-busy' | 'network';
  /** The documented guarantee the refusal rests on — the adapter's, on its rule. */
  readonly guarantee?: ToolRequestGuarantee;
}

/** @internal Why the series did not ask again, by the rule. */
export type ReplayDeclined = Extract<
  ToolRequestReason,
  'not-retryable' | 'not-permitted' | 'changes-without-key'
>;

/**
 * @internal The rule's answer: ask again, with what allowed it — absent for a
 * protocol request, which has no record — or not, and why.
 */
export type ReplayDecision =
  | { readonly repeat: true; readonly permission?: ToolRequestPermission }
  | { readonly repeat: false; readonly declined: ReplayDeclined };

/** @internal A thrown failure the rule can read: footprintjs's `network` category, or nothing. */
export function thrownFailure(error: unknown): MetFailure | undefined {
  return errorCategory(error) === 'network' ? { kind: 'network' } : undefined;
}

/**
 * @internal THE rule: may the series send `target` again after `failure`?
 * Asked before every repeat; the budget is asked after it.
 */
export function permit(
  declaration: ReplayDeclaration,
  target: ReplayTarget,
  failure: MetFailure,
): ReplayDecision {
  if (target.kind === 'protocol') {
    // No tool runs: a refusal is asked again as it always was, a failure is not.
    return failure.kind === 'network' ? NOT_RETRYABLE : REPEAT_PROTOCOL;
  }
  const entry = target.name === undefined ? undefined : declaration.tools.get(target.name);
  // The side-effect guard comes first, under every policy and every permission.
  if (entry?.changes === true && (declaration.keyArgument === undefined || !target.keyCarried)) {
    return CHANGES_WITHOUT_KEY;
  }
  const keyed = entry?.changes === true;
  if (failure.guarantee !== undefined) return repeat({ by: 'adapter' }, keyed);
  if (failure.kind !== 'session-busy' && entry?.on.has(failure.kind) === true) {
    return repeat({ by: 'declaration', on: failure.kind }, keyed);
  }
  if (failure.kind === 'throttle' && declaration.policy === 'compatibility') {
    return repeat({ by: 'compatibility', assumes: 'refused-before-execution' }, keyed);
  }
  return failure.kind === 'throttle' ? NOT_PERMITTED : NOT_RETRYABLE;
}

const REPEAT_PROTOCOL: ReplayDecision = Object.freeze({ repeat: true });
const NOT_RETRYABLE: ReplayDecision = Object.freeze({ repeat: false, declined: 'not-retryable' });
const NOT_PERMITTED: ReplayDecision = Object.freeze({ repeat: false, declined: 'not-permitted' });
const CHANGES_WITHOUT_KEY: ReplayDecision = Object.freeze({
  repeat: false,
  declined: 'changes-without-key',
});

function repeat(permission: ToolRequestPermission, deduplicated: boolean): ReplayDecision {
  return {
    repeat: true,
    permission: Object.freeze({ ...permission, ...(deduplicated && { deduplicated: true }) }),
  };
}

// ─── What is known of a series' effect ───────────────────────────────

/**
 * @internal What is known of a whole series' effect, one attempt at a time.
 * Uncertainty survives: once any attempt is `unknown`, the series is, whatever
 * later attempts show — a proven refusal does not resolve it, and a success
 * does not prove the operation happened only once. Evidence that something ran
 * (`applied`) is never erased by a later failure.
 */
export class SeriesKnowledge {
  private unknown = false;
  private applied = false;

  note(effect: ToolRequestEffect): void {
    if (effect === 'unknown') this.unknown = true;
    else if (effect === 'applied') this.applied = true;
  }

  get effect(): ToolRequestEffect {
    if (this.unknown) return 'unknown';
    return this.applied ? 'applied' : 'none';
  }
}

// ─── What a request's series and its call share ──────────────────────

/** @internal How `callTool` settled, as the call reads it. */
export type CallVerdict = 'completed' | 'tool-error' | 'failed';

/**
 * @internal One `tools/call` request's replay facts, shared by the series that
 * sends it and the call that waits for it — the ledger hands both the same
 * object (`requestLedger.ts`). The series writes what it sent and whether it
 * asked again after an attempt of unknown effect; the call writes how it
 * settled. Each is written once, in that order.
 */
export class RequestReplay {
  private requests = 0;
  private uncertainRepeat = false;
  private settled: CallVerdict | undefined;
  private failedAsMayHaveRun = false;

  /** The series sent the request once more. */
  sentOne(): void {
    this.requests += 1;
  }

  /** The series asked again after an attempt of unknown effect, on the app's or an adapter's permission. */
  repeatedAfterUnknown(): void {
    this.uncertainRepeat = true;
  }

  /** The call settled; `mayHaveRun` when it failed as "may have run". The first word stands. */
  settle(verdict: CallVerdict, mayHaveRun: boolean): void {
    if (this.settled !== undefined) return;
    this.settled = verdict;
    this.failedAsMayHaveRun = mayHaveRun;
  }

  get sent(): number {
    return this.requests;
  }

  get uncertain(): boolean {
    return this.uncertainRepeat;
  }

  get verdict(): CallVerdict | undefined {
    return this.settled;
  }

  get mayHaveRun(): boolean {
    return this.failedAsMayHaveRun;
  }
}

/** Whether `text` holds a control character (C0, DEL or C1). */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
