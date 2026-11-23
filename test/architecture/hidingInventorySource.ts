import ts from 'typescript';

export function sourceAnchors(source: ts.SourceFile, symbol: string): ts.Node[] {
  const anchors: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.body !== undefined &&
      node.name !== undefined &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === symbol
    ) {
      anchors.push(node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === symbol &&
      node.initializer !== undefined &&
      !(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient)
    ) {
      anchors.push(node);
    }
    ts.forEachChild(node, visit);
  };
  if (!source.isDeclarationFile) visit(source);
  return anchors;
}

/** Bind calls to the specified value import, using only the file being scanned. */
export function importedCalls(
  source: ts.SourceFile,
  modulePath: string,
  exportName: string,
): ts.CallExpression[] {
  const bindings = new Set<ts.Declaration>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    const named = clause?.namedBindings;
    if (
      statement.moduleSpecifier.text !== modulePath ||
      clause?.isTypeOnly ||
      !named ||
      !ts.isNamedImports(named)
    )
      continue;
    for (const binding of named.elements) {
      if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === exportName)
        bindings.add(binding);
    }
  }
  if (bindings.size === 0) return [];

  const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.ES2022 };
  const fileName = source.fileName.replaceAll('\\', '/');
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === fileName ? source : undefined);
  const checker = ts.createProgram([fileName], options, host).getTypeChecker();
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
      if (
        ts.isIdentifier(callee) &&
        checker.getSymbolAtLocation(callee)?.declarations?.some((decl) => bindings.has(decl))
      )
        calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}
