/**
 * `hostFilled` × `Tool.search` — the wrapper's own declaration is how
 * composition learns which arguments the host fills (no duck-typing): the
 * filled values never reach the arguments any door records, so without it a
 * search narrowed to the caller's tenant would compose as un-narrowed.
 *
 * Sections: Unit · Contract · Security.
 */

import { describe, expect, it } from 'vitest';

import { defineTool, fromCredential, fromIdentity, hostFilled } from '../../src/index.js';
import { hostFillsOf } from '../../src/tools/hostFilled.js';
import type { ToolSearch } from '../../src/semantics/coverage/search/types.js';

const SEARCH: ToolSearch = {
  source: { what: 'the incident store', said: ['the incident store'] },
  subject: { what: 'incidents', said: ['incidents'] },
  arguments: [
    { name: 'service', role: 'population' },
    { name: 'tenantId', role: 'filter' },
    { name: 'token', role: 'inert' },
  ],
  complete: 'within-arguments',
};

const tool = (search: ToolSearch = SEARCH) =>
  defineTool({
    name: 'list_incidents',
    description: 'Incidents',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        tenantId: { type: 'string' },
        token: { type: 'string' },
      },
    },
    search,
    execute: () => [],
  });

describe('hostFillsOf — unit', () => {
  it('names each filled argument by where its value comes from, never the value', () => {
    const wrapped = hostFilled(tool(), {
      tenantId: fromIdentity('tenant'),
      token: fromCredential({ service: 'store' }),
    });
    expect(hostFillsOf(wrapped)).toEqual({
      identity: { tenantId: 'tenant' },
      credential: ['token'],
    });
  });

  it('is undefined for a tool nobody wrapped', () => {
    expect(hostFillsOf(tool())).toBeUndefined();
  });

  it('a wrap of a wrap keeps both declarations', () => {
    const once = hostFilled(tool(), { tenantId: fromIdentity('tenant') });
    const twice = hostFilled(once, { token: fromCredential({ service: 'store' }) });
    expect(hostFillsOf(twice)).toEqual({ identity: { tenantId: 'tenant' }, credential: ['token'] });
  });

  it('a list wrap records each wrapped tool', () => {
    const [wrapped] = hostFilled([tool()], { tenantId: fromIdentity('principal') });
    expect(hostFillsOf(wrapped as never)?.identity).toEqual({ tenantId: 'principal' });
  });

  it('the search declaration rides the wrapped tool unchanged', () => {
    const base = tool();
    expect(hostFilled(base, { tenantId: fromIdentity('tenant') }).search).toBe(base.search);
    expect(base.search).toEqual(SEARCH);
  });
});

describe('hostFilled × search — contract: a credential is never scope', () => {
  it('refuses a credential fill on an argument the search classifies as ground', () => {
    const search: ToolSearch = {
      ...SEARCH,
      arguments: SEARCH.arguments.map((a) =>
        a.name === 'token' ? { name: 'token', role: 'filter' as const } : a,
      ),
    };
    expect(() => hostFilled(tool(search), { token: fromCredential({ service: 'store' }) })).toThrow(
      /'token'.*inert/,
    );
  });

  it('an identity fill may be any role — it composes as a filter in effect', () => {
    expect(() => hostFilled(tool(), { tenantId: fromIdentity('tenant') })).not.toThrow();
  });
});
