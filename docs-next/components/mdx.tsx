import defaultMdxComponents from 'fumadocs-ui/mdx';
import * as Twoslash from 'fumadocs-twoslash/ui';
import { CodeFile } from '@/components/CodeFile';
import { Aside, Card, CardGrid, Tabs, TabItem } from '@/components/starlight-shims';
import { Diagram } from '@/components/Diagram';
import { AgentFlowchart } from '@/components/AgentFlowchart';
import { ReplayEmbed } from '@/components/ReplayEmbed';
import { DynamicReactRecording, DynamicReactSubflowsFigure } from '@/components/DynamicReactFigure';
import { SkillGraphFigure, QuickstartSkillGraphMermaid } from '@/components/SkillGraphFigure';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...Twoslash,
    // code-from-source (anti-drift) + Starlight component shims for ported pages
    CodeFile,
    Aside,
    Card,
    CardGrid,
    Tabs,
    TabItem,
    Diagram,
    AgentFlowchart,
    ReplayEmbed,
    DynamicReactRecording,
    DynamicReactSubflowsFigure,
    SkillGraphFigure,
    QuickstartSkillGraphMermaid,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;
