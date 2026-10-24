/** One surrounding presentation wrapper is tolerated; JSON and schema stay strict. */
import { describe, expect, it, vi } from 'vitest';
import { applyOutputSchema, OutputSchemaError } from '../../src/answer-validation/outputSchema.js';

const identity = { parse: (value: unknown) => value };
const payload = { summary: 'Lookup completed.', negatives: [] };
const json = JSON.stringify(payload);

describe('one whole-answer Markdown fence', () => {
  it.each([
    `\`\`\`json\n${json}\n\`\`\``,
    `\`\`\`\n${json}\n\`\`\``,
    `\`\`\`JSON\n${json}\n\`\`\``,
    ` \t\r\n\`\`\` json \t\r\n  ${json} \r\n\t\`\`\` \t\r\n`,
    `\`\`\`json\n\n${JSON.stringify(payload, null, 2)}\n\n\`\`\`\n`,
  ])('accepts only the wrapper around valid JSON: %#', (raw) => {
    const parser = { parse: vi.fn((value: unknown) => value) };
    expect(applyOutputSchema(raw, parser)).toEqual(payload);
    expect(parser.parse).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it.each([null, true, false, 0, 1.25, '```', 'inside ```json\ntext\n```', [1, '```']])(
    'preserves bare and fenced JSON values, including literal backticks: %#',
    (value) => {
      const raw = JSON.stringify(value);
      expect(applyOutputSchema(raw, identity)).toEqual(value);
      expect(applyOutputSchema(`\`\`\`json\n${raw}\n\`\`\``, identity)).toEqual(value);
    },
  );

  it.each([
    `Here is the answer:\n\`\`\`json\n${json}\n\`\`\``,
    `\`\`\`json\n${json}\n\`\`\`\nExplanation follows.`,
    `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``,
    `\`\`\`json\n\`\`\`json\n${json}\n\`\`\`\n\`\`\``,
    `\`\`\`javascript\n${json}\n\`\`\``,
    `\`\`\`json extra\n${json}\n\`\`\``,
    `\`\`\`json ${json}\`\`\``,
    `\`\`\`json\n${json}`,
    `${json}\n\`\`\``,
    `\`\`\`\`json\n${json}\n\`\`\`\``,
    `~~~json\n${json}\n~~~`,
    `\`\`\`json\n${json}\n\`\`\`\u00a0`,
  ])('rejects surrounding prose, extra wrappers and unsupported fences: %#', (raw) => {
    const parser = { parse: vi.fn((value: unknown) => value) };
    expect(() => applyOutputSchema(raw, parser)).toThrow(OutputSchemaError);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it.each([
    '{"summary":"bad",}',
    '{summary:"bad"}',
    '{"summary":undefined}',
    '{"summary":NaN}',
    '{"summary":"bad" // comment\n}',
    '{} {}',
    '"unclosed',
    '',
  ])('does not repair malformed JSON inside an accepted wrapper: %#', (body) => {
    const raw = ` \r\n\`\`\`json\r\n${body}\r\n\`\`\`\t\r\n`;
    const parser = { parse: vi.fn((value: unknown) => value) };
    try {
      applyOutputSchema(raw, parser);
      throw new Error('Expected JSON failure');
    } catch (error) {
      expect(error).toBeInstanceOf(OutputSchemaError);
      expect(error).toMatchObject({ rawOutput: raw, stage: 'json-parse' });
      expect((error as OutputSchemaError).cause).toBeInstanceOf(SyntaxError);
    }
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('preserves the original response and schema error after stripping the wrapper', () => {
    const raw = '\t```json\r\n{"summary":17,"negatives":[]}\r\n``` \r\n';
    const cause = new Error('summary must be a string');
    const parser = {
      parse: vi.fn((value: unknown) => {
        expect(value).toEqual({ summary: 17, negatives: [] });
        throw cause;
      }),
    };
    expect(() => applyOutputSchema(raw, parser)).toThrowError(
      expect.objectContaining({ rawOutput: raw, stage: 'schema-validate', cause }),
    );
    expect(parser.parse).toHaveBeenCalledTimes(1);
  });
});
