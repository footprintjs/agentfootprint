/**
 * `effects: 'read'` — a LOCAL tool says it changes nothing (design R6). It is a
 * declaration a later check reads; it governs nothing, and a remote tool's
 * hint never relaxes anything, so it never crosses MCP.
 *
 * Sections: Unit · Security.
 */

import { describe, expect, it } from 'vitest';

import { defineTool } from '../../src/index.js';
import { readToolExtras, toolExtrasOf } from '../../src/mcp/toolExtras.js';

const base = { name: 'list_incidents', description: 'x', execute: () => [] };

describe("effects: 'read' — unit", () => {
  it('is stored as declared', () => {
    expect(defineTool({ ...base, effects: 'read' }).effects).toBe('read');
    expect('effects' in defineTool(base)).toBe(false);
  });

  it('refuses any other value', () => {
    expect(() => defineTool({ ...base, effects: 'write' as never })).toThrow(/effects/);
  });
});

describe("effects: 'read' — security: local only", () => {
  it('is never served over MCP, and a remote bag carrying it is ignored', () => {
    const tool = defineTool({ ...base, effects: 'read', resultKind: 'rows' });
    expect(toolExtrasOf(tool)).toEqual({ resultKind: 'rows' });
    expect(
      readToolExtras({ agentfootprint: { effects: 'read' } }, { server: 's', tool: 't' }),
    ).toEqual({});
  });
});
