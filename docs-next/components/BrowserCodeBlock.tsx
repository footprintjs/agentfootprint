'use client';

import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock.core';
import { browserShikiFactory } from '../lib/browser-highlighter';

export function BrowserCodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <DynamicCodeBlock
      lang={lang}
      code={code}
      highlighter={() => browserShikiFactory.getOrInit()}
      options={{ themes: { light: 'github-light', dark: 'github-dark' } }}
    />
  );
}
