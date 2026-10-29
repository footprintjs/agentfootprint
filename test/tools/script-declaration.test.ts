/**
 * `Tool.script` — a tool is code-running because it DECLARES so (design
 * docs/design/2026-10-script-artifact.md § 4.1), judged by one rule at the
 * three doors a declaration crosses: definition (`defineTool`), dispatch
 * (`scriptOf`, for a Tool built by hand or served by a ToolProvider) and MCP
 * ingest (`readToolExtras`). Never inferred from a name, a property or a
 * description. And the two options that arm the record are checked where they
 * are typed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import { Agent, codeRunnerTool, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { assertToolScript, scriptOf } from '../../src/tools/script.js';
import {
  _resetToolExtrasWarnings,
  readToolExtras,
  toolExtrasOf,
} from '../../src/mcp/toolExtras.js';
import { resolveEvidenceGate } from '../../src/core/agent/evidence/gate.js';
import type { Tool } from '../../src/tools/tools.js';

const SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string' }, limit: { type: 'number' } },
  required: ['query'],
} as const;

const define = (script: unknown, extra: Record<string, unknown> = {}) =>
  defineTool({
    name: 'run_sql',
    description: 'runs SQL',
    inputSchema: SCHEMA,
    script: script as never,
    execute: () => 'rows',
    ...extra,
  });

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

describe('the definition door — defineTool', () => {
  it('a declared string argument is kept, as a frozen copy of its two fields', () => {
    const tool = define({ argument: 'query', language: 'sql' });
    expect(tool.script).toEqual({ argument: 'query', language: 'sql' });
    expect(Object.isFrozen(tool.script)).toBe(true);
  });

  it.each([
    ['not an object', 'query', /must be \{ argument, language\? \}/],
    ['an unknown key', { argument: 'query', lang: 'sql' }, /unknown key\(s\) 'lang'/],
    ['no argument', { language: 'sql' }, /must name the ONE string argument/],
    [
      'an argument the schema does not declare',
      { argument: 'code' },
      /does not declare as a string/,
    ],
    ['an argument that is not a string', { argument: 'limit' }, /does not declare as a string/],
    ['an empty language', { argument: 'query', language: '' }, /non-empty string/],
    ['a language with a backtick', { argument: 'query', language: 'sq`l' }, /backtick/],
    ['a language with a line break', { argument: 'query', language: 'sql\nx' }, /line break/],
    ['a language too long', { argument: 'query', language: 'x'.repeat(65) }, /at most 64/],
  ])('refuses %s, naming the tool and the field', (_label, script, message) => {
    expect(() => define(script)).toThrow(message);
    expect(() => define(script)).toThrow(/defineTool\('run_sql'\): `script`/);
  });

  it('refuses a `wants` argument: it carries an artifact ref, never the program', () => {
    expect(() =>
      defineTool({
        name: 'run_sql',
        description: 'runs SQL',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        wants: { query: 'dataset/rows' },
        script: { argument: 'query' },
        execute: () => 'rows',
      }),
    ).toThrow(/is a `wants` argument/);
  });

  it('codeRunnerTool declares `script: { argument: "code", language }`', () => {
    const runner = { id: 'r', start: () => Promise.reject(new Error('unused')) };
    expect(codeRunnerTool({ runner }).script).toEqual({ argument: 'code', language: 'python' });
    expect(codeRunnerTool({ runner, language: 'javascript' }).script).toEqual({
      argument: 'code',
      language: 'javascript',
    });
  });

  it('nothing is inferred: a tool named run_code with a `code` property declares nothing', () => {
    const tool = defineTool({
      name: 'run_code',
      description: 'Execute Python code',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
      execute: () => 'ok',
    });
    expect(tool.script).toBeUndefined();
    expect(scriptOf(tool)).toBeUndefined();
  });
});

describe('the dispatch door — scriptOf, for a tool that never passed defineTool', () => {
  const handBuilt = (script: unknown): Tool =>
    ({
      schema: { name: 'hand', description: 'hand built', inputSchema: SCHEMA },
      script,
      execute: () => 'ok',
    } as unknown as Tool);

  it('a well-formed declaration is read, once per tool object', () => {
    const tool = handBuilt({ argument: 'query' });
    const first = scriptOf(tool);
    expect(first).toEqual({ argument: 'query' });
    expect(scriptOf(tool)).toBe(first);
  });

  it('a malformed one is NOT honoured — the tool files no row — and dev mode names the rule once', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tool = handBuilt({ argument: 'limit' });
    expect(scriptOf(tool)).toBeUndefined();
    expect(scriptOf(tool)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/declares a `script` the library cannot read/);
  });

  it('the assert is the same rule the definition door runs', () => {
    expect(() => assertToolScript('x', { argument: 'query' }, SCHEMA)).not.toThrow();
    expect(() => assertToolScript('x', { argument: 'nope' }, SCHEMA)).toThrow(/string property/);
  });
});

describe('the MCP doors — served, and judged at ingest', () => {
  it('mcpServe serves the declaration in _meta; a tool that declares none sends none', () => {
    expect(toolExtrasOf(define({ argument: 'query', language: 'sql' }) as Tool)).toEqual({
      script: { argument: 'query', language: 'sql' },
    });
  });

  it('ingest keeps a well-formed declaration and drops a malformed one, warned once', () => {
    _resetToolExtrasWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const origin = { server: 'db', tool: 'run_sql', inputSchema: SCHEMA };
    expect(
      readToolExtras(
        { agentfootprint: { script: { argument: 'query', language: 'sql' } } },
        origin,
      ),
    ).toEqual({ script: { argument: 'query', language: 'sql' } });
    expect(readToolExtras({ agentfootprint: { script: { argument: 'limit' } } }, origin)).toEqual(
      {},
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/declared `script` on tool 'run_sql'/);
  });
});

describe('the options that arm the record', () => {
  it("code: 'check' (and an absent code) resolves to the gate it always was — byte for byte", () => {
    expect(resolveEvidenceGate({ code: 'check' })).toEqual(resolveEvidenceGate({}));
    expect('code' in resolveEvidenceGate({})).toBe(false);
    expect(resolveEvidenceGate({ code: 'match' }).code).toBe('match');
  });

  it("refuses any other value by name — there is no 'skip'", () => {
    expect(() => resolveEvidenceGate({ code: 'skip' as never })).toThrow(
      /code 'skip'.*no\s+'skip'/s,
    );
  });

  it("code: 'match' with no declaring tool is accepted, and dev mode warns once", () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const agent = Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' })
      .namesAndNumbersFromEvidence({ code: 'match' })
      .build();
    expect(agent).toBeDefined();
    expect(
      warn.mock.calls.some((c) => /code: 'match'.*no\s+registered tool/s.test(String(c[0]))),
    ).toBe(true);
  });
});
