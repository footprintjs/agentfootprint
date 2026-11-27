import ts from 'typescript';

export const unwrap = (node) => {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  ) {
    node = node.expression;
  }
  return node;
};
export const expression = (node) => {
  if (!node) return '[implicit]';
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length <= 160 ? text : `${text.slice(0, 160)}… [see source]`;
};

function ownerBoundary(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ((ts.isFunctionDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent)) &&
        parent.name) ||
      ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
        ts.isVariableDeclaration(parent.parent)) ||
      ts.isConstructorDeclaration(parent)
    )
      return parent;
  }
}

export function owner(node) {
  const boundary = ownerBoundary(node);
  if (!boundary) return '<module>';
  if (ts.isArrowFunction(boundary) || ts.isFunctionExpression(boundary))
    return boundary.parent.name.getText();
  const container = boundary.parent;
  if (ts.isConstructorDeclaration(boundary))
    return (container.name?.getText() ?? '<class>') + '.constructor';
  const prefix =
    (ts.isClassDeclaration(container) || ts.isClassExpression(container)) && container.name
      ? container.name.text + '.'
      : '';
  return prefix + boundary.name.getText();
}

function functionContext(node) {
  const parent = node.parent;
  if (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.arguments?.includes(node)
  )
    return (
      'callback (' +
      (ts.isNewExpression(parent) ? 'new ' : '') +
      expression(parent.expression) +
      ')'
    );
  const attachment =
    ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)
      ? 'property ' + expression(parent.name)
      : ts.SyntaxKind[parent.kind];
  return 'function (' + ts.SyntaxKind[node.kind] + ' under ' + attachment + ')';
}

export function context(node) {
  const rows = [];
  const enclosing = (shape) => rows.push('Inside ' + shape + '; outcome not analysed');
  const boundary = ownerBoundary(node);
  if (
    ts.isCallChain(node) ||
    (ts.isPropertyAccessExpression(node.expression) && node.expression.questionDotToken)
  )
    enclosing('optional chain');
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (parent !== boundary && (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)))
      enclosing(functionContext(parent));
    if (
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent) ||
      ts.isCatchClause(parent) ||
      ts.isTryStatement(parent)
    )
      enclosing(ts.SyntaxKind[parent.kind]);
    if (
      ts.isBinaryExpression(parent) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(parent.operatorToken.kind) &&
      node.pos >= parent.right.pos &&
      node.end <= parent.right.end
    )
      enclosing('logical ' + parent.operatorToken.getText());
    if (ts.isIfStatement(parent)) {
      const otherwise =
        parent.elseStatement &&
        node.pos >= parent.elseStatement.pos &&
        node.end <= parent.elseStatement.end;
      rows.push(`${otherwise ? 'else of' : 'if'} (${expression(parent.expression)})`);
    } else if (ts.isConditionalExpression(parent)) {
      rows.push(
        `${node.pos >= parent.whenFalse.pos ? 'false' : 'true'} branch of (${expression(
          parent.condition,
        )})`,
      );
    } else if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      rows.push(
        `for (${expression(parent.initializer)} ${
          ts.isForOfStatement(parent) ? 'of' : 'in'
        } ${expression(parent.expression)})`,
      );
    } else if (ts.isForStatement(parent)) {
      rows.push(
        `for (${expression(parent.initializer)}; ${expression(parent.condition)}; ${expression(
          parent.incrementor,
        )})`,
      );
    } else if (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) {
      rows.push(`while (${expression(parent.expression)})`);
    }
  }
  return rows.reverse();
}
