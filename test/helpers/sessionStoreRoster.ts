import ts from 'typescript';
import { productionSources } from './productionSources.js';

/** Exported store factories in both hosting trees, including nested owners. */
export function sessionStoreFactories(roots: readonly string[], portFile: string): Set<string> {
  const files = roots.flatMap(productionSources);
  const program = ts.createProgram([...files, portFile], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const port = program
    .getSourceFile(portFile)
    ?.statements.find(
      (node): node is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(node) && node.name.text === 'SessionLifecycle',
    );
  if (!port) throw new Error(`SessionLifecycle declaration not found in ${portFile}`);
  const portType = checker.getTypeAtLocation(port);
  const factories = new Map<string, string>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Session-store source not found in program: ${file}`);
    for (const node of source.statements) {
      if (
        !ts.isFunctionDeclaration(node) ||
        !node.name ||
        !node.type ||
        !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      const returned = checker.getTypeFromTypeNode(node.type);
      // An unchecked annotation or a function that never returns is no store.
      if (returned.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) continue;
      if (checker.isTypeAssignableTo(returned, portType)) {
        const owner = factories.get(node.name.text);
        if (owner !== undefined && owner !== file) {
          throw new Error(
            `Multiple session-store factories named ${node.name.text}: ${owner}, ${file}`,
          );
        }
        factories.set(node.name.text, file);
      }
    }
  }
  return new Set(factories.keys());
}

/** Names come from the actual harness factory references, never source comments. */
export function assertEnrolledSessionStores(
  factories: ReadonlySet<string>,
  enrolled: readonly string[],
): void {
  if (factories.size === 0) throw new Error('The session-store factory scan found nothing.');
  const missing = [...factories].filter((name) => !enrolled.includes(name));
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} ships and is not enrolled in the battery`);
  }
}
