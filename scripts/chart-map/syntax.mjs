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

export function owner(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      (ts.isFunctionDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent)) &&
      parent.name
    ) {
      const container = parent.parent;
      const prefix =
        (ts.isClassDeclaration(container) || ts.isClassExpression(container)) && container.name
          ? `${container.name.text}.`
          : '';
      return prefix + parent.name.getText();
    }
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent)
    )
      return parent.parent.name.getText();
    if (ts.isConstructorDeclaration(parent))
      return `${parent.parent.name?.getText() ?? '<class>'}.constructor`;
  }
  return '<module>';
}

export function context(node) {
  const rows = [];
  const enclosing = (shape, point) =>
    rows.push(
      'Inside ' +
        shape +
        ' at line ' +
        (point.getSourceFile().getLineAndCharacterOfPosition(point.getStart()).line + 1) +
        '; outcome not analysed',
    );
  if (
    ts.isCallChain(node) ||
    (ts.isPropertyAccessExpression(node.expression) && node.expression.questionDotToken)
  )
    enclosing('optional chain', node);
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.arguments.includes(parent)
    ) {
      enclosing('callback (' + expression(parent.parent.expression) + ')', parent);
    }
    if (
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent) ||
      ts.isCatchClause(parent) ||
      ts.isTryStatement(parent)
    )
      enclosing(ts.SyntaxKind[parent.kind], parent);
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
      enclosing('logical ' + parent.operatorToken.getText(), parent);
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
