'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// TASK-041 (FEAT-011): the profile header's "copyable mono chips" for MRN /
// national ID (Stitch §4.3). A small client island -- `navigator.clipboard`
// is client-only -- kept separate from the (Server Component) page.
export function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={`Copy ${label}: ${value}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {value}
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5 text-text-secondary" aria-hidden="true" />
      )}
    </button>
  );
}
