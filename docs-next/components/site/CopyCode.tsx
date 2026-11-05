'use client';

import { useEffect, useState } from 'react';

/** Copies a sample, for a reader or their coding agent. It only appears once it can work. */
export function CopyCode({ code }: { code: string }) {
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setReady(Boolean(navigator.clipboard)), []);
  if (!ready) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* blocked by the browser: the code on the page can still be selected */
    }
  };
  return (
    <button
      type="button"
      className="rp-copy"
      onClick={() => void copy()}
      aria-label="Copy this code"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
