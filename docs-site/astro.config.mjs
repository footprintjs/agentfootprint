import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
  },
  site: 'https://footprintjs.github.io',
  base: '/agentfootprint',
  integrations: [
    starlight({
      title: 'agentfootprint',
      description: 'The explainable agent framework. Build AI agents that show their work.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/footprintjs/agentfootprint' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/agentfootprint' },
      ],
      components: {
        SiteTitle: './src/components/HeaderLinks.astro',
      },
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:title', content: 'agentfootprint — The Explainable Agent Framework' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:description', content: 'Build AI agents that show their work. Context engineering, visible. 2 primitives, 3 compositions, every named pattern is a recipe.' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://footprintjs.github.io/agentfootprint/og.png' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:title', content: 'agentfootprint — The Explainable Agent Framework' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:description', content: 'Build AI agents that show their work. 2 primitives + 3 compositions, $0 test runs, grounding analysis.' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://footprintjs.github.io/agentfootprint/og.png' },
        },
      ],
      sidebar: [
        {
          label: '📘 Get Started',
          items: [
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Key Concepts', slug: 'getting-started/key-concepts' },
            { label: 'Why agentfootprint?', slug: 'getting-started/why' },
            { label: 'vs LangChain / LangGraph / CrewAI', slug: 'getting-started/vs' },
            { label: 'Debugging', slug: 'getting-started/debug' },
          ],
        },
        {
          label: '🧠 The mental model',
          items: [
            { label: 'Manifesto — how agentfootprint thinks', slug: 'manifesto' },
          ],
        },
        {
          label: '🧬 Primitives & compositions',
          items: [
            { label: 'Agent (= ReAct)', slug: 'guides/agent' },
            { label: 'Dynamic ReAct', slug: 'guides/dynamic-react' },
            { label: 'Multi-agent (Swarm)', slug: 'guides/swarm' },
          ],
        },
        {
          label: '🎯 Context engineering',
          items: [
            { label: 'Instructions', slug: 'guides/instructions' },
            { label: 'Skills', slug: 'guides/skills' },
            { label: 'Skills, explained', slug: 'guides/skills-explained' },
            { label: 'Tools', slug: 'guides/tools' },
            { label: 'Flowchart as tool', slug: 'guides/flowchart-as-tool' },
            { label: 'Output schema', slug: 'guides/output-schema' },
            { label: 'Grounding', slug: 'guides/grounding' },
          ],
        },
        {
          label: '🧠 Memory',
          items: [
            { label: 'Memory overview', slug: 'guides/memory' },
            { label: 'Auto memory (Hybrid)', slug: 'guides/auto-memory' },
            { label: 'Fact extraction', slug: 'guides/fact-extraction' },
            { label: 'Narrative memory', slug: 'guides/narrative-memory' },
            { label: 'Semantic retrieval', slug: 'guides/semantic-retrieval' },
            { label: 'RAG', slug: 'guides/rag' },
            { label: 'Causal memory deep-dive', slug: 'causal-deep-dive' },
          ],
        },
        {
          label: '📊 Observability',
          items: [
            { label: 'Observability', slug: 'guides/observability' },
            { label: 'Context engineering recorder', slug: 'guides/context-engineering-recorder' },
            { label: 'Streaming', slug: 'guides/streaming' },
            { label: 'Locales (Message Catalog)', slug: 'guides/locales' },
          ],
        },
        {
          label: '🏭 Production',
          items: [
            { label: 'Deployment', slug: 'guides/deployment' },
            { label: 'Pause / Resume', slug: 'guides/pausable' },
            { label: 'Resilience', slug: 'guides/resilience' },
            { label: 'Error handling', slug: 'guides/error-handling' },
            { label: 'Security', slug: 'guides/security' },
            { label: 'Testing', slug: 'guides/testing' },
          ],
        },
        {
          label: '🔌 Providers',
          items: [
            { label: 'Anthropic (Claude)', slug: 'integrations/anthropic' },
            { label: 'OpenAI', slug: 'integrations/openai' },
            { label: 'AWS Bedrock', slug: 'integrations/aws-bedrock' },
            { label: 'Ollama (local)', slug: 'integrations/ollama' },
            { label: 'Custom provider', slug: 'integrations/custom-provider' },
          ],
        },
        {
          label: '🗄 Memory stores',
          items: [
            { label: 'Memory store adapters', slug: 'integrations/memory-stores' },
            { label: 'Bedrock AgentCore', slug: 'integrations/agentcore' },
          ],
        },
        {
          label: '📐 Architecture',
          items: [
            { label: 'Dependency graph (8-layer DAG)', slug: 'architecture/dependency-graph' },
          ],
        },
        {
          label: '💡 Inspiration',
          items: [
            { label: 'Why this design (overview)', slug: 'inspiration' },
            { label: 'Connected data — Palantir lineage', slug: 'inspiration/connected-data-palantir' },
            { label: 'Modularity — Liskov lineage', slug: 'inspiration/modularity-liskov' },
          ],
        },
        {
          label: '📚 Reference',
          items: [
            { label: 'Citations & papers', slug: 'research/citations' },
            { label: 'API reference (auto-generated)', slug: 'api/agent' },
          ],
        },
        {
          label: '🤝 Resources',
          items: [
            {
              label: 'Live Playground',
              link: 'https://footprintjs.github.io/agent-playground/',
              attrs: { target: '_blank', rel: 'noopener' },
            },
            {
              label: 'footprintjs (substrate)',
              link: 'https://footprintjs.github.io/footPrint/',
              attrs: { target: '_blank', rel: 'noopener' },
            },
            {
              label: 'GitHub repo',
              link: 'https://github.com/footprintjs/agentfootprint',
              attrs: { target: '_blank', rel: 'noopener' },
            },
          ],
        },
      ],
    }),
  ],
});
