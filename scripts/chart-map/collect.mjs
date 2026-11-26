import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const mounts = new Set([
  'addSubFlowChart',
  'addSubFlowChartNext',
  'addSubFlowChartBranch',
  'addLazySubFlowChart',
  'addLazySubFlowChartNext',
  'addLazySubFlowChartBranch',
]);
const stages = new Set([
  'flowChart',
  'addFunction',
  'addFunctionBranch',
  'addPausableFunctionBranch',
  'addDeciderFunction',
  'addSelectorFunction',
]);
const methods = new Set([...mounts, ...stages]);
const unwrap = (node) => {
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
const expression = (node) => {
  if (!node) return '[implicit]';
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length <= 160 ? text : `${text.slice(0, 160)}… [see source]`;
};

export function collectChartMap(rootDir) {
  const root = path.resolve(rootDir);
  const configPath = path.join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    root,
    { noEmit: true },
    configPath,
  );
  if (parsed.errors.length) {
    throw new Error(
      parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'),
    );
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const packageNames = new Map();
  const result = { mounts: [], stages: [] };

  function packageName(file) {
    if (packageNames.has(file)) return packageNames.get(file);
    let directory = path.dirname(file);
    let name;
    for (;;) {
      const filename = path.join(directory, 'package.json');
      if (existsSync(filename)) {
        const metadata = JSON.parse(readFileSync(filename, 'utf8'));
        if (typeof metadata.name === 'string') {
          name = metadata.name;
          break;
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    packageNames.set(file, name);
    return name;
  }

  function declarationOf(node) {
    const point = ts.isPropertyAccessExpression(node) ? node.name : node;
    let symbol = checker.getSymbolAtLocation(point);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }

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

  function engineMethod(declaration) {
    const name = declaration?.name?.getText();
    return methods.has(name) && packageName(declaration.getSourceFile().fileName) === 'footprintjs'
      ? name
      : undefined;
  }

  // Inspect bindings before requesting a call signature. Resolving every ordinary
  // application call forces unrelated function bodies through the type checker.
  function engineReference(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (ts.isConditionalExpression(node)) {
      return engineReference(node.whenTrue, next) || engineReference(node.whenFalse, next);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'bind'
    )
      return engineReference(node.expression.expression, next);
    const declaration = declarationOf(node);
    if (engineMethod(declaration)) return true;
    if (
      declaration &&
      (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration))
    ) {
      return engineReference(declaration.initializer, next);
    }
    return false;
  }

  // .bind and conditional local aliases keep their alternatives; no resolver is called.
  function choices(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return undefined;
    const next = new Set(seen).add(node);
    if (ts.isConditionalExpression(node)) {
      const yes = choices(node.whenTrue, next),
        no = choices(node.whenFalse, next);
      if (!yes && !no) return undefined;
      return {
        methods: [...new Set([...(yes?.methods ?? []), ...(no?.methods ?? [])])].sort(),
        engine: Boolean(yes?.engine && no?.engine),
        partiallyBound: Boolean(yes?.partiallyBound || no?.partiallyBound),
        context: [
          `method selected by (${expression(node.condition)})`,
          ...(yes?.context ?? []),
          ...(no?.context ?? []),
        ],
      };
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'bind'
    ) {
      const target = choices(node.expression.expression, next);
      if (!target) return undefined;
      const partial = node.arguments.length > 1 || node.arguments.some(ts.isSpreadElement);
      return {
        ...target,
        partiallyBound: Boolean(target.partiallyBound || partial),
        context: [
          ...target.context,
          ...(partial ? ['partially bound or spread arguments; values not inferred'] : []),
        ],
      };
    }
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return choices(declaration.initializer, next);
      }
    }
    const names = checker
      .getTypeAtLocation(node)
      .getCallSignatures()
      .map((signature) => engineMethod(signature.declaration))
      .filter(Boolean);
    return names.length
      ? { methods: [...new Set(names)].sort(), engine: true, context: [] }
      : undefined;
  }

  function owner(node) {
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

  function context(node) {
    const rows = [];
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
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

  for (const filename of [...parsed.fileNames].sort()) {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    if (!relative.startsWith('src/') || relative.endsWith('.d.ts')) continue;
    const source = program.getSourceFile(filename);
    const errors = program.getSyntacticDiagnostics(source);
    if (errors.length)
      throw new Error(
        `${relative}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')}`,
      );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && engineReference(node.expression)) ||
          (ts.isCallExpression(node.expression) && engineReference(node.expression)) ||
          (ts.isPropertyAccessExpression(node.expression) &&
            methods.has(node.expression.name.text)))
      ) {
        // A symbol already bound to engine declarations needs no argument inference.
        // Other callable signatures still use the compiler's call resolution.
        const reference = declarationOf(node.expression);
        const direct = engineMethod(reference);
        const signatures = direct
          ? checker.getTypeAtLocation(node.expression).getCallSignatures()
          : [];
        const resolved =
          signatures.length > 0 &&
          signatures.every((signature) => engineMethod(signature.declaration) === direct);
        const declaration = resolved ? reference : checker.getResolvedSignature(node)?.declaration;
        const proven = engineMethod(declaration);
        const alias =
          ts.isIdentifier(node.expression) || ts.isCallExpression(node.expression)
            ? choices(node.expression)
            : undefined;
        const spelling = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : undefined;
        const implementedElsewhere =
          declaration && 'body' in declaration && declaration.body && !proven;
        const recognized = alias?.methods.length
          ? alias.methods
          : proven
          ? [proven]
          : spelling &&
            methods.has(spelling) &&
            !implementedElsewhere &&
            (!declaration || packageName(declaration.getSourceFile().fileName) !== 'footprintjs')
          ? [spelling]
          : [];
        if (recognized.length) {
          const method = recognized[0];
          const partial = alias?.partiallyBound;
          const unknown = `[expression] bound argument layout ${expression(node.expression)}`;
          const point = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name
            : node.expression;
          const position = point.getStart(source);
          const row = {
            file: relative,
            line: source.getLineAndCharacterOfPosition(position).line + 1,
            offset: position,
            owner: owner(node),
            method: recognized.join(' | '),
            id: partial
              ? unknown
              : value(node.arguments[method.endsWith('Branch') || mounts.has(method) ? 0 : 2]),
            context: [...context(node), ...(alias?.context ?? [])],
            certainty: (alias ? alias.engine : Boolean(proven)) ? 'engine' : 'unresolved',
          };
          if (mounts.has(method)) {
            result.mounts.push({
              ...row,
              target: partial ? unknown : expression(node.arguments[1]),
              mountName: partial ? unknown : value(node.arguments[2]),
            });
          } else {
            const branch = method.endsWith('Branch');
            result.stages.push({
              ...row,
              name: partial ? unknown : value(node.arguments[branch ? 1 : 0]),
              description: partial
                ? { state: 'expression', text: unknown }
                : method === 'flowChart'
                ? chartDescription(node.arguments[3])
                : description(node.arguments[3]),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const order = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.offset - b.offset);
  result.mounts.sort(order);
  result.stages.sort(order);
  return result;
}
