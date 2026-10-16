/**
 * hostFilled — tool arguments the HOST fills, from the run's credential or
 * identity. The model never sees them and cannot set them.
 *
 * ```ts
 * import { hostFilled, fromCredential, fromIdentity } from 'agentfootprint';
 *
 * // An MCP server whose every tool takes a `token` argument:
 * const tools = hostFilled(await crm.tools(), {
 *   token: fromCredential({ service: 'crm' }),   // ctx.credential, resolved per call
 *   tenantId: fromIdentity('tenant'),            // ctx.identity.tenant
 * });
 * ```
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * 1. **Removes the field from the schema the model sees** (`properties` and
 *    `required`). The model is never told the argument exists.
 * 2. **Refuses a model-supplied value by name.** A call that sends the field
 *    anyway — guessed, injected by a document, copied from another tool — is
 *    refused with a result naming the argument, and the tool does not run.
 * 3. **Fills it at the last moment**, inside `execute`, from `ctx.credential`
 *    (the tool's declared `needs`, which `fromCredential({ service })` sets
 *    when the tool has none) or `ctx.identity`. A missing value refuses the
 *    call by name — never an empty or default value.
 *
 * ── Why a wrapper around `execute` ──────────────────────────────────────────
 * The filled value exists only inside the call: the arguments every dispatch
 * door records (`tool_start`, history, the commit log, a consent pause's
 * checkpoint) are the MODEL's arguments, which never held it. Wrapping
 * `execute` makes that true at every door — the agent loop, a resumed call,
 * an inner `ctx.tools` call and `mcpServe` — without each door knowing.
 *
 * A credential value is also SCRUBBED on the way out: every occurrence in the
 * tool's result is replaced by `[host-filled]`, and a thrown error that
 * carries it (an SDK that echoes its request) is replaced by one that does
 * not. That is defence in depth for a server that echoes; it cannot cover a
 * value the tool transforms (base64, hashing) or sends elsewhere itself.
 * Identity values are not secrets and are not scrubbed.
 *
 * Pattern: Decorator over `Tool` (declaration + execute). Role: tools, argument law.
 */

import type { Credential } from '../identity/types.js';
import type { Tool, ToolExecutionContext } from './tools.js';

/** Which identity field a {@link fromIdentity} fill reads. */
export type HostFilledIdentityField = 'principal' | 'tenant' | 'conversationId';

/** Fill from the call's resolved credential (`ctx.credential`). */
export interface HostFillFromCredential {
  readonly from: 'credential';
  /** The service (`needs.credential`) — required when the tool declares no `needs`. */
  readonly service?: string;
  /** Scopes / mode for the `needs` this fill declares (ignored when the tool has its own). */
  readonly scopes?: readonly string[];
  readonly mode?: 'machine' | 'user';
  /** Credential → argument value. Default: a bearer's `token`, an API key's `key`. */
  readonly read?: (credential: Credential) => string;
}

/** Fill from the identity the run's caller named (`ctx.identity`). */
export interface HostFillFromIdentity {
  readonly from: 'identity';
  readonly field: HostFilledIdentityField;
}

/** Where a host-filled argument's value comes from. */
export type HostFill = HostFillFromCredential | HostFillFromIdentity;

/**
 * Fill the argument from the call's credential. With `service`, the tool's
 * `needs` is declared for you (a tool that already declares one must name the
 * same service, or omit `service`).
 */
export function fromCredential(
  options: Omit<HostFillFromCredential, 'from'> = {},
): HostFillFromCredential {
  return { from: 'credential', ...options };
}

/** Fill the argument from the identity the run's caller named. */
export function fromIdentity(field: HostFilledIdentityField): HostFillFromIdentity {
  return { from: 'identity', field };
}

/**
 * A model sent a value for an argument the host fills. The call is refused
 * and the tool does not run. Names the arguments, never a value.
 */
export class HostFilledArgumentError extends Error {
  readonly code = 'ERR_HOST_FILLED_ARGUMENT' as const;

  constructor(readonly toolName: string, readonly fields: readonly string[]) {
    super(
      `tool '${toolName}': ${fields.map((f) => `'${f}'`).join(', ')} ` +
        `${fields.length === 1 ? 'is' : 'are'} filled by the host and cannot be set by the ` +
        'caller — call the tool again without it.',
    );
    this.name = 'HostFilledArgumentError';
  }
}

/**
 * A host-filled argument had no value for this call — no credential was
 * resolved, the credential has no single value to read, or the run's caller
 * named no such identity field. The call is refused; nothing is guessed.
 */
export class HostFilledValueMissingError extends Error {
  readonly code = 'ERR_HOST_FILLED_VALUE_MISSING' as const;

  constructor(readonly toolName: string, readonly field: string, why: string) {
    super(`tool '${toolName}': argument '${field}' is filled by the host, and ${why}.`);
    this.name = 'HostFilledValueMissingError';
  }
}

