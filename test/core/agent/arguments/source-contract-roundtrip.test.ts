/** Closed ownership annotations are schema projection facts, never source authority. */
import { describe, expect, it } from 'vitest';
import type { LLMToolSchema } from '../../../../src/index.js';
import {
  withFindingsArgument,
  withSourcesArgument,
  withoutFindingsArgument,
  FINDINGS_ARGUMENT_SCHEMA_WITH_FROM,
  FINDINGS_SOURCES_SCHEMA,
} from '../../../../src/core/agent/findings/reserved.js';
import {
  OPTIONAL_FINDINGS_HEAD,
  projectSourceInstructions,
  requireSourceContract,
  sourceDeclarationView,
} from '../../../../src/core/agent/sourceContract.js';
import { validateToolArgs } from '../../../../src/tools/toolArgsValidation.js';

type Bag = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const shape = (required?: readonly string[]): LLMToolSchema => ({
  name: 'read_source',
  description: 'Synthetic input.',
  inputSchema: {
    type: 'object',
    $comment: 'author-root-comment',
    additionalProperties: false,
    properties: { vm: { type: 'string' }, from: { type: 'string' }, other: { type: 'number' } },
    ...(required !== undefined && { required }),
  },
});
const envelope = (schema: LLMToolSchema) => (schema.inputSchema.properties as Bag)._findings as Bag;
const piece = {
  source: 'instructions',
  sourceId: 'findings-ledger',
  rawContent: OPTIONAL_FINDINGS_HEAD + '\nExisting observation instructions.',
  contentHash: 'old-hash',
  contentSummary: 'old-summary',
  slot: 'system-prompt',
};

