import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
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
          attrs: { property: 'og:description', content: 'Build AI agents that show their work. Every decision traced, every tool call documented. 6 concepts, one interface.' },
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
          attrs: { name: 'twitter:description', content: 'Build AI agents that show their work. 6 patterns, $0 test runs, grounding analysis.' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://footprintjs.github.io/agentfootprint/og.png' },
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Key Concepts', slug: 'getting-started/key-concepts' },
            { label: 'Why explainability matters', slug: 'getting-started/debug' },
            { label: 'vs. LangGraph / LangChain / CrewAI', slug: 'getting-started/vs' },
            { label: 'Why agentfootprint?', slug: 'getting-started/why' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Agent pattern', slug: 'guides/agent' },
            { label: 'Tool use', slug: 'guides/tools' },
            { label: 'Instructions & decisions', slug: 'guides/instructions' },
            { label: 'RAG pattern', slug: 'guides/rag' },
            { label: 'Multi-agent (Swarm)', slug: 'guides/swarm' },
            { label: 'Pausable (human-in-the-loop)', slug: 'guides/pausable' },
            { label: 'Streaming', slug: 'guides/streaming' },
            { label: 'Observability', slug: 'guides/observability' },
            { label: 'Grounding analysis', slug: 'guides/grounding' },
            { label: 'Error handling', slug: 'guides/error-handling' },
            { label: 'Testing', slug: 'guides/testing' },
            { label: 'Security & tool gating', slug: 'guides/security' },
            { label: 'Deployment', slug: 'guides/deployment' },
            { label: 'Resilience', slug: 'guides/resilience' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Agent / LLMCall', slug: 'api/agent' },
            { label: 'FlowChart / Swarm / Parallel', slug: 'api/flowchart-swarm' },
            { label: 'Providers', slug: 'api/providers' },
            { label: 'Tools', slug: 'api/tools' },
            { label: 'Instructions', slug: 'api/instructions' },
            { label: 'Recorders', slug: 'api/recorders' },
            { label: 'Streaming', slug: 'api/streaming' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'Anthropic (Claude)', slug: 'integrations/anthropic' },
            { label: 'OpenAI', slug: 'integrations/openai' },
            { label: 'AWS Bedrock', slug: 'integrations/aws-bedrock' },
            { label: 'Bedrock AgentCore', slug: 'integrations/agentcore' },
            { label: 'Ollama (Local)', slug: 'integrations/ollama' },
            { label: 'Memory Stores', slug: 'integrations/memory-stores' },
            { label: 'Custom Provider', slug: 'integrations/custom-provider' },
          ],
        },
        {
          label: 'Resources',
          items: [
            {
              label: 'Live Playground',
              link: 'https://footprintjs.github.io/agent-playground/',
              attrs: { target: '_blank', rel: 'noopener' },
            },
            {
              label: 'footprintjs (core library)',
              link: 'https://footprintjs.github.io/footPrint/',
              attrs: { target: '_blank', rel: 'noopener' },
            },
          ],
        },
      ],
    }),
  ],
});
