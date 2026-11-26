import ts from 'typescript';
import { unwrap, expression } from './syntax.mjs';
export function createSourceValues(declarationOf) {
  // Resolve immutable primitive bindings only. Object-property initializers do not
  // establish their current values, even when the object binding itself is const.
  function literal(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return undefined;
    const next = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const value = literal(span.expression, next);
        if (value === undefined) return undefined;
        text += value + span.literal.text;
      }
      return text;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left, next),
        right = literal(node.right, next);
      return left !== undefined && right !== undefined ? left + right : undefined;
    }
    const declaration = declarationOf(node);
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.parent.flags & ts.NodeFlags.Const
    ) {
      return literal(declaration.initializer, next);
    }
    return undefined;
  }

  function value(node) {
    if (!node) return '[implicit]';
    const text = literal(node);
    return text === undefined ? `[expression] ${expression(node)}` : text;
  }

  function description(node) {
    if (!node) return { state: 'absent', text: '' };
    const text = literal(node);
    return text === undefined
      ? { state: 'expression', text: expression(node) }
      : { state: 'literal', text };
  }

  function chartDescription(node) {
    node = unwrap(node);
    if (!node) return description(undefined);
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of [...node.properties].reverse()) {
        if (ts.isSpreadAssignment(property)) return { state: 'expression', text: expression(node) };
        const name =
          property.name && ts.isComputedPropertyName(property.name)
            ? literal(property.name.expression)
            : property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            ? property.name.text
            : undefined;
        if (name === undefined && property.name && ts.isComputedPropertyName(property.name)) {
          return { state: 'expression', text: expression(node) };
        }
        if (name !== 'description') continue;
        if (ts.isPropertyAssignment(property)) return description(property.initializer);
        if (ts.isShorthandPropertyAssignment(property)) return description(property.name);
        return { state: 'expression', text: expression(property) };
      }
      return description(undefined);
    }
    return { state: 'expression', text: expression(node) };
  }

  return { value, description, chartDescription };
}
