'use client';

import { useEffect, useState } from 'react';
import { AGENT_BRIEF } from '@/lib/agent-brief';

/** Copies a short description of the library for a reader's coding agent. Without a clipboard, it links to the docs written for agents. */
export function ShareWithAgent() {
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setReady(Boolean(navigator.clipboard)), []);
  if (!ready) {
    return (
      <a className="v2-button v2-button-quiet" href="/llms.txt">
        Docs for your agent <span aria-hidden="true">→</span>
      </a>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_BRIEF);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      /* blocked by the browser: fall back to the link */
      setReady(false);
    }
  };
  return (
    <button type="button" className="v2-button v2-button-quiet" onClick={() => void copy()}>
      <span aria-live="polite">
        {copied ? 'Copied. Paste it to your agent' : 'Share with your agent'}
      </span>
    </button>
  );
}
