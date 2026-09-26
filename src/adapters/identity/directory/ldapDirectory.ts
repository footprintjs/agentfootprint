/**
 * directory/ldapDirectory — the {@link Directory} port over LDAPS, through
 * `ldapts` (an optional peer, loaded lazily — the `jose` precedent).
 *
 * LDAPS only: `ldap://` would send the password in the clear on the bind, and
 * StartTLS needs the same DC certificate LDAPS does, so refusing it loses
 * nothing real. The certificate chain is checked against the CA the operator
 * supplies (`caPem`) and the host name against the URL — there is no switch to
 * skip either.
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
  /** The CA certificate(s), PEM, the DC's certificate must chain to. */
  readonly caPem: string;
  /** Connect and operation timeout, ms. Default 5000. */
  readonly timeoutMs?: number;
  /** An already-imported `ldapts`. */
  readonly backend?: LdaptsBackend;
  /**
   * Told the AD sub-code of a refused bind (`52e` wrong password, `532`
   * expired, `773` must change, …) — for the server log only; the person gets
   * one answer for all of them. Never the password or the name.
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
  const caProblem = caPemProblem(options.caPem);
  if (caProblem !== undefined) throw new TypeError(`[identity] ldapDirectory: ${caProblem}.`);
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
        tlsOptions: { ca: [options.caPem], minVersion: 'TLSv1.2', rejectUnauthorized: true },
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
              const sub = /data ([0-9a-f]{3,4})/i.exec(String((err as Error).message))?.[1];
              options.log?.(
                `[identity] directory bind refused${sub ? ` (AD sub-code ${sub})` : ''}`,
              );
              return 'invalid';
            }
            // Never connected (refused, unreachable, a TLS failure): the
            // password never left, so the attempt is un-counted. Connected,
            // then failed (a bind that timed out): AD may have counted it,
            // so the error stays an ordinary one and the door counts it.
            if (!reached) {
              options.log?.('[identity] directory unreachable (no TLS connection opened)');
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

/**
 * Why a CA file is not one, or `undefined`: every PEM block must parse as an
 * X.509 certificate with the CA flag set (review idI57 N-10 — a leaf
 * certificate booted, then failed every sign-in).
 */
export function caPemProblem(caPem: unknown): string | undefined {
  if (typeof caPem !== 'string') return 'caPem must be a PEM CA certificate';
  const blocks = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (blocks === null) return 'caPem must be a PEM CA certificate';
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
