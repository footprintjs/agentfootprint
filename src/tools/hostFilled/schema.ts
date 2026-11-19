import type { Tool } from '../tools.js';

/**
 * Whether `field` is named anywhere in the schema OTHER than the root's own
 * `properties` / `required` — a combinator (`allOf`/`anyOf`/`oneOf`, `if`/
 * `then`/`else`, `not`), `$defs`, `dependentRequired`/`dependencies`, or a
 * nested object's `properties`/`required`. The root's own property schema is
 * not walked.
 */
function mentionsElsewhere(schema: unknown, field: string): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const seen = new Set<object>();
  const walk = (node: unknown, root: boolean): boolean => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some((n) => walk(n, false));
    const obj = node as Record<string, unknown>;
    if (!root) {
      const props = obj.properties;
      if (props !== null && typeof props === 'object' && Object.hasOwn(props, field)) return true;
      if (Array.isArray(obj.required) && obj.required.includes(field)) return true;
    }
    for (const key of ['dependentRequired', 'dependencies', 'dependentSchemas']) {
      const dep = obj[key];
      if (dep !== null && typeof dep === 'object') {
        if (Object.hasOwn(dep, field)) return true;
        for (const v of Object.values(dep)) {
          if (Array.isArray(v) && v.includes(field)) return true;
        }
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (root && key === 'required') continue;
      if (root && key === 'properties' && value !== null && typeof value === 'object') {
        for (const [prop, sub] of Object.entries(value)) {
          if (prop !== field && walk(sub, false)) return true;
        }
        continue;
      }
      if (walk(value, false)) return true;
    }
    return false;
  };
  return walk(schema, true);
}

/**
 * Whether the ROOT object's shape names `field` through a combinator or a
 * definition — anything that makes it an argument of the call without being
 * one of the root's own `properties`. Nested objects' properties are not
 * walked.
 */
function declaresAtRoot(schema: unknown, field: string): boolean {
  const SHAPE_KEYS = [
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    '$defs',
    'definitions',
  ];
  const seen = new Set<object>();
  const walk = (node: unknown, root: boolean): boolean => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some((n) => walk(n, false));
    const obj = node as Record<string, unknown>;
    if (!root) {
      const props = obj.properties;
      if (props !== null && typeof props === 'object' && Object.hasOwn(props, field)) return true;
      if (Array.isArray(obj.required) && obj.required.includes(field)) return true;
    }
    for (const key of ['dependentRequired', 'dependencies', 'dependentSchemas']) {
      const dep = obj[key];
      if (dep !== null && typeof dep === 'object' && Object.hasOwn(dep, field)) return true;
    }
    for (const key of SHAPE_KEYS) {
      const value = obj[key];
      if (value === null || typeof value !== 'object') continue;
      // `$defs` / `definitions` are maps of schemas; the others are schemas or lists.
      const children = key === '$defs' || key === 'definitions' ? Object.values(value) : [value];
      if (children.some((c) => walk(c, false))) return true;
    }
    return false;
  };
  return walk(schema, true);
}

function refuseNested(tool: Tool, field: string): never {
  throw new TypeError(
    `hostFilled: tool '${tool.schema.name}' names '${field}' inside a nested schema or a ` +
      'combinator (allOf/anyOf/oneOf, $defs, dependentRequired …), where it cannot be removed ' +
      'from what the model reads — declare it as a top-level property, or wrap the tool yourself.',
  );
}

function withoutFields(
  schema: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  const props = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  for (const f of fields) delete props[f];
  const out: Record<string, unknown> = { ...schema, properties: props };
  if (Array.isArray(schema.required)) {
    const required = (schema.required as unknown[]).filter(
      (r) => typeof r !== 'string' || !fields.includes(r),
    );
    if (required.length > 0) out.required = required;
    else delete out.required;
  }
  return out;
}

export { mentionsElsewhere, declaresAtRoot, refuseNested, withoutFields };
