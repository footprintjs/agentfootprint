import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

it('the documented Agent facade holds only declarations and direct wiring', () => {
  const path = join(root, 'src/core/Agent.ts');
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const facade = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'Agent',
  );
  expect(facade).toBeDefined();
  for (const member of facade!.members) {
    expect(
      ts.canHaveModifiers(member) &&
        ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword),
    ).not.toBe(true);
    if (ts.isPropertyDeclaration(member)) {
      expect(member.initializer, member.name.getText(source)).toBeUndefined();
      continue;
    }
    expect(ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)).toBe(true);
    if (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) continue;
    if (ts.isConstructorDeclaration(member)) {
      const statements = member.body!.statements;
      expect(statements).toHaveLength(4);
      expect(statements[0]!.getText(source)).toBe('super();');
      expect(statements[1]!.getText(source)).toBe(
        'const readSessions = () => this.toolSessionTier;',
      );
      expect(ts.isVariableStatement(statements[2]!)).toBe(true);
      const initialize = statements[3]!;
      expect(ts.isExpressionStatement(initialize)).toBe(true);
      const call = (initialize as ts.ExpressionStatement).expression as ts.CallExpression;
      expect(call.expression.getText(source)).toBe('initializeAgentRuntime');
      expect(call.arguments[0]!.kind).toBe(ts.SyntaxKind.ThisKeyword);
      continue;
    }
    expect(member.body?.statements, member.name?.getText(source)).toHaveLength(1);
    const statement = member.body!.statements[0]!;
    const expression =
      ts.isReturnStatement(statement) || ts.isExpressionStatement(statement)
        ? statement.expression
        : undefined;
    expect(expression).toBeDefined();
    expect(ts.isCallExpression(expression!) || ts.isNewExpression(expression!)).toBe(true);
    if (
      ts.isMethodDeclaration(member) &&
      !ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
    ) {
      const call = expression as ts.CallExpression;
      if (member.name.getText(source) === 'getLastNarrativeEntries') {
        // This pre-existing public reader can be borrowed by another native runner.
        expect(call.expression.getText(source)).toBe('narrativeEntries');
        expect(call.arguments[0]!.getText(source)).toBe('this.runExecution()');
        continue;
      }
      // Private wiring must not reserve a virtual application instance name.
      expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
      const context = (call.expression as ts.PropertyAccessExpression).expression;
      expect(ts.isCallExpression(context)).toBe(true);
      const lookup = context as ts.CallExpression;
      expect(ts.isIdentifier(lookup.expression)).toBe(true);
      expect(lookup.arguments).toHaveLength(1);
      expect(lookup.arguments[0]!.kind).toBe(ts.SyntaxKind.ThisKeyword);
    }
  }
});

it('runtime owners do not import the facade or builder back', () => {
  const runtime = join(root, 'src/core/agent/runtime');
  const forbidden = new Set([
    join(root, 'src/core/Agent'),
    join(root, 'src/core/agent/AgentBuilder'),
  ]);
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory()
        ? walk(path)
        : path.endsWith('.ts') && !path.endsWith('.test.ts')
        ? [path]
        : [];
    });
  }
  for (const path of walk(runtime)) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) &&
        node.text.startsWith('.') &&
        (ts.isImportDeclaration(node.parent) ||
          ts.isImportTypeNode(node.parent.parent) ||
          (ts.isCallExpression(node.parent) &&
            node.parent.expression.kind === ts.SyntaxKind.ImportKeyword))
      ) {
        const target = resolve(dirname(path), node.text).replace(/\.(?:[cm]?js|tsx?)$/, '');
        expect(forbidden.has(target), `${path} imports ${node.text}`).toBe(false);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

it('keeps the documented public hierarchy and protected API comments', () => {
  const path = join(root, 'src/core/Agent.ts');
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const facade = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'Agent',
  )!;
  expect(facade.heritageClauses?.map((clause) => clause.getText(source))).toEqual([
    'extends RunnerBase<AgentInput, AgentOutput, AgentRunValues>',
  ]);
  const comments = {
    getGroupTranslator:
      "/**\n   * The FlowChart compiled for the most recent run (or a freshly-built\n   * one if no run has happened yet). Feeds ExplainableShell's `spec`\n   * prop. Returning the cached chart matters: the spec must match what\n   * `getLastSnapshot()` traced, otherwise the Trace view's stage tree\n   * desyncs from the snapshot's runtime tree.\n   */",
    buildUIGroupMetadata:
      "/** Agent has no nested-runner members (tools are function executors,\n   *  not Runner instances). Slot ids + tool names live in `extra` so\n   *  Lens can render an Agent card with slot rows + a tool list without\n   *  inspecting `buildTimeStructure`.\n   *\n   *  Memories are NOT included as members — they're an internal\n   *  mechanism, not a composition-level concept. Consumers who need\n   *  memory visibility should listen for `agentfootprint.memory.*`\n   *  events at runtime. */",
  };
  for (const [name, expected] of Object.entries(comments)) {
    const member = facade.members.find((member) => member.name?.getText(source) === name);
    expect(member, name).toBeDefined();
    const docs = member && ts.getJSDocCommentsAndTags(member).map((doc) => doc.getText(source));
    expect(docs, name).toContain(expected);
  }
});
