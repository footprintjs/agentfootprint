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
  if (typeof options.caPem !== 'string' || !options.caPem.includes('BEGIN CERTIFICATE')) {
    throw new TypeError('[identity] ldapDirectory: caPem must be a PEM CA certificate.');
  }
  const timeout = options.timeoutMs ?? 5_000;
  let lib: LdaptsBackend | undefined = options.backend;

  return {
    async open(): Promise<DirectorySession> {
      lib ??= await loadLdapts();
      const client = new lib.Client({
        url: options.url,
        timeout,
        connectTimeout: timeout,
        tlsOptions: { ca: [options.caPem], minVersion: 'TLSv1.2', rejectUnauthorized: true },
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
