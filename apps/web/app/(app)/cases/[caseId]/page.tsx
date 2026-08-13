import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { UploadWsiForm } from './upload-wsi-form';

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). The minimal case UI this
 * proposal's own §1 scoped: parts → blocks → slides tree, each slide's own
 * whole-slide-image state (upload form / view link / failed-with-retry) —
 * no synoptic-result display, no sign-out UI, no gross/microscopic image
 * gallery (none of those have a named requirement here).
 *
 * A cross-tenant or nonexistent id surfaces the API's real 404 via
 * `notFound()`, matching `patients/[id]/page.tsx`'s own convention
 * (`engineering/api-design` entry #7).
 *
 * The folder segment is named `[caseId]`, not the more common `[id]` --
 * Next.js requires every sibling route sharing this path depth under
 * `/cases/` to use the *same* dynamic-segment name, and the nested viewer
 * route (`/cases/[caseId]/slides/[slideId]/viewer`) already needs `caseId`
 * to stay distinct from its own `slideId`. Found for real, not assumed:
 * mismatched segment names (`[id]` here vs. `[caseId]` there) crashed the
 * dev server outright at boot with "You cannot use different slug names for
 * the same dynamic path ('caseId' !== 'id')" -- caught only by actually
 * starting the dev server, not by typecheck/lint/build.
 */
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId: id } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: caseData, response } = await client.GET('/v1/cases/{id}', {
    params: { path: { id } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !caseData) {
    throw new Error('Something went wrong loading this case. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <span className="font-mono">{caseData.accessionNumber}</span>
            <Badge variant="outline">{caseData.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {caseData.parts.length === 0 ? (
            <p className="text-sm text-text-secondary">No parts on this case yet.</p>
          ) : (
            caseData.parts.map((part) => (
              <div key={part.id} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                  Part <span className="font-mono">{part.accessionNumber}</span> —{' '}
                  {part.specimenType}
                </h3>
                {part.blocks.length === 0 ? (
                  <p className="pl-4 text-sm text-text-secondary">No blocks yet.</p>
                ) : (
                  <ul className="flex flex-col gap-4 pl-4">
                    {part.blocks.map((block) => (
                      <li key={block.id} className="flex flex-col gap-2">
                        <p className="text-sm font-medium text-foreground">
                          Block <span className="font-mono">{block.code}</span>
                        </p>
                        {block.slides.length === 0 ? (
                          <p className="pl-4 text-sm text-text-secondary">No slides yet.</p>
                        ) : (
                          <ul className="flex flex-col gap-3 pl-4">
                            {block.slides.map((slide) => (
                              <li
                                key={slide.id}
                                className="flex flex-col gap-2 rounded-md border border-border p-3"
                              >
                                <p className="text-sm text-foreground">
                                  Slide <span className="font-mono">{slide.code}</span>
                                </p>
                                {slide.wholeSlideImage?.status === 'ready' ? (
                                  <Link
                                    href={`/cases/${id}/slides/${slide.id}/viewer`}
                                    className="w-fit text-sm text-primary hover:underline"
                                  >
                                    View whole-slide image
                                  </Link>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    {slide.wholeSlideImage?.status === 'failed' ? (
                                      <p role="alert" className="text-sm text-danger">
                                        Previous upload failed — try again below.
                                      </p>
                                    ) : null}
                                    <UploadWsiForm slideId={slide.id} />
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