describe('native source schema ownership and inverse', () => {
  it.each([null, 'vm', {}, 0, false, undefined])(
    'refuses to project an own non-array required keyword: %j',
    (required) => {
      const input = { type: 'object', properties: {}, required };
      const before = Object.getOwnPropertyDescriptors(input);
      let refusal: unknown;
      try {
        requireSourceContract(input, FINDINGS_SOURCES_SCHEMA);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(TypeError);
      expect((refusal as TypeError).message).toBe(
        "Source contract requires an array 'required' keyword.",
      );
      expect(Object.getOwnPropertyDescriptors(input)).toEqual(before);
      expect(input.properties).not.toHaveProperty('_findings');
    },
  );

  for (const ledger of [false, true])
    for (const required of [
      undefined,
      [],
      ['vm'],
      ['_findings', 'vm'],
      ['vm', '_findings', 'other', '_findings', 'vm'],
    ] as const) {
      it(`round-trips required ${JSON.stringify(
        required,
      )} including a JSON clone (ledger=${ledger})`, () => {
        const original = shape(required),
          before = clone(original);
        const planted = ledger
          ? withFindingsArgument(original, { from: true, sourceContract: true })
          : withSourcesArgument(original, true);
        expect(original).toEqual(before);
        expect(planted.inputSchema.required).toEqual(
          required?.includes('_findings') ? required : [...(required ?? []), '_findings'],
        );
        expect(Object.isFrozen(envelope(planted))).toBe(true);
        expect(Object.isFrozen(envelope(planted).properties)).toBe(true);
        expect(withoutFindingsArgument(planted.inputSchema)).toEqual(original.inputSchema);
        expect(withoutFindingsArgument(clone(planted).inputSchema)).toEqual(original.inputSchema);
        expect(Object.hasOwn(withoutFindingsArgument(planted.inputSchema) as Bag, 'required')).toBe(
          required !== undefined,
        );
        expect(
          ledger
            ? withFindingsArgument(planted, { from: true, sourceContract: true })
            : withSourcesArgument(planted, true),
        ).toBe(planted);
        const round = clone(planted);
        expect(
          ledger
            ? withFindingsArgument(round, { from: true, sourceContract: true })
            : withSourcesArgument(round, true),
        ).toBe(round);
      });
    }

  it('leaves author-owned properties, comments and required entries as the same schema', () => {
    const original = shape(['vm', '_findings', '_findings']);
    const authored: LLMToolSchema = {
      ...original,
      inputSchema: {
        ...original.inputSchema,
        properties: {
          ...(original.inputSchema.properties as Bag),
          _findings: {
            type: 'string',
            $comment: 'agentfootprint:source-contract:v1:required-added-absent',
            description: 'Author metadata.',
          },
        },
      },
    };
    expect(withFindingsArgument(authored, { from: true, sourceContract: true })).toBe(authored);
    expect(withSourcesArgument(authored, true)).toBe(authored);
    expect(withoutFindingsArgument(authored.inputSchema)).toBe(authored.inputSchema);
    expect(projectSourceInstructions([piece], [authored])[0]).toBe(piece);
  });

  it('does not interpret a marker-like or future-version comment as owned required provenance', () => {
    const planted = withSourcesArgument(shape(), true);
    const comment = String(envelope(planted).$comment);
    for (const value of [comment + '-lookalike', comment.replace(':v1:', ':v2:'), 'author-note']) {
      const changed: LLMToolSchema = {
        ...planted,
        inputSchema: {
          ...planted.inputSchema,
          properties: {
            ...(planted.inputSchema.properties as Bag),
            _findings: { ...envelope(planted), $comment: value },
          },
        },
      };
      expect((withoutFindingsArgument(changed.inputSchema) as Bag).required).toEqual(['_findings']);
      expect(projectSourceInstructions([piece], [changed])[0]).toBe(piece);
    }
  });

  it('uses the same actual required members for served and error schemas, without ownership comments in error data', () => {
    for (const ledger of [false, true]) {
      const planted = ledger
        ? withFindingsArgument(shape(), { from: true, sourceContract: true })
        : withSourcesArgument(shape(), true);
      const error = sourceDeclarationView(
        ledger ? FINDINGS_ARGUMENT_SCHEMA_WITH_FROM : FINDINGS_SOURCES_SCHEMA,
      );
      const declaration = (error.properties as Bag)._findings as Bag;
      expect(declaration.required).toEqual(envelope(planted).required);
      for (const key of declaration.required as string[])
        expect((declaration.properties as Bag)[key]).toBe(
          (envelope(planted).properties as Bag)[key],
        );
      expect(JSON.stringify(error)).not.toContain('$comment');
      expect(validateToolArgs({}, error).ok).toBe(false);
      expect(
        validateToolArgs({ _findings: { ...(ledger && { basis: 'direct' }), from: [] } }, error).ok,
      ).toBe(true);
    }
  });

  it('changes only the native instruction for the actual final offered ASK cohort', () => {
    const tool = withSourcesArgument(shape(), true);
    const app = { ...piece, sourceId: 'author-instruction' },
      base = { ...piece, source: 'base' };
    const pieces = [app, piece, base];
    expect(projectSourceInstructions(pieces, [])).toBe(pieces);
    expect(projectSourceInstructions(pieces, [withSourcesArgument(shape())])).toBe(pieces);
    const changed = projectSourceInstructions(pieces, [tool]);
    expect(changed).not.toBe(pieces);
    expect(changed[0]).toBe(app);
    expect(changed[2]).toBe(base);
    expect(changed[1]!.rawContent).not.toContain(OPTIONAL_FINDINGS_HEAD);
    expect(changed[1]!.rawContent).toContain('_findings.from');
    expect(changed[1]!.rawContent).toContain('Existing observation instructions.');
    expect(changed[1]!.contentHash).not.toBe(piece.contentHash);
    expect(piece.rawContent).toContain(OPTIONAL_FINDINGS_HEAD);
    expect(projectSourceInstructions(changed, [tool])).toBe(changed);
    const unknown = projectSourceInstructions(pieces, undefined);
    expect(unknown).toEqual([app, base]);
    expect(unknown[0]).toBe(app);
    expect(unknown[1]).toBe(base);
    expect(projectSourceInstructions(unknown, undefined)).toBe(unknown);
  });
});