/** What replaces a credential value in a result or an error. */
export const HOST_FILLED_PLACEHOLDER = '[host-filled]';

/**
 * Declare tool arguments as filled by the host.
 *
 * One tool: every named argument must be a property of its `inputSchema`.
 * A list (e.g. `mcpClient().tools()`): each tool takes the fills for the
 * arguments IT declares and is returned unchanged when it declares none; an
 * argument no tool in the list declares is refused (a typo would otherwise
 * hide nothing).
 *
 * @throws TypeError at build — an unknown argument, a fill that is not one,
 *   a credential fill with no service on a tool that declares no `needs`, a
 *   service that disagrees with the tool's own `needs`, or an argument the
 *   tool also declares under `wants` / `askOrAssume`.
 */
export function hostFilled<T extends Tool>(
  tool: T,
  fills: Readonly<Record<string, HostFill>>,
): Tool;
export function hostFilled(
  tools: readonly Tool[],
  fills: Readonly<Record<string, HostFill>>,
): readonly Tool[];
export function hostFilled(
  toolOrTools: Tool | readonly Tool[],
  fills: Readonly<Record<string, HostFill>>,
): Tool | readonly Tool[] {
  const checked = checkFills(fills);
  if (!Array.isArray(toolOrTools)) return wrapTool(toolOrTools as Tool, checked, true);
  const tools = toolOrTools as readonly Tool[];
  const unused = new Set(Object.keys(checked));
  const out = tools.map((tool) => {
    const own = Object.fromEntries(
      Object.entries(checked).filter(([field]) => {
        if (propertiesOf(tool)[field] !== undefined) return true;
        // Declared only inside a combinator or a nested schema: it cannot be
        // removed from everywhere the model reads it, so it is refused rather
        // than left model-settable.
        if (mentionsElsewhere(tool.schema?.inputSchema, field)) refuseNested(tool, field);
        return false;
      }),
    );
    for (const field of Object.keys(own)) unused.delete(field);
    return Object.keys(own).length === 0 ? tool : wrapTool(tool, own, false);
  });
  if (unused.size > 0) {
    throw new TypeError(
      `hostFilled: no tool in the list declares ${[...unused].map((f) => `'${f}'`).join(', ')}.`,
    );
  }
  return out;
}

// ─── Build-time checks ──────────────────────────────────────────────

function checkFills(fills: unknown): Readonly<Record<string, HostFill>> {
  if (fills === null || typeof fills !== 'object' || Array.isArray(fills)) {
    throw new TypeError('hostFilled: `fills` must be an object of argument → fill.');
  }
  const names = Object.keys(fills);
  if (names.length === 0) throw new TypeError('hostFilled: `fills` names no argument.');
  for (const name of names) {
    const fill = (fills as Record<string, unknown>)[name] as Partial<HostFill> | undefined;
    const ok =
      (fill?.from === 'credential' &&
        ((fill as HostFillFromCredential).read === undefined ||
          typeof (fill as HostFillFromCredential).read === 'function')) ||
      (fill?.from === 'identity' &&
        ['principal', 'tenant', 'conversationId'].includes(
          (fill as HostFillFromIdentity).field as string,
        ));
    if (!ok) {
      throw new TypeError(
        `hostFilled: argument '${name}' needs fromCredential(…) or fromIdentity('principal' | ` +
          "'tenant' | 'conversationId').",
      );
    }
  }
  return fills as Readonly<Record<string, HostFill>>;
}

function propertiesOf(tool: Tool): Readonly<Record<string, unknown>> {
  const props = (tool.schema?.inputSchema as { readonly properties?: unknown } | undefined)
    ?.properties;
  return props !== null && typeof props === 'object' ? (props as Record<string, unknown>) : {};
}

/** The one service a tool's credential fills read, checked against its own `needs`. */
function needsFor(tool: Tool, fills: Readonly<Record<string, HostFill>>): Tool['needs'] {
  const name = tool.schema.name;
  const credentialFills = Object.entries(fills).filter(
    (e): e is [string, HostFillFromCredential] => e[1].from === 'credential',
  );
  if (credentialFills.length === 0) return tool.needs;
  const named = new Set(credentialFills.map(([, f]) => f.service).filter((s) => s !== undefined));
  if (named.size > 1) {
    throw new TypeError(
      `hostFilled: tool '${name}' takes ONE credential (its \`needs\`), and the fills name ` +
        `${[...named].map((s) => `'${s}'`).join(' and ')}.`,
    );
  }
  const service = [...named][0];
  if (tool.needs !== undefined) {
    if (service !== undefined && service !== tool.needs.credential) {
      throw new TypeError(
        `hostFilled: tool '${name}' already needs credential '${tool.needs.credential}', and a ` +
          `fill names '${service}'.`,
      );
    }
    return tool.needs;
  }
  if (service === undefined) {
    throw new TypeError(
      `hostFilled: tool '${name}' declares no \`needs\` — say which credential fills ` +
        `${credentialFills.map(([f]) => `'${f}'`).join(', ')}: fromCredential({ service }).`,
    );
  }
  const declared = credentialFills.find(([, f]) => f.service === service)?.[1];
  return {
    credential: service,
    ...(declared?.scopes !== undefined && { scopes: declared.scopes }),
    ...(declared?.mode !== undefined && { mode: declared.mode }),
  };
}

