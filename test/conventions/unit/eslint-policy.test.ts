/**
 * Development dependency upgrades must keep the repository's lint policy:
 * permitted transport fixtures stay permitted, and source warnings remain warnings.
 * These examples run through the real ESLint configuration, including test overrides.
 */
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: root });

async function messages(code: string, file = 'src/lib/lint-policy.ts') {
  return (await eslint.lintText(code, { filePath: resolve(root, file) }))[0].messages;
}

describe('repository lint policy', () => {
  it('permits CommonJS transports, explicit any, unused caught errors and expression fixtures', async () => {
    const code = `
      const transport = require('node:http');
      export function fixture(value: any) {
        try { transport.request(value); } catch (error) { console.log('handled'); }
        true;
        throw 'fixture failure';
      }
    `;
    expect(await messages(code)).toEqual([]);
  });

  it('keeps unused locals and non-null assertions as source warnings, exempt in tests', async () => {
    const code = 'export function size(value?: string) { const unused = 1; return value!.length; }';
    const source = await messages(code);
    expect(source.map(({ ruleId, severity }) => ({ ruleId, severity }))).toEqual([
      { ruleId: '@typescript-eslint/no-unused-vars', severity: 1 },
      { ruleId: '@typescript-eslint/no-non-null-assertion', severity: 1 },
    ]);
    expect(await messages(code, 'test/conventions/unit/lint-policy.test.ts')).toEqual([]);
  });

  it('still rejects wrapper, untyped-function and empty-object types', async () => {
    const diagnostics = await messages(`
      export type Wrapper = String;
      export type Untyped = Function;
      export type Empty = {};
      export interface EmptyInterface {}
    `);
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics.every(({ severity }) => severity === 2)).toBe(true);
  });

  it.each([
    ['export type Autocomplete = string & {};', '@typescript-eslint/no-restricted-types'],
    [
      'export type Function = () => void; export type Alias = Function;',
      '@typescript-eslint/no-restricted-types',
    ],
    ['export const count: number = 1;', '@typescript-eslint/no-inferrable-types'],
    ['export const count = 1;;', 'no-extra-semi'],
    ['export const count = 9007199254740993;', 'no-loss-of-precision'],
    [
      'export interface Port { run(value: string): void; name: string; run(value: number): void; }',
      '@typescript-eslint/adjacent-overload-signatures',
    ],
  ])('keeps the existing guard for %s', async (code, ruleId) => {
    expect(await messages(code)).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId, severity: 2 })]),
    );
  });
});
