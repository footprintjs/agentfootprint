/**
 * fakeDirectory — an Active Directory stand-in behind the `Directory` port,
 * with AD's own bind-name rule (MS-ADTS "Simple Authentication"): a name
 * matching one object's EXPLICIT userPrincipalName authenticates that object,
 * before any other object's IMPLICIT `sAMAccountName@<domain>` — the rule that
 * makes the rename collision possible.
 *
 * It records what reached it, so a test can pin that an empty password never
 * did, and it can be switched down.
 */

import { randomUUID } from 'node:crypto';

import {
  escapeFilterValue,
  type Directory,
  type DirectoryEntry,
  type DirectorySession,
} from '../../../../src/identity.js';

export interface FakeAccount {
  readonly sam: string;
  readonly password: string;
  /** An explicit userPrincipalName, when the account has one. */
  readonly upn?: string;
  readonly displayName?: string;
  /** Direct group DNs; nesting is resolved through `groups`. */
  readonly memberOf?: readonly string[];
  /** The SDDL SID Who-am-I answers with, when `whoAmIForm` is 'sid'. */
  readonly sid?: string;
}

export interface FakeDirectory extends Directory {
  readonly binds: string[];
  /** The account's objectGUID as the strategy stores it (base64). */
  guidOf(sam: string): string;
  down: boolean;
  /** The bind is SENT (recorded), then times out — a slow DC that may still have counted it. */
  bindTimesOut: boolean;
  /** How Who-am-I answers: the NetBIOS form, the SID form, or a fixed string. */
  whoAmIForm: 'netbios' | 'sid' | { readonly fixed: string };
  /** Make a search for this sam return two entries. */
  duplicate?: string;
  /** Group DN → groups that contain it (for nesting). */
  groups: Record<string, readonly string[]>;
  lastFilter?: string;
}

export function fakeDirectory(
  accounts: readonly FakeAccount[],
  domain = { dns: 'corp.example', netbios: 'CORP' },
): FakeDirectory {
  const guids = new Map(
    accounts.map((a) => [a.sam, Buffer.from(randomUUID().replace(/-/g, ''), 'hex')]),
  );
  const dnOf = (a: FakeAccount) => `CN=${a.sam},OU=People,DC=corp,DC=example`;

  const resolveBind = (name: string): FakeAccount | undefined => {
    const lower = name.toLowerCase();
    const explicit = accounts.find((a) => a.upn?.toLowerCase() === lower);
    if (explicit !== undefined) return explicit;
    return accounts.find((a) => `${a.sam}@${domain.dns}`.toLowerCase() === lower);
  };

  const inGroup = (direct: readonly string[], target: string): boolean => {
    const seen = new Set<string>();
    const walk = (g: string): boolean => {
      if (g.toLowerCase() === target.toLowerCase()) return true;
      if (seen.has(g)) return false;
      seen.add(g);
      return (fake.groups[g] ?? []).some(walk);
    };
    return direct.some(walk);
  };

  const fake: FakeDirectory = {
    binds: [],
    down: false,
    bindTimesOut: false,
    whoAmIForm: 'netbios',
    groups: {},
    guidOf: (sam) => (guids.get(sam) as Buffer).toString('base64'),
    async open(): Promise<DirectorySession> {
      if (fake.down) throw new Error('connect ECONNREFUSED');
      let authenticated: FakeAccount | undefined;
      const entry = (a: FakeAccount): DirectoryEntry => ({
        dn: dnOf(a),
        objectGUID: guids.get(a.sam) as Buffer,
        ...(a.displayName !== undefined && { displayName: a.displayName }),
      });
      return {
        async bind(name, password) {
          fake.binds.push(name);
          if (fake.bindTimesOut) throw new Error('BindRequest: Operation timed out');
          if (password.length === 0) {
            // An UNAUTHENTICATED bind: a Windows DC may answer it as a success.
            authenticated = undefined;
            return 'ok';
          }
          const account = resolveBind(name);
          if (account === undefined || account.password !== password) return 'invalid';
          authenticated = account;
          return 'ok';
        },
        async whoAmI() {
          const form = fake.whoAmIForm;
          if (typeof form === 'object') return form.fixed;
          if (authenticated === undefined) return '';
          if (form === 'sid') return `u:${authenticated.sid ?? 'S-1-5-21-1-2-3-1000'}`;
          return `u:${domain.netbios}\\${authenticated.sam}`;
        },
        async search(base, filter, scope) {
          fake.lastFilter = filter;
          if (scope === 'base') {
            const account = accounts.find((a) => dnOf(a) === base);
            const group = /memberOf:1\.2\.840\.113556\.1\.4\.1941:=(.*)\)$/.exec(filter)?.[1];
            if (account === undefined || group === undefined) return [];
            const unescaped = group.replace(/\\([0-9a-f]{2})/gi, (_, h) =>
              String.fromCharCode(parseInt(h as string, 16)),
            );
            return inGroup(account.memberOf ?? [], unescaped) ? [entry(account)] : [];
          }
          const sam = /sAMAccountName=([^)]*)\)/.exec(filter)?.[1];
          const sidMatch = /objectSid=([^)]*)\)/.exec(filter)?.[1];
          let found = accounts.filter((a) =>
            sam !== undefined ? a.sam.toLowerCase() === sam.toLowerCase() : false,
          );
          if (sidMatch !== undefined) {
            found = accounts.filter(
              (a) =>
                a.sid !== undefined && sidMatch.length > 0 && filter.includes(sidEscaped(a.sid)),
            );
          }
          if (fake.duplicate !== undefined && found.some((a) => a.sam === fake.duplicate)) {
            found = [...found, ...found];
          }
          return found.map(entry);
        },
        async close() {
          authenticated = undefined;
        },
      };
    },
  };
  return fake;
}

/** The escaped objectSid the strategy builds — for matching in the fake. */
function sidEscaped(sid: string): string {
  const parts = /^S-1-(\d+)((?:-\d+)*)$/.exec(sid);
  if (parts === null) return '\u0000never';
  const subs = (parts[2] as string).split('-').filter(Boolean).map(Number);
  const out = Buffer.alloc(8 + subs.length * 4);
  out[0] = 1;
  out[1] = subs.length;
  out.writeUIntBE(Number(parts[1]), 2, 6);
  subs.forEach((n, i) => out.writeUInt32LE(n, 8 + i * 4));
  return escapeFilterValue(out);
}
