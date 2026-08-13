'use client';

import { useEffect, useRef, useState } from 'react';
// Type-only import -- erased entirely at compile time, so it never
// triggers `openseadragon`'s own module evaluation. The *value* is loaded
// via a dynamic `import()` inside `useEffect` below instead (see that
// comment for why: this genuinely crashed SSR, not a hypothetical).
import type OpenSeadragonType from 'openseadragon';

interface DziInfo {
  width: number;
  height: number;
  tileSize: number;
  tileOverlap: number;
  format: string;
  tileFolderPath: string;
}

function tileProxyUrl(wsiId: string, path: string): string {
  return `/api/wsi-tiles/${wsiId}?path=${encodeURIComponent(path)}`;
}

/**
 * Parses the `.dzi` XML descriptor into the fields a custom OpenSeadragon
 * `TileSource` needs. `dziRelativePath`'s own `.dzi` extension replaced
 * with `_files` is the standard DZI convention for the sibling tile-pyramid
 * folder (`vips dzsave`/OpenSlide `deepzoom` output shape) -- confirmed
 * against this feature's own test fixture, not assumed from documentation
 * alone.
 */
async function fetchDziInfo(
  wsiId: string,
  dziRelativePath: string,
): Promise<DziInfo> {
  const res = await fetch(tileProxyUrl(wsiId, dziRelativePath));
  if (!res.ok) {
    throw new Error('Failed to load the .dzi descriptor');
  }
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const imageEl = doc.documentElement;
  const sizeEl = imageEl.getElementsByTagName('Size')[0];
  return {
    width: Number(sizeEl.getAttribute('Width')),
    height: Number(sizeEl.getAttribute('Height')),
    tileSize: Number(imageEl.getAttribute('TileSize')),
    tileOverlap: Number(imageEl.getAttribute('Overlap')),
    format: imageEl.getAttribute('Format') ?? 'jpeg',
    tileFolderPath: dziRelativePath.replace(/\.dzi$/i, '_files'),
  };
}

/**
 * FEAT-067 (ADR-0055, docs/plans/feat-067-wsi-viewer.md). A custom
 * `TileSource`/`getTileUrl` callback, not OpenSeadragon's default
 * "point it at a `.dzi` URL" convenience -- required because tile identity
 * here is a `?path=` query parameter through the `apps/web` proxy chain
 * (`/api/wsi-tiles/[id]/route.ts`), not a path OpenSeadragon's own default
 * relative-URL resolution assumes.
 */
export function WsiViewer({
  wsiId,
  dziRelativePath,
}: {
  wsiId: string;
  dziRelativePath: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let viewer: OpenSeadragonType.Viewer | undefined;
    let cancelled = false;

    // Dynamic `import()`, not a top-level `import` -- found for real, not
    // assumed: `openseadragon`'s own module touches `document` at
    // *evaluation* time (not just when the Viewer is constructed), which
    // crashes Next.js's server-side render of this Client Component with a
    // real `ReferenceError: document is not defined`, confirmed live
    // against `apps/web`'s own dev server log (a 500 on first navigation,
    // silently "recovered" by React's client-side re-render, so the crash
    // was invisible without checking the server log directly -- exactly the
    // class of SSR-boundary bug `frontend-design` Skill entry #4/#6 already
    // warn about, now with its own concrete instance). A dynamic import
    // inside `useEffect` only ever executes client-side, sidestepping this
    // entirely without needing `next/dynamic` (which can't take `ssr:
    // false` from inside a Server Component parent anyway).
    Promise.all([
      import('openseadragon').then((mod) => mod.default),
      fetchDziInfo(wsiId, dziRelativePath),
    ])
      .then(([OpenSeadragon, info]) => {
        if (cancelled || !containerRef.current) return;
        viewer = OpenSeadragon({
          element: containerRef.current,
          // No `prefixUrl` -- that option points at a folder of navigation-
          // button icon images OpenSeadragon otherwise expects to be
          // self-hosted (this repo has no such asset folder, and pulling
          // them from a CDN would be the first external-vendor runtime
          // dependency this codebase has taken on). Pan/zoom via mouse
          // wheel/drag/pinch works regardless of the button overlay, so
          // this v1 scope disables it entirely rather than fetching icons
          // from a new external host.
          showNavigationControl: false,
          tileSources: {
            width: info.width,
            height: info.height,
            tileSize: info.tileSize,
            tileOverlap: info.tileOverlap,
            getTileUrl: (level: number, x: number, y: number) =>
              tileProxyUrl(
                wsiId,
                `${info.tileFolderPath}/${level}/${x}_${y}.${info.format}`,
              ),
          },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load the slide');
        }
      });

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [wsiId, dziRelativePath]);

  if (error) {
    return (
      <p role="alert" className="p-6 text-sm text-danger">
        {error}
      </p>
    );
  }

  return <div ref={containerRef} className="h-[calc(100vh-8rem)] w-full bg-black" />;
}
