import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = '/agent-contract';
const rootFile = `${ROOT}/src/index.ts`;
const agentFile = `${ROOT}/src/core/Agent.ts`;
const facadeFile = `${ROOT}/src/core/agent/types.ts`;
const inputFile = `${ROOT}/src/core/agent/types/input.ts`;
const consumerFile = `${ROOT}/consumer.ts`;

function source(fileName: string, relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

const root = source(rootFile, '../../../index.ts');
const agent = source(agentFile, '../../Agent.ts');
const facade = source(facadeFile, '../types.ts');
const input = source(inputFile, './input.ts');

function exportedFrom(file: ts.SourceFile, name: string): string {
  const declaration = file.statements.find(
    (node): node is ts.ExportDeclaration =>
      ts.isExportDeclaration(node) &&
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some((element) => element.name.text === name),
  );
  if (!declaration) throw new Error(`No public export of ${name}`);
  const imported = file.statements.find(
    (node): node is ts.ImportDeclaration =>
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some((element) => element.name.text === name),
  );
  const moduleSpecifier = declaration.moduleSpecifier ?? imported?.moduleSpecifier;
  if (!moduleSpecifier) throw new Error(`No owner module for public export ${name}`);
  return `export type { ${name} } from ${moduleSpecifier.getText(file)};`;
}

function ownMember(file: ts.SourceFile, name: string, property: string): string {
  const declaration = file.statements.find(
    (node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) && node.name.text === name,
  );
  const member = declaration?.members.find(
    (node) => ts.isPropertySignature(node) && node.name.getText(file) === property,
  );
  if (!member) throw new Error(`${name}.${property} must remain its own declared property`);
  return member.getText(file);
}

interface Contract {
  readonly name: 'AgentOptions' | 'AgentInput';
  readonly property: 'model' | 'message';
  readonly owner: ts.SourceFile;
}

const contracts: readonly Contract[] = [
  { name: 'AgentOptions', property: 'model', owner: facade },
  { name: 'AgentInput', property: 'message', owner: input },
];

/**
 * Project the actual property and public re-export chain into a tiny program.
 * Other fields need the full library's types, covered by hosted compilation;
 * this checks the merging behavior without compiling unrelated source here.
 */
function program(contract: Contract, target: string, augmentation: string, inherited = false) {
  const { name, property, owner } = contract;
  const member = ownMember(owner, name, property);
  const declaration = inherited
    ? `interface Inherited { ${member} } export interface ${name} extends Inherited {}`
    : `export interface ${name} { ${member} }`;
  const files: Record<string, string> = {
    [rootFile]: exportedFrom(root, name),
    [agentFile]: exportedFrom(agent, name),
    [facadeFile]: name === 'AgentOptions' ? declaration : exportedFrom(facade, name),
    [inputFile]: name === 'AgentInput' ? declaration : 'export {};',
    [consumerFile]: `
      import type { ${name} as Public } from 'agentfootprint';
      import type { ${name} as Facade } from './src/core/agent/types.js';
      declare module '${target}' { interface ${name} { ${augmentation} } }
      type PublicShape = Public;
      type FacadeShape = Facade;
    `,
  };
  const options: ts.CompilerOptions = {
    noLib: true,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: ROOT,
    paths: { agentfootprint: ['./src/index.ts'] },
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => ROOT;
  host.fileExists = (fileName) => Object.hasOwn(files, fileName);
  host.readFile = (fileName) => files[fileName];
  host.directoryExists = (directory) => directory === ROOT || directory.startsWith(`${ROOT}/`);
  host.getDirectories = () => [];
  host.getSourceFile = (fileName, languageVersion) =>
    files[fileName] === undefined
      ? undefined
      : ts.createSourceFile(fileName, files[fileName], languageVersion, true);
  const compiled = ts.createProgram(Object.keys(files), options, host);
  const checker = compiled.getTypeChecker();
  const consumer = compiled.getSourceFile(consumerFile)!;
  const shapes = consumer.statements
    .filter(ts.isTypeAliasDeclaration)
    .map((node) => checker.getPropertiesOfType(checker.getTypeFromTypeNode(node.type)));
  return {
    diagnostics: [...compiled.getSyntacticDiagnostics(), ...compiled.getSemanticDiagnostics()].map(
      (diagnostic) => ({
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      }),
    ),
    shapes,
    checker,
    consumer,
  };
}

for (const contract of contracts) {
  describe(`${contract.name} augmentation through the existing public paths`, () => {
    for (const target of ['agentfootprint', './src/core/agent/types.js']) {
      it(`${target} accepts a new key through both imports`, () => {
        const result = program(contract, target, 'readonly extra?: boolean;');
        expect(result.diagnostics).toEqual([]);
        expect(result.shapes).toHaveLength(2);
        for (const shape of result.shapes) {
          const extra = shape.find((symbol) => symbol.name === 'extra');
          expect(extra).toBeDefined();
          expect(extra!.flags & ts.SymbolFlags.Optional).not.toBe(0);
          expect(shape.some((symbol) => symbol.name === contract.property)).toBe(true);
        }
      });

      it(`${target} accepts an identical property declaration`, () => {
        const result = program(contract, target, `readonly ${contract.property}: string;`);
        expect(result.diagnostics).toEqual([]);
        for (const shape of result.shapes) {
          const property = shape.find((symbol) => symbol.name === contract.property)!;
          const type = result.checker.getTypeOfSymbolAtLocation(property, result.consumer);
          expect(result.checker.typeToString(type)).toBe('string');
        }
      });

      it(`${target} refuses a narrowed duplicate property`, () => {
        const result = program(contract, target, `readonly ${contract.property}: 'narrow';`);
        expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2717]);
      });
    }
  });
}

describe('augmentation regression control', () => {
  it('demonstrates why inherited public properties are not an equivalent split', () => {
    const options = contracts[0];
    const result = program(options, 'agentfootprint', "readonly model: 'narrow';", true);
    expect(result.diagnostics).toEqual([]);
    for (const shape of result.shapes) {
      const model = shape.find((symbol) => symbol.name === 'model')!;
      const type = result.checker.getTypeOfSymbolAtLocation(model, result.consumer);
      expect(result.checker.typeToString(type)).toBe('"narrow"');
    }
  });
});