function wrapTool(tool: Tool, fills: Readonly<Record<string, HostFill>>, strict: boolean): Tool {
  const name = tool.schema.name;
  const props = propertiesOf(tool);
  for (const field of Object.keys(fills)) {
    if (mentionsElsewhere(tool.schema.inputSchema, field)) refuseNested(tool, field);
    if (strict && props[field] === undefined) {
      throw new TypeError(`hostFilled: tool '${name}' has no argument '${field}'.`);
    }
    if (tool.wants !== undefined && Object.hasOwn(tool.wants, field)) {
      throw new TypeError(
        `hostFilled: tool '${name}' declares '${field}' under \`wants\` — an argument is filled ` +
          'by the host or resolved from a ref, not both.',
      );
    }
    if (tool.askOrAssume !== undefined && Object.hasOwn(tool.askOrAssume, field)) {
      throw new TypeError(
        `hostFilled: tool '${name}' declares '${field}' under \`askOrAssume\` — an argument is ` +
          'filled by the host or asked of a person, not both.',
      );
    }
  }
  const needs = needsFor(tool, fills);
  const inputSchema = withoutFields(tool.schema.inputSchema, Object.keys(fills));
  const fieldNames = Object.keys(fills);
  const inner = tool.execute.bind(tool);
  return {
    ...tool,
    schema: { ...tool.schema, inputSchema },
    ...(needs !== undefined && { needs }),
    async execute(args: unknown, ctx: ToolExecutionContext): Promise<unknown> {
      const given = isRecord(args) ? fieldNames.filter((f) => Object.hasOwn(args, f)) : [];
      if (given.length > 0) throw new HostFilledArgumentError(name, given);
      const filled: Record<string, string> = {};
      const secrets: string[] = [];
      for (const field of fieldNames) {
        const fill = fills[field] as HostFill;
        const value = valueOf(name, field, fill, ctx);
        filled[field] = value;
        if (fill.from === 'credential') secrets.push(value, ...credentialValues(ctx.credential));
      }
      const base = isRecord(args) ? args : {};
      try {
        const result = await inner({ ...base, ...filled }, ctx);
        return secrets.length === 0 ? result : scrubValue(result, secrets);
      } catch (err) {
        throw secrets.length === 0 || !carries(err, secrets, 0, new Set())
          ? err
          : scrubbedError(err, secrets);
      }
    },
  } as Tool;
}

/**
 * Whether `field` is named anywhere in the schema OTHER than the root's own
 * `properties` / `required` — a combinator (`allOf`/`anyOf`/`oneOf`, `if`/
 * `then`/`else`, `not`), `$defs`, `dependentRequired`/`dependencies`, or a
 * nested object's `properties`/`required`. The root's own property schema is
 * not walked.
 */
function mentionsElsewhere(schema: unknown, field: string): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const seen = new Set<object>();
  const walk = (node: unknown, root: boolean): boolean => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some((n) => walk(n, false));
    const obj = node as Record<string, unknown>;
    if (!root) {
      const props = obj.properties;
      if (props !== null && typeof props === 'object' && Object.hasOwn(props, field)) return true;
      if (Array.isArray(obj.required) && obj.required.includes(field)) return true;
    }
    for (const key of ['dependentRequired', 'dependencies', 'dependentSchemas']) {
      const dep = obj[key];
      if (dep !== null && typeof dep === 'object') {
        if (Object.hasOwn(dep, field)) return true;
        for (const v of Object.values(dep)) {
          if (Array.isArray(v) && v.includes(field)) return true;
        }
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (root && key === 'required') continue;
      if (root && key === 'properties' && value !== null && typeof value === 'object') {
        for (const [prop, sub] of Object.entries(value)) {
          if (prop !== field && walk(sub, false)) return true;
        }
        continue;
      }
      if (walk(value, false)) return true;
    }
    return false;
  };
  return walk(schema, true);
}

function refuseNested(tool: Tool, field: string): never {
  throw new TypeError(
    `hostFilled: tool '${tool.schema.name}' names '${field}' inside a nested schema or a ` +
      'combinator (allOf/anyOf/oneOf, $defs, dependentRequired …), where it cannot be removed ' +
      'from what the model reads — declare it as a top-level property, or wrap the tool yourself.',
  );
}

