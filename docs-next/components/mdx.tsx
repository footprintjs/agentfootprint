import defaultMdxComponents from 'fumadocs-ui/mdx';
import * as Twoslash from 'fumadocs-twoslash/ui';
import { CodeFile } from '@/components/CodeFile';
import { Aside, Card, CardGrid, Tabs, TabItem } from '@/components/starlight-shims';
import { Diagram } from '@/components/Diagram';
import { AgentFlowchart } from '@/components/AgentFlowchart';
import { ReplayEmbed } from '@/components/ReplayEmbed';
import { DynamicReactTryIt } from '@/components/DynamicReactTryIt';
import { SkillGraphTryIt } from '@/components/SkillGraphTryIt';
import { SubflowLensTryIt } from '@/components/SubflowLensTryIt';
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
    DynamicReactTryIt,
    SkillGraphTryIt,
    SubflowLensTryIt,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;
