import { describe, expect, it } from 'vitest';
import {
  identityForRequest,
  repeatsAuthorization,
  sessionArtifactScope,
  singleValuedHeaders,
} from './request.js';

describe('request identity composition', () => {
  it('keeps the stored conversation and tenant while the request supplies its actor', () => {
    const stored = { conversationId: 'held', tenant: 'tenant', principal: 'old' };
    expect(identityForRequest('caller', 'session', stored)).toEqual({
      conversationId: 'held',
      tenant: 'tenant',
      principal: 'caller',
    });
    expect(sessionArtifactScope(undefined, 'session', stored)).toEqual({
      conversationId: 'session',
    });
    expect(identityForRequest('caller', undefined, undefined)).toBeUndefined();
  });
  it('refuses ambiguous authorization before normalizing repeated headers', () => {
    expect(repeatsAuthorization({ Authorization: 'one', authorization: 'two' })).toBe(true);
    expect(repeatsAuthorization({ authorization: ['one', 'two'] })).toBe(true);
    expect(singleValuedHeaders({ authorization: 'one', other: ['two'] })).toEqual({
      authorization: 'one',
    });
  });
});
