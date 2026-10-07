/**
 * directory/ldapDirectory — the {@link Directory} port over LDAPS, through
 * `ldapts` (an optional peer, loaded lazily — the `jose` precedent).
 *
 * LDAPS only: `ldap://` would send the password in the clear on the bind, and
 * StartTLS needs the same DC certificate LDAPS does, so refusing it loses
 * nothing real. The certificate chain is checked against EITHER the CA the
 * operator supplies (`caPem`) OR — said in so many words, `systemCa: true` —
 * Node's default CA store, and the host name against the URL. There is no
 * switch to skip either check, and no default between the two trusts.
 *
 * ── What to trust: the ROOT ─────────────────────────────────────────────────
 * Trust the CA at the top of the DC certificate's chain, never the DC's own
 * certificate (refused at construction: it is not a CA) or an intermediate.
 * A DC certificate is renewed every few months, and an intermediate is
 * replaced on its own schedule; a root lives for years. Trusting the root
 * means a renewal — a new leaf, even a new intermediate the DC sends in its
 * chain — needs no change here. A DC certificate issued by a PUBLIC CA chains
 * to a root Node already ships (`systemCa: true`); a company CA does not, so
 * give its root as `caPem`.
 */

import { X509Certificate } from 'node:crypto';
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls';

import { PasswordCheckUnreachableError } from '../../../hosting/signin/errors.js';
import { lazyRequire } from '../../../lib/lazyRequire.js';
import type { Directory, DirectoryEntry, DirectorySession } from './port.js';

/** The slice of `ldapts` this adapter uses, declared structurally. */
export interface LdaptsBackend {
  Client: new (options: Record<string, unknown>) => {
    bind(name: string, password?: string): Promise<void>;
    exop(oid: string): Promise<{ oid?: string; value?: string }>;
    search(
      base: string,
      options: Record<string, unknown>,
    ): Promise<{ searchEntries: Record<string, unknown>[] }>;
    unbind(): Promise<void>;
  };
}

export interface LdapDirectoryOptions {
  /** `ldaps://dc1.corp.example:636`. `ldap://` is refused. */
  readonly url: string;
  /**
   * The CA certificate(s), PEM, the DC's certificate must chain to — the
   * company's ROOT CA. Exactly one of this and `systemCa`.
   */
  readonly caPem?: string;
  /**
   * `true`: trust Node's default CA store instead of a file — the public
   * roots Node ships (Mozilla's list), plus `NODE_EXTRA_CA_CERTS`, plus the
   * operating system's store when Node runs with `--use-system-ca`. For a DC
   * whose certificate a PUBLIC CA issued. Exactly one of this and `caPem`;
   * the host-name check stays on either way.
   */
  readonly systemCa?: true;
  /** Connect and operation timeout, ms. Default 5000. */
  readonly timeoutMs?: number;
  /** An already-imported `ldapts`. */
  readonly backend?: LdaptsBackend;
  /**
   * Told why the directory could not answer — never reached (with the
   * connection or TLS error's CODE, e.g. `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
   * for a CA that does not issue the DC's certificate,
   * `ERR_TLS_CERT_ALTNAME_INVALID` for a name it does not carry), or failed
   * after the bind was sent. For the operator; never the password, the name
   * or an error's text. A REFUSED bind is not logged here: its AD sub-code
   * travels in the bind's answer to the sign-in door's audit record.
   */
  readonly log?: (line: string) => void;
}

/** Raised when `directory-password` is configured and `ldapts` is not installed. */
export class MissingLdaptsError extends Error {
  readonly code = 'ERR_MISSING_LDAPTS' as const;

  constructor() {
    super(
      'directory-password requires the `ldapts` peer dependency.\n  Install:  npm install ldapts',
    );
    this.name = 'MissingLdaptsError';
  }
}

/** RFC 4532 "Who am I?" extended operation. */
const WHO_AM_I = '1.3.6.1.4.1.4203.1.11.3';
/** LDAP result code 49: invalidCredentials — every wrong credential. */
const INVALID_CREDENTIALS = 49;

