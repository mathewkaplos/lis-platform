import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { WsiViewer } from './wsi-viewer';

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). Nested under the case, not
 * a flat `/slides/[id]/viewer` (proposal §10 Q4): resolves "the ready WSI
 * for this slide" by re-fetching `GET /v1/cases/:caseId`'s already-
 * extended lineage rather than adding a new `GET /v1/whole-slide-images
 * ?slideId=` filter route for a single-row lookup. `frontend-design` entry
 * #9's own route-group-collision failure mode is about the *same*
 * dynamic-segment name reused across *different* top-level route groups --
 * `caseId`/`slideId` are distinctly named within one route group here, not
 * that shape, so nesting is safe.
 */
export default async function SlideViewerPage({
  params,
}: {
  params: Promise<{ caseId: string; slideId: string }>;
}) {
  const { caseId, slideId } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: caseData, response } = await client.GET('/v1/cases/{id}', {
    params: { path: { id: caseId } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !caseData) {
    throw new Error('Something went wrong loading this case. Please try again.');
  }

  const slide = caseData.parts
    .flatMap((part) => part.blocks)
    .flatMap((block) => block.slides)
    .find((s) => s.id === slideId);
  if (!slide || slide.wholeSlideImage?.status !== 'ready') {
    notFound();
  }

  const wsiRes = await client.GET('/v1/whole-slide-images/{id}', {
    params: { path: { id: slide.wholeSlideImage.id } },
  });
  if (!wsiRes.response.ok || !wsiRes.data?.dziObjectKey) {
    throw new Error('Something went wrong loading this whole-slide image. Please try again.');
  }
  const dziRelativePath = wsiRes.data.dziObjectKey.slice(
    wsiRes.data.tileObjectPrefix.length,
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <p className="text-sm text-foreground">
          Slide <span className="font-mono">{slide.code}</span>
        </p>
        <Link href={`/cases/${caseId}`} className="text-sm text-primary hover:underline">
          Back to case
        </Link>
      </div>
      <WsiViewer wsiId={slide.wholeSlideImage.id} dziRelativePath={dziRelativePath} />
    </div>
  );
}
