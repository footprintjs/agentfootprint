/** One-job session/key or validation owner; canonical exports remain with its facade. */
import { readToolCallOwner, type ToolOwnerCarrier } from '../toolResourceOwner.js';
import { encodeIdentityField } from '../../memory/identity/index.js';
import { fnv1a } from '../../lib/fnv1a.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { ToolExecutionContext } from '../tools.js';
import type { TeardownScope, ToolSessionBinding } from './contracts.js';
/**
 * Derive the isolation key a tool should hold a session under.
 *
 * ONE implementation, exported, because the derivation is the security
 * boundary. Returns `undefined` when the facts the scope needs are absent —
 * which is a refusal to guess, not a failure: the caller decides whether to
 * narrow the scope loudly or refuse the call.
 *
 * ```
 * session →  t=<tenant|_>/p=<principal|_>/s=<sessionId>     requires sessionId
 * run     →  t=<tenant|_>/p=<principal|_>/r=<runId>         requires runId
 * call    →  c=<toolCallId>                                 always available
 * ```
 *
 * **`sessionId` alone must never key a live session.** The hosting port says
 * why in its own words: a `sessionId` "is not identity and must never be
 * trusted as identity on its own: anyone who can reach the host can put any
 * string here, including someone else's." A code interpreter keyed on
 * `sessionId` alone hands a live sandbox — files, environment, half-run state —
 * to anyone who guesses one. Tenant and principal are in the key whenever they
 * exist; a deployment that has no principal is thereby STATING it is
 * single-principal rather than quietly assuming it.
 *
 * `'shutdown'` is not a key scope: it is when everything goes, not a thing to
 * hold one session under. Ask for it and you get `undefined`.
 *
 * @example
 *   const key = toolSessionKey(ctx, 'run');
 *   if (!key) throw new Error("run_code: scope 'run' needs a run …");
 */
export function toolSessionKey(
  ctx: Pick<
    ToolExecutionContext,
    'toolCallId' | 'runId' | 'sessionId' | 'identity' | 'resourceOwner'
  >,
  scope: TeardownScope,
): string | undefined {
  // Every field goes through the SHARED identity encoder rather than being
  // joined raw. This key holds a live interpreter sandbox, so two identities
  // that produce one key share a filesystem — and joining unescaped fields with
  // `/` and `=` markers meant a value could donate a marker and shift a
  // boundary: tenant `acme/p=bob` with principal `x` composed the same string
  // as tenant `acme` with principal `bob/p=x`. The absent-versus-`_` pair was
  // the same collision `identityNamespace` was fixed for in 9.40.0, one module
  // over, and this is the encoder that fix produced.
  //
  // No reachable attack was found — the markers are prefix-anchored, so a
  // caller controlling only the trailing field cannot shift a boundary into
  // somebody else's key. It is closed anyway: "no attack today" is a property
  // of the current call sites, not of the function.
  const owner =
    scope === 'session' || scope === 'shutdown' || ctx.resourceOwner === undefined
      ? undefined
      : readToolCallOwner(ctx.resourceOwner);
  const turn = owner === undefined ? undefined : ownerPartition(owner.birth, ctx);
  if (scope === 'call')
    return owner === undefined
      ? `c=${encodeIdentityField(ctx.toolCallId)}`
      : `c=${encodeIdentityField(JSON.stringify([turn, owner.ordinal]))}`;
  if (scope === 'shutdown') return undefined;
  const prefix = `t=${encodeIdentityField(ctx.identity?.tenant)}/p=${encodeIdentityField(
    ctx.identity?.principal,
  )}`;
  if (scope === 'session') {
    return ctx.sessionId ? `${prefix}/s=${encodeIdentityField(ctx.sessionId)}` : undefined;
  }
  return ctx.runId ? `${prefix}/r=${encodeIdentityField(turn ?? ctx.runId)}` : undefined;
}

/**
 * A short, stable digest of an isolation key.
 *
 * The key carries tenant, principal and the hosting `sessionId`. Publishing it
 * on the event wire would put a user identifier into every exporter's payload —
 * so the wire carries this instead, which is enough to JOIN two rows and not
 * enough to name whose they are. `meta.sessionId` already carries the session
 * legitimately (9.4.0); the payload does not repeat it.
 *
 * SHA-256, first 12 hex chars, wherever `node:crypto` resolves. In a browser
 * bundle, where it does not, this falls back to the package's non-cryptographic
 * FNV-1a digest — stated here rather than implied, because a fallback nobody
 * documented is how "hashed" comes to mean less than a reader assumed.
 */
export function hashSessionKey(key: string): string {
  const crypto = loadCrypto();
  if (crypto) return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  return fnv1a(key);
}

type NodeCryptoModule = typeof import('node:crypto');

let cryptoModule: NodeCryptoModule | undefined | null;

function loadCrypto(): NodeCryptoModule | undefined {
  if (cryptoModule !== undefined) return cryptoModule ?? undefined;
  try {
    const mod = lazyRequire<NodeCryptoModule>('node:crypto');
    cryptoModule = typeof mod?.createHash === 'function' ? mod : null;
  } catch {
    cryptoModule = null;
  }
  return cryptoModule ?? undefined;
}

export function ownerPartition(
  birth: ToolOwnerCarrier['birth'],
  facts: ToolSessionBinding,
): string {
  return JSON.stringify([...identityParts(facts), birth.runId, birth.componentOrdinal]);
}

/** Conversation/host lifetimes do not restart at a native turn boundary. */
export function sessionPartition(facts: ToolSessionBinding): string {
  return JSON.stringify(identityParts(facts));
}

function identityParts(facts: ToolSessionBinding): readonly string[] {
  return [
    encodeIdentityField(facts.identity?.tenant),
    encodeIdentityField(facts.identity?.principal),
    encodeIdentityField(facts.sessionId),
  ];
}