export function ldapDirectory(options: LdapDirectoryOptions): Directory {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new TypeError(`[identity] ldapDirectory: '${options.url}' is not an ldaps:// URL.`);
  }
  if (url.protocol !== 'ldaps:') {
    throw new TypeError(
      `[identity] ldapDirectory: '${options.url}' is not ldaps://. A bind over plain LDAP sends ` +
        `the password in the clear; use LDAPS (port 636) with the company CA.`,
    );
  }
  const systemCa = options.systemCa === true;
  if (options.systemCa !== undefined && !systemCa) {
    throw new TypeError(`[identity] ldapDirectory: systemCa is true or left out.`);
  }
  if (systemCa && options.caPem !== undefined) {
    throw new TypeError(
      `[identity] ldapDirectory: give caPem OR systemCa: true, not both — one trust, said once.`,
    );
  }
  if (!systemCa) {
    const caProblem = caPemProblem(options.caPem);
    if (caProblem !== undefined) throw new TypeError(`[identity] ldapDirectory: ${caProblem}.`);
  }
  // No `ca` at all is Node's default store — reached only by `systemCa: true`.
  const trust = systemCa ? {} : { ca: [options.caPem as string] };
  const timeout = options.timeoutMs ?? 5_000;
  let lib: LdaptsBackend | undefined = options.backend;

  return {
    async open(): Promise<DirectorySession> {
      lib ??= await loadLdapts();
      // Whether the TLS connection OPENED — the one bit that says whether a
      // failed bind could have reached the DC (review idI57 S-6).
      let reached = false;
      const client = new lib.Client({
        url: options.url,
        timeout,
        connectTimeout: timeout,
        tlsOptions: { ...trust, minVersion: 'TLSv1.2', rejectUnauthorized: true },
        createSecureConnection: (port: number, host: string, tls: ConnectionOptions): TLSSocket => {
          const socket = tlsConnect(port, host, tls);
          socket.once('secureConnect', () => {
            reached = true;
          });
          return socket;
        },
      });
      return {
        async bind(name, password) {
          try {
            await client.bind(name, password);
            return 'ok';
          } catch (err) {
            if ((err as { code?: unknown })?.code === INVALID_CREDENTIALS) {
              // The sub-code only — `data 52e` — never the rest of the
              // directory's text. It goes to the audit record, not the person.
              const sub = /data ([0-9a-f]{3,4})\b/i.exec(String((err as Error).message))?.[1];
              return sub === undefined
                ? 'invalid'
                : { kind: 'invalid', adSubCode: sub.toLowerCase() };
            }
            // Never connected (refused, unreachable, a TLS failure): the
            // password never left, so the attempt is un-counted. Connected,
            // then failed (a bind that timed out): AD may have counted it,
            // so the error stays an ordinary one and the door counts it.
            if (!reached) {
              const code = errorCodeOf(err);
              options.log?.(
                `[identity] directory unreachable (no TLS connection opened${
                  code === undefined ? '' : `: ${code}`
                })`,
              );
              throw new PasswordCheckUnreachableError('the directory could not be reached', {
                cause: err,
              });
            }
            options.log?.('[identity] directory bind failed after it was sent (counted)');
            throw err;
          }
        },
        async whoAmI() {
          const answer = await client.exop(WHO_AM_I);
          return typeof answer.value === 'string' ? answer.value : '';
        },
        async search(base, filter, scope) {
          const found = await client.search(base, {
            scope,
            filter,
            attributes: ['objectGUID', 'displayName'],
            explicitBufferAttributes: ['objectGUID'],
            sizeLimit: 2,
          });
          return found.searchEntries.map(toEntry);
        },
        async close() {
          await client.unbind();
        },
      };
    },
  };
}

const PEM_BEGIN = '-----BEGIN CERTIFICATE-----';
const PEM_END = '-----END CERTIFICATE-----';

/**
 * Every certificate block in a PEM bundle, in order — what
 * `pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)`
 * finds, in one pass. The regex re-reads the rest of the bundle from every
 * BEGIN line that has no END after it, which is quadratic on a file of
 * repeated BEGIN lines; once a BEGIN has no END after it, no later one has
 * either, so the scan stops there.
 */
export function pemCertificateBlocks(pem: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = pem.indexOf(PEM_BEGIN, from);
    if (start === -1) return blocks;
    // `[\s\S]+?` — at least one character between the two lines.
    const end = pem.indexOf(PEM_END, start + PEM_BEGIN.length + 1);
    if (end === -1) return blocks;
    from = end + PEM_END.length;
    blocks.push(pem.slice(start, from));
  }
}

/**
 * Why a CA file is not one, or `undefined`: every PEM block must parse as an
 * X.509 certificate with the CA flag set (review idI57 N-10 — a leaf
 * certificate booted, then failed every sign-in).
 */
export function caPemProblem(caPem: unknown): string | undefined {
  if (typeof caPem !== 'string') return 'caPem must be a PEM CA certificate';
  const blocks = pemCertificateBlocks(caPem);
  if (blocks.length === 0) return 'caPem must be a PEM CA certificate';
  for (const block of blocks) {
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(block);
    } catch {
      return 'caPem holds a block that is not an X.509 certificate';
    }
    if (!cert.ca) {
      return `caPem holds a certificate that is not a CA (${cert.subject.replace(
        /\n/g,
        ', ',
      )}); give the CA that issued the DC's certificate`;
    }
  }
  return undefined;
}

/**
 * The subjects of the CA certificates in a PEM bundle that are NOT
 * self-signed roots — intermediates. Trusting one alone breaks at the next
 * renewal that changes it, so boot says so (`directory-password`'s banner).
 */
export function intermediateCaSubjects(caPem: string): string[] {
  const blocks = pemCertificateBlocks(caPem);
  const found: string[] = [];
  for (const block of blocks) {
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(block);
    } catch {
      continue;
    }
    const selfSigned = cert.checkIssued(cert) && cert.verify(cert.publicKey);
    if (cert.ca && !selfSigned) found.push(cert.subject.replace(/\n/g, ', '));
  }
  return found;
}

/**
 * A connection or TLS error's CODE (`ECONNREFUSED`, `ETIMEDOUT`,
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID`) — a
 * class, never text — from the error or its cause; `undefined` when there is
 * none in that shape.
 */
function errorCodeOf(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e !== undefined && depth < 3; depth += 1) {
    const code = (e as { code?: unknown })?.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
    e = (e as { cause?: unknown })?.cause;
  }
  return undefined;
}

function toEntry(raw: Record<string, unknown>): DirectoryEntry {
  const guid = raw.objectGUID;
  const name = raw.displayName;
  return {
    dn: String(raw.dn ?? ''),
    ...(Buffer.isBuffer(guid) && { objectGUID: guid }),
    ...(typeof name === 'string' && { displayName: name }),
  };
}

async function loadLdapts(): Promise<LdaptsBackend> {
  try {
    const spec = 'ldapts';
    return (await import(spec)) as unknown as LdaptsBackend;
  } catch {
    try {
      return lazyRequire<LdaptsBackend>('ldapts');
    } catch {
      throw new MissingLdaptsError();
    }
  }
}
