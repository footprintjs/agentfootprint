/**
 * The named refusal against the BUILT package — ESM (`dist/esm`) and CJS
 * (`dist`) — through the doors a consumer imports: the agent from the main
 * door, the adapter, the error class and the binding reader from
 * `agentfootprint/providers`, the skill from `agentfootprint/context`.
 *
 * The documented way to recognise the refusal is `instanceof
 * ContextChangedError` with the class from `agentfootprint/providers`; its
 * `code` (`'CONTEXT_CHANGED_IN_TURN'`) is the format-proof spelling. Both must
 * hold for an error the built agent throws, which proves the class the core
 * throws is the one the door hands out (one defining module, re-exported).
 *
 * Skips when `dist` is not built, so a bare `vitest` does not false-fail —
 * except under CI, which builds before it tests: there a missing build fails.
 * Locally it tests whatever `dist` holds — rebuild after changing `src/`.
 *
 * Test type: packaging / integration.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scriptedClient, type Body } from './harness.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORMATS = [
  { format: 'esm', root: resolve(repoRoot, 'dist/esm') },
  { format: 'cjs', root: resolve(repoRoot, 'dist') },
] as const;
const DOORS = { main: 'index.js', providers: 'doors/providers.js', context: 'doors/context.js' };
const built = FORMATS.every(({ root }) =>
  Object.values(DOORS).every((file) => existsSync(resolve(root, file))),
);
const requireCjs = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Door = Record<string, any>;

async function load(
  format: 'esm' | 'cjs',
  root: string,
): Promise<Record<keyof typeof DOORS, Door>> {
  const entries = await Promise.all(
    Object.entries(DOORS).map(async ([name, file]) => {
      const path = resolve(root, file);
      const mod = (
        format === 'esm' ? await import(pathToFileURL(path).href) : requireCjs(path)
      ) as Door;
      return [name, mod] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<keyof typeof DOORS, Door>;
}

it('the build is present under CI (the built-package check never skips there)', () => {
  if (process.env.CI) expect(built, 'dist is not built: run `npm run build` first').toBe(true);
});

for (const { format, root } of FORMATS) {
  describe.skipIf(!built)(`the refusal from the built ${format} package`, () => {
    it('is an instance of the providers door class, with its code, and names the change', async () => {
      const { main, providers, context } = await load(format, root);
      const bodies: Body[] = [];
      const provider = providers.anthropic({
        _client: scriptedClient('claude-haiku-5-5', bodies, [
          { tool: 'read_skill', input: { id: 'smb-triage' } },
          { text: 'done' },
        ]),
      });
      const shareReport = main.defineTool({
        name: 'share_report',
        description: 'Report on one SMB share.',
        inputSchema: { type: 'object', properties: { share: { type: 'string' } } },
        execute: async () => 'report',
      });
      const agent = main.Agent.create({ provider, model: 'claude-haiku-5-5', maxIterations: 4 })
        .system('You diagnose file-share problems.')
        .skill(
          context.defineSkill({
            id: 'smb-triage',
            description: 'Diagnose slow SMB shares.',
            body: 'Check the share report first.',
            tools: [shareReport],
            autoActivate: 'currentSkill',
          }),
        )
        .thinking({ budget: 1500 })
        .build();
      const error = await agent.run({ message: 'Why slow?' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(providers.ContextChangedError);
      expect((error as { code?: string }).code).toBe('CONTEXT_CHANGED_IN_TURN');
      expect((error as Error).message).toMatch(/tool 'share_report' was added/);
      expect(bodies).toHaveLength(1);
      expect(providers.thinkingBindingOf(provider, 'claude-haiku-5-5').binding).toBe('bound');
    });
  });
}
