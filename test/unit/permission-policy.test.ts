/**
 * Unit tests for PermissionPolicy — centralized, shareable permission management.
 */

import { describe, it, expect, vi } from 'vitest';
import { PermissionPolicy } from '../../src/providers/tools/PermissionPolicy';

describe('PermissionPolicy: basic operations', () => {
  it('allows tools in initial set', () => {
    const policy = new PermissionPolicy(['search', 'calc']);
    expect(policy.isAllowed('search')).toBe(true);
    expect(policy.isAllowed('calc')).toBe(true);
    expect(policy.isAllowed('admin')).toBe(false);
  });

  it('grant adds a tool', () => {
    const policy = new PermissionPolicy();
    expect(policy.isAllowed('search')).toBe(false);
    policy.grant('search');
    expect(policy.isAllowed('search')).toBe(true);
  });

  it('revoke removes a tool', () => {
    const policy = new PermissionPolicy(['search']);
    policy.revoke('search');
    expect(policy.isAllowed('search')).toBe(false);
  });

  it('wildcard grants all', () => {
    const policy = new PermissionPolicy(['*']);
    expect(policy.isAllowed('anything')).toBe(true);
    expect(policy.isAllowed('admin')).toBe(true);
  });

  it('getAllowed returns current set', () => {
    const policy = new PermissionPolicy(['a', 'b']);
    policy.grant('c');
    expect(policy.getAllowed()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });
});

describe('PermissionPolicy: role-based', () => {
  const roles = {
    user: ['search', 'calc'],
    admin: ['search', 'calc', 'delete-user', 'run-code'],
    readonly: ['search'],
  };

  it('starts with active role permissions', () => {
    const policy = PermissionPolicy.fromRoles(roles, 'user');
    expect(policy.isAllowed('search')).toBe(true);
    expect(policy.isAllowed('delete-user')).toBe(false);
    expect(policy.getRole()).toBe('user');
  });

  it('setRole switches permissions', () => {
    const policy = PermissionPolicy.fromRoles(roles, 'user');
    policy.setRole('admin');
    expect(policy.isAllowed('delete-user')).toBe(true);
    expect(policy.getRole()).toBe('admin');
  });

  it('setRole to unknown role throws', () => {
    const policy = PermissionPolicy.fromRoles(roles, 'user');
    expect(() => policy.setRole('superadmin')).toThrow('Unknown role');
  });

  it('setRole without fromRoles throws', () => {
    const policy = new PermissionPolicy(['a']);
    expect(() => policy.setRole('admin')).toThrow('fromRoles');
  });
});

describe('PermissionPolicy: onChange callback', () => {
  it('fires on grant', () => {
    const events: any[] = [];
    const policy = new PermissionPolicy([], { onChange: (e) => events.push(e) });
    policy.grant('search');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('grant');
    expect(events[0].toolId).toBe('search');
  });

  it('fires on revoke', () => {
    const events: any[] = [];
    const policy = new PermissionPolicy(['search'], { onChange: (e) => events.push(e) });
    policy.revoke('search');
    expect(events[0].type).toBe('revoke');
  });

  it('fires on role change', () => {
    const events: any[] = [];
    const policy = PermissionPolicy.fromRoles({ user: ['a'], admin: ['a', 'b'] }, 'user', {
      onChange: (e) => events.push(e),
    });
    policy.setRole('admin');
    expect(events[0].type).toBe('role-change');
    expect(events[0].role).toBe('admin');
  });
});

describe('PermissionPolicy: checker() bridge to gatedTools', () => {
  it('returns a PermissionChecker function', () => {
    const policy = new PermissionPolicy(['search']);
    const check = policy.checker();
    expect(typeof check).toBe('function');
    expect(check('search', {} as any)).toBe(true);
    expect(check('admin', {} as any)).toBe(false);
  });

  it('checker reflects runtime changes', () => {
    const policy = new PermissionPolicy();
    const check = policy.checker();
    expect(check('search', {} as any)).toBe(false);
    policy.grant('search');
    expect(check('search', {} as any)).toBe(true);
  });
});
