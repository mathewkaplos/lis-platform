'use client';

import { Button } from '@lis/ui';

/** Issue #704: matches invoice-view.tsx's own `window.print()` button precedent. */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="print:hidden"
      onClick={() => window.print()}
    >
      Print
    </Button>
  );
}
