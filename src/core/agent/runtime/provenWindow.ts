import type { AgentConfiguration } from './configuration/types.js';

/** The opt-in needs a prose delivery door in which the library can state the interval. */
export function canServeProvenWindow(config: AgentConfiguration): boolean {
  return (
    config.timeOptions?.skipProvenConfirmation === true &&
    config.outputSchemaParser === undefined &&
    config.outputEnforcement?.outputFormat === undefined &&
    config.answerValidationConfig === undefined
  );
}
