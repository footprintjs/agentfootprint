import { applyOutputSchema } from '../../../../answer-validation/outputSchema.js';
import type { OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import { ValidationFailure, type OutputSchemaValidator } from '../reliabilityExecution.js';

/** Validate terminal output before the reliability loop accepts it. The findings peel is opt-in. */
export function postValidateOutput(
  parser: OutputSchemaParser<unknown> | undefined,
  peel: ((text: string) => { readonly content: string }) | undefined,
): OutputSchemaValidator | undefined {
  if (parser === undefined) return undefined;
  return (response) => {
    try {
      // The validator sees the answer the model meant, without its standings envelope.
      applyOutputSchema(
        peel === undefined ? response.content : peel(response.content).content,
        parser,
      );
    } catch (err) {
      // Preserve stage and first schema path on the gate's typed report.
      const e = err as {
        message: string;
        stage?: 'json-parse' | 'schema-validate';
        rawOutput?: string;
        cause?: {
          message?: string;
          issues?: ReadonlyArray<{ path?: ReadonlyArray<string | number> }>;
        };
      };
      let path: string | undefined;
      const firstIssue = e.cause?.issues?.[0];
      if (firstIssue?.path && firstIssue.path.length > 0) path = firstIssue.path.join('.');
      throw new ValidationFailure({
        message: e.cause?.message ?? e.message,
        stage: e.stage ?? 'schema-validate',
        ...(path !== undefined && { path }),
        ...(e.rawOutput !== undefined && { rawOutput: e.rawOutput }),
      });
    }
  };
}
