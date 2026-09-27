/**
 * Compile-level regression test — the request a transport built IS an
 * `ArtifactsForRequestInput`, so a handler hands `handle.artifactsForRequest`
 * the request it was given and no credential (the sign-in key) can be left
 * behind; and the 9.117.0 input shape still compiles.
 *
 * Also pins `PasswordKind` — the word `GET /auth/config` answers as
 * `passwordKind` — to exactly two members, because a page branches on it.
 *
 * Lives under its own tsconfig (`npm run test:types`) so the compiler checks
 * the assignments, while the `.test.ts` name lets vitest run the assertions.
 */
import { describe, expect, it } from 'vitest';

import type {
  ArtifactsForRequestInput,
  HostConversation,
  HostRequest,
  PasswordChecker,
  PasswordKind,
} from '../../src/hosting/index';

describe('ArtifactsForRequestInput', () => {
  it('a HostRequest and a HostConversation go in as they are — the sign-in key rides along', () => {
    const request: HostRequest = { input: 'x', sessionId: 's', signInKey: 'k' };
    const fromRequest: ArtifactsForRequestInput = request;
    const conversation = { sessionId: 's', signInKey: 'k' } as HostConversation;
    const fromConversation: ArtifactsForRequestInput = conversation;
    expect(fromRequest.signInKey).toBe('k');
    expect(fromConversation.signInKey).toBe('k');
  });

  it('the 9.117.0 shape still compiles, raw Node headers included', () => {
    const headers: Record<string, string | string[] | undefined> = {
      authorization: 'Bearer t',
      'x-forwarded-for': ['a', 'b'],
    };
    const old: ArtifactsForRequestInput = { sessionId: 's', headers, userId: 'u' };
    expect(old.sessionId).toBe('s');
  });
});

describe('PasswordKind', () => {
  it("is 'directory' | 'local', and a checker may leave it out", () => {
    const kinds: PasswordKind[] = ['directory', 'local'];
    // @ts-expect-error — not a password kind; the page branches on the word.
    const windows: PasswordKind = 'windows';
    const bare: PasswordChecker = { strategy: 's', check: () => Promise.resolve(undefined) };
    expect([kinds, windows, bare.kind]).toEqual([['directory', 'local'], 'windows', undefined]);
  });
});
