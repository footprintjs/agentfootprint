/**
 * Minimal Zod-to-JSON-Schema converter. Duck-typed — no zod dependency.
 * Handles: object, string, number, boolean, array, enum, optional, default.
 * @internal
 */
export function zodToJsonSchema(zodSchema: any): Record<string, unknown> {
  const def = zodSchema._def;
  if (!def) return { type: 'object' };

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = zodSchema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as any);
        if ((value as any)._def?.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    case 'ZodString': {
      const r: Record<string, unknown> = { type: 'string' };
      if (def.description) r.description = def.description;
      return r;
    }
    case 'ZodNumber': {
      const r: Record<string, unknown> = { type: 'number' };
      if (def.description) r.description = def.description;
      return r;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def.type) };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodOptional':
      return zodToJsonSchema(def.innerType);
    case 'ZodDefault':
      return zodToJsonSchema(def.innerType);
    case 'ZodNullable': {
      const inner = zodToJsonSchema(def.innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodLiteral':
      return { const: def.value };
    default:
      return {};
  }
}

/** Duck-type check: is this a Zod schema? */
export function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).safeParse === 'function' &&
    (value as any)._def !== undefined
  );
}
