/**
 * validateToolInput — lightweight JSON Schema validation for tool arguments.
 *
 * Validates LLM-provided tool arguments against the tool's inputSchema
 * before calling the handler. Catches malformed arguments early with
 * a clear error message fed back to the LLM.
 *
 * Supports: required fields, type checking (string, number, boolean, object, array).
 * Does NOT support: $ref, oneOf, allOf, pattern, min/max, nested validation.
 * For complex schemas, use a full validator (Ajv) in the handler.
 */

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

/**
 * Validate tool arguments against a JSON Schema.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
export function validateToolInput(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Check required fields
  const required = schema.required as string[] | undefined;
  if (Array.isArray(required)) {
    for (const field of required) {
      if (args[field] === undefined || args[field] === null) {
        errors.push({ path: field, message: `Required field '${field}' is missing.` });
      }
    }
  }

  // Check property types
  const properties = schema.properties as Record<string, { type?: string }> | undefined;
  if (properties) {
    for (const [key, prop] of Object.entries(properties)) {
      const value = args[key];
      if (value === undefined || value === null) continue; // Skip optional missing fields

      if (prop.type) {
        const expectedType = prop.type;
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (expectedType === 'integer') {
          if (typeof value !== 'number' || !Number.isInteger(value)) {
            errors.push({
              path: key,
              message: `Expected integer for '${key}', got ${actualType}.`,
            });
          }
        } else if (expectedType !== actualType) {
          errors.push({
            path: key,
            message: `Expected ${expectedType} for '${key}', got ${actualType}.`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format validation errors as a string for the LLM tool result.
 */
export function formatValidationErrors(errors: readonly ValidationError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join('; ');
}
