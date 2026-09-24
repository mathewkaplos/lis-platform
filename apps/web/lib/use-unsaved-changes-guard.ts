'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * docs/plans/task-unsaved-form-guard.md. Refreshing, closing the tab, or
 * leaving by URL mid-form previously discarded everything typed with no
 * warning (confirmed live 2026-08-27, docs/pilot/PILOT-USER-GUIDE.md's own
 * edge-case table). While `isDirty` is true, this shows the browser's own
 * native "Leave site?" prompt instead.
 *
 * Deliberately a warning, not a `sessionStorage` draft save: these forms hold
 * patient identifiers, and persisting them in browser storage on shared lab
 * workstations is a privacy decision, not a defensive fix (proposal §4).
 *
 * Does not cover in-app `<Link>`/sidebar navigation -- the App Router has no
 * supported route-change blocking API (disclosed gap, proposal §4).
 *
 * Returns `bypass()`, for a caller's own intentional reload (e.g. the
 * patient form's duplicate-match "Cancel", which calls `location.reload()`)
 * -- a ref, not state, so it takes effect synchronously before that reload.
 */
export function useUnsavedChangesGuard(isDirty: boolean): () => void {
  const bypassed = useRef(false);

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (bypassed.current) return;
      event.preventDefault();
      // Legacy requirement for the prompt to show in older Chromium/Safari.
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  return useCallback(() => {
    bypassed.current = true;
  }, []);
}
