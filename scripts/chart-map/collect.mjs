import path from 'node:path';
import ts from 'typescript';

import { METHODS, NOT_A_DECLARATION, sourceOrder } from './methods.mjs';
import { createBindings } from './bindings.mjs';
import { createSourceValues } from './sourceValues.mjs';
import { unwrap, expression, owner, context } from './syntax.mjs';
const methods = new Set(Object.keys(METHODS));
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
  const { packageName, declarationOf, engineMethod, choices } = createBindings(checker);
  const { value, description, chartDescription } = createSourceValues(declarationOf);
  const result = { mounts: [], stages: [] };
  const unclassified = [];

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
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const proven = engineMethod(declaration);
        const declaredName = declaration?.name?.getText();
        const declaredFile = declaration?.getSourceFile().fileName.replaceAll('\\', '/');
        if (
          declaredName &&
          declaredFile?.includes('/lib/builder/') &&
          packageName(declaration.getSourceFile().fileName) === 'footprintjs' &&
          !methods.has(declaredName) &&
          !NOT_A_DECLARATION.has(declaredName)
        ) {
          unclassified.push(
            relative +
              ':' +
              (source.getLineAndCharacterOfPosition(node.getStart()).line + 1) +
              ' ' +
              declaredName,
          );
        }
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
            (!declaration?.parameters ||
              declaration.parameters.some((p) => p.dotDotDotToken) ||
              declaration.parameters.length >
                (typeof METHODS[spelling].id === 'number'
                  ? METHODS[spelling].id
                  : METHODS[spelling].id.at)) &&
            !implementedElsewhere &&
            (!declaration || packageName(declaration.getSourceFile().fileName) !== 'footprintjs')
          ? [spelling]
          : [];
        if (recognized.length) {
          const method = recognized[0];
          const partial = alias?.partiallyBound;
          const spec = METHODS[method];
          const slot = (layout) => {
            if (layout === undefined) return { node: undefined };
            const index = typeof layout === 'number' ? layout : layout.at;
            if (partial || node.arguments.slice(0, index + 1).some(ts.isSpreadElement))
              return { unknown: '[expression] spread or bound arguments' };
            const argument = node.arguments[index];
            if (typeof layout === 'number') return { node: argument };
            if (layout.list)
              return { unknown: '[expression] child declarations in ' + expression(argument) };
            if (!argument) return { node: undefined };
            const object = unwrap(argument);
            if (!ts.isObjectLiteralExpression(object))
              return { unknown: '[expression] ' + expression(argument) + '.' + layout.property };
            for (const property of [...object.properties].reverse()) {
              if (
                ts.isSpreadAssignment(property) ||
                (property.name && ts.isComputedPropertyName(property.name))
              )
                return { unknown: '[expression] ' + expression(argument) };
              if (property.name?.getText().replace(/^['"]|['"]$/g, '') === layout.property) {
                return ts.isPropertyAssignment(property)
                  ? { node: property.initializer }
                  : { unknown: '[expression] ' + expression(property) };
              }
            }
            return { node: undefined };
          };
          const slotValue = (layout) => {
            const read = slot(layout);
            return read.unknown ?? value(read.node);
          };
          const slotExpression = (layout) => {
            const read = slot(layout);
            return read.unknown ?? expression(read.node);
          };
          const slotDescription = (layout) => {
            if (layout && typeof layout === 'object' && layout.property === 'description') {
              const index = layout.at;
              if (!partial && !node.arguments.slice(0, index + 1).some(ts.isSpreadElement))
                return chartDescription(node.arguments[index]);
            }
            const read = slot(layout);
            return read.unknown
              ? { state: 'expression', text: read.unknown }
              : description(read.node);
          };
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
            id: slotValue(spec.id),
            context: [...context(node), ...(alias?.context ?? [])],
            certainty: (alias ? alias.engine : Boolean(proven)) ? 'engine' : 'unresolved',
          };
          if (spec.kind === 'mount') {
            result.mounts.push({
              ...row,
              target: slotExpression(spec.target),
              mountName: slotValue(spec.mountName),
              description: slotDescription(spec.description),
            });
          } else {
            result.stages.push({
              ...row,
              name: slotValue(spec.name),
              description: slotDescription(spec.description),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (unclassified.length)
    throw new Error(
      'Engine builder calls require an explicit declaration/non-declaration classification:\n' +
        unclassified.join('\n'),
    );
  result.mounts.sort(sourceOrder);
  result.stages.sort(sourceOrder);
  return result;
}