function withoutFields(
  schema: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  const props = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  for (const f of fields) delete props[f];
  const out: Record<string, unknown> = { ...schema, properties: props };
  if (Array.isArray(schema.required)) {
    const required = (schema.required as unknown[]).filter(
      (r) => typeof r !== 'string' || !fields.includes(r),
    );
    if (required.length > 0) out.required = required;
    else delete out.required;
  }
  return out;
}

// ─── Dispatch-time fill ─────────────────────────────────────────────

function valueOf(tool: string, field: string, fill: HostFill, ctx: ToolExecutionContext): string {
  if (fill.from === 'identity') {
    const value = ctx?.identity?.[fill.field];
    if (typeof value !== 'string' || value === '') {
      throw new HostFilledValueMissingError(
        tool,
        field,
        `the run's caller named no identity ${fill.field}`,
      );
    }
    return value;
  }
  const credential = ctx?.credential;
  if (credential === undefined) {
    throw new HostFilledValueMissingError(tool, field, 'no credential was resolved for the call');
  }
  let value: unknown;
  try {
    value = fill.read !== undefined ? fill.read(credential) : defaultRead(credential);
  } catch {
    value = undefined;
  }
  if (typeof value !== 'string' || value === '') {
    throw new HostFilledValueMissingError(
      tool,
      field,
      `its '${credential.kind}' credential has no single value to fill it with` +
        (fill.read === undefined ? ' — pass fromCredential({ read })' : ''),
    );
  }
  return value;
}

/**
 * Every value of the credential itself, beside the filled one — its raw
 * token or key and its header values — so an echo of the bare token is
 * scrubbed even when `read` filled a decorated form (`Bearer …`).
 */
function credentialValues(credential: Credential | undefined): string[] {
  if (credential === undefined) return [];
  const out: unknown[] = [defaultRead(credential)];
  try {
    for (const v of Object.values(credential.toHeaders())) {
      out.push(v);
      if (typeof v === 'string' && /^(?:Bearer|Basic) /.test(v))
        out.push(v.slice(v.indexOf(' ') + 1));
    }
  } catch {
    // A credential that cannot produce headers adds nothing.
  }
  return out.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function defaultRead(credential: Credential): unknown {
  const c = credential as Credential & { readonly token?: unknown; readonly key?: unknown };
  if (c.kind === 'bearer') return c.token;
  if (c.kind === 'apiKey') return c.key;
  return undefined;
}

// ─── Scrub on the way out ───────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isPlainContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  if (Array.isArray(v)) return true;
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function scrubText(text: string, secrets: readonly string[]): string {
  let out = text;
  // Longest first, so `Bearer x` is replaced whole before `x`.
  for (const s of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(HOST_FILLED_PLACEHOLDER);
  }
  return out;
}

/** The value with every occurrence of a secret replaced; the SAME value when none. */
function scrubValue(
  value: unknown,
  secrets: readonly string[],
  seen = new Map<object, unknown>(),
): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (!isPlainContainer(value)) return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    let changed = false;
    for (const item of value) {
      const next = scrubValue(item, secrets, seen);
      if (next !== item) changed = true;
      out.push(next);
    }
    if (!changed) seen.set(value, value);
    return changed ? out : value;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  let changed = false;
  for (const key of Object.keys(value)) {
    const item = value[key];
    const next = scrubValue(item, secrets, seen);
    if (next !== item) changed = true;
    out[key] = next;
  }
  if (!changed) seen.set(value, value);
  return changed ? out : value;
}

/** Whether a thrown value carries a secret anywhere a reader could find it. */
function carries(
  value: unknown,
  secrets: readonly string[],
  depth: number,
  seen: Set<object>,
): boolean {
  if (typeof value === 'string') return secrets.some((s) => value.includes(s));
  if (value === null || typeof value !== 'object' || depth > 8 || seen.has(value)) return false;
  seen.add(value);
  // An error's own fields are mostly non-enumerable (`message`, `stack`,
  // `cause`, `AggregateError.errors`), so every own name is read.
  const keys = value instanceof Error ? Object.getOwnPropertyNames(value) : Object.keys(value);
  for (const key of keys) {
    let item: unknown;
    try {
      item = (value as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (carries(item, secrets, depth + 1, seen)) return true;
  }
  return false;
}

/** A replacement error: the name and the scrubbed message, nothing else. */
function scrubbedError(err: unknown, secrets: readonly string[]): Error {
  let message: string;
  try {
    message = err instanceof Error ? String(err.message) : String(err);
  } catch {
    message = 'the tool failed';
  }
  const out = new Error(scrubText(message, secrets));
  out.name = err instanceof Error ? scrubText(err.name, secrets) : 'Error';
  return out;
}
