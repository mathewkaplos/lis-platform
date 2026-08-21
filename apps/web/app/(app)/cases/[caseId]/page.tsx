import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { hasSpecimenManagementRole, hasVerifierRole } from '@/auth/roles';
import { createLisApiClient } from '@/lib/api-client';
import { AddBlockForm } from './add-block-form';
import { AddOrderedTestForm } from './add-ordered-test-form';
import { AddSlideForm } from './add-slide-form';
import { AmendCaseForm } from './amend-case-form';
import { AMENDABLE_STATUSES, NOT_YET_SIGNED_STATUSES, SCREENABLE_STATUSES } from '../case-status';
import { NarrativeForm } from './narrative-form';
import { ReturnToScreeningForm } from './return-to-screening-form';
import { ScreenCaseForm } from './screen-case-form';
import { SignOutCaseForm } from './sign-out-case-form';
import { UploadWsiForm } from './upload-wsi-form';

// issue #624: SCREENABLE_STATUSES drives a different card with a different
// role gate than NOT_YET_SIGNED_STATUSES, not because the sets differ in
// membership. Deliberately not narrowed to cytology specimen types
// (proposal §5): `requiresTwoTierReview`'s logic lives in apps/api, not an
// importable shared package, so a histology case's Screen attempt just
// 400s with the API's own "does not require screening" message instead of
// duplicating that business rule here.

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
  const [accessToken, session] = await Promise.all([getValidAccessToken(), getSession()]);
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [
    { data: caseData, response },
    { data: catalog, response: catalogResponse },
    { data: synopticProtocols },
    { data: synopticResponses },
  ] = await Promise.all([
    client.GET('/v1/cases/{id}', { params: { path: { id } } }),
    client.GET('/v1/catalog'),
    client.GET('/v1/synoptic-protocols'),
    client.GET('/v1/cases/{id}/synoptic-responses', { params: { path: { id } } }),
  ]);
  if (response.status === 404) {
    notFound();
  }
  if (response.status === 403) {
    throw new Error('You do not have permission to view this case.');
  }
  if (!response.ok || !caseData) {
    throw new Error('Something went wrong loading this case. Please try again.');
  }
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
  }

  // issue #642 (proposal §10 Q3): eligibility is an exact specimenType match
  // against a protocol's own specimenType -- not schema-enforced unique, so
  // more than one match is theoretically possible; take the first (list
  // order), not worth a picker UI for a case no real seeded protocol data
  // can produce today.
  const synopticProtocolBySpecimenType = new Map(
    (synopticProtocols?.protocols ?? []).map((protocol) => [protocol.specimenType, protocol]),
  );

  // Issue #659: responses aren't part-scoped in the write path today (only
  // orderedTestId + synopticProtocolVersionId) — matched here by protocol
  // identity, same "one eligible protocol per specimenType" assumption
  // `synopticProtocolBySpecimenType` above already makes. If two parts ever
  // share the same eligible protocol, both would show the same recorded
  // response until issue #674 (part-scoping) lands.
  const synopticResponseByProtocolId = new Map(
    (synopticResponses?.responses ?? []).map((r) => [r.synopticProtocolId, r]),
  );

  const isAmendable = AMENDABLE_STATUSES.has(caseData.status);
  const reportVersions = isAmendable
    ? await client
        .GET('/v1/cases/{id}/report-versions', { params: { path: { id } } })
        .then(({ data }) => data?.items ?? [])
    : [];

  // Issue #714 (EPIC #697): sign-out/amend already record real, structured
  // audit data (step-up method + timestamp) -- previously visible only by
  // reading a raw API response, never from a screen.
  const auditTrail = await client
    .GET('/v1/cases/{id}/audit-trail', { params: { path: { id } } })
    .then(({ data }) => data?.items ?? []);

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
            caseData.parts.map((part) => {
              const eligibleProtocol = synopticProtocolBySpecimenType.get(part.specimenType);
              const recordedResponse = eligibleProtocol
                ? synopticResponseByProtocolId.get(eligibleProtocol.id)
                : undefined;
              return (
              <div key={part.id} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                  Part <span className="font-mono">{part.accessionNumber}</span> —{' '}
                  {part.specimenType}
                </h3>
                {eligibleProtocol?.publishedVersionId && hasSpecimenManagementRole(session) ? (
                  <Link
                    href={`/cases/${id}/synoptic/${part.id}`}
                    className="w-fit text-sm text-primary hover:underline"
                  >
                    {recordedResponse ? 'Record synoptic protocol again' : 'Record synoptic protocol'} (
                    {eligibleProtocol.name})
                  </Link>
                ) : null}
                {recordedResponse ? (
                  <div className="rounded-md border border-border p-3">
                    <p className="text-xs font-medium text-text-secondary">
                      Recorded {new Date(recordedResponse.recordedAt).toLocaleString()}
                    </p>
                    <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                      {recordedResponse.results.map((result) => (
                        <FragmentResultRow key={result.elementKey} result={result} />
                      ))}
                    </dl>
                  </div>
                ) : null}
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
                                    {/* Issue #665: matches every sibling
                                        manage_specimens control on this page
                                        (Add block/slide/test, Narrative) --
                                        the backend already enforces this
                                        correctly, this closes the one
                                        control that didn't hide itself. */}
                                    {hasSpecimenManagementRole(session) ? (
                                      <UploadWsiForm slideId={slide.id} />
                                    ) : null}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {hasSpecimenManagementRole(session) ? (
                          <div className="flex flex-col gap-2 pl-4">
                            <AddSlideForm caseId={id} blockId={block.id} />
                            <AddOrderedTestForm
                              caseId={id}
                              blockId={block.id}
                              tests={catalog.tests}
                            />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {hasSpecimenManagementRole(session) ? (
                  <AddBlockForm caseId={id} specimenId={part.id} />
                ) : null}
              </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {hasSpecimenManagementRole(session) ? (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Narrative</CardTitle>
          </CardHeader>
          <CardContent>
            <NarrativeForm caseId={id} narrative={caseData.narrative} />
          </CardContent>
        </Card>
      ) : null}

      {SCREENABLE_STATUSES.has(caseData.status) && hasSpecimenManagementRole(session) ? (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Screen</CardTitle>
          </CardHeader>
          <CardContent>
            <ScreenCaseForm caseId={id} />
          </CardContent>
        </Card>
      ) : null}

      {caseData.status === 'pending_review' && hasVerifierRole(session) ? (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Return to screening</CardTitle>
          </CardHeader>
          <CardContent>
            <ReturnToScreeningForm caseId={id} />
          </CardContent>
        </Card>
      ) : null}

      {NOT_YET_SIGNED_STATUSES.has(caseData.status) && hasVerifierRole(session) ? (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Sign out</CardTitle>
          </CardHeader>
          <CardContent>
            <SignOutCaseForm caseId={id} />
          </CardContent>
        </Card>
      ) : null}

      {isAmendable ? (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Report versions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {reportVersions.length === 0 ? (
              <p className="text-sm text-text-secondary">No report versions found.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {reportVersions.map((version) => (
                  <li
                    key={version.id}
                    className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        Version {version.versionNumber}
                      </span>
                      <Badge variant={version.status === 'final' ? 'default' : 'outline'}>
                        {version.status}
                      </Badge>
                    </div>
                    <p className="text-text-secondary">
                      Signed by {version.signedByRole} on{' '}
                      {new Date(version.signedAt).toLocaleString()}
                    </p>
                    {version.reason ? (
                      <p className="text-text-secondary">Reason: {version.reason}</p>
                    ) : null}
                    {/* Plain <a>, not next/link -- forces a full navigation so the
                        Route Handler's own Content-Disposition response actually
                        triggers a browser "Save As" (frontend-design entry #5,
                        same precedent orders/[id]/report/[orderedTestId]/page.tsx
                        already established). */}
                    <a
                      href={`/cases/${id}/report-versions/${version.id}/download`}
                      className="w-fit text-sm text-primary hover:underline"
                    >
                      Download PDF
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {hasVerifierRole(session) ? <AmendCaseForm caseId={id} /> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          {auditTrail.length === 0 ? (
            <p className="text-sm text-text-secondary">No audited actions on this case yet.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {auditTrail.map((event) => (
                <li key={event.id} className="border-b border-border pb-3 last:border-0">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-foreground">{event.action}</span>
                    <span className="text-text-secondary">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-text-secondary">
                    By <span className="font-mono">{event.actorRole}</span>
                    {event.stepUp ? (
                      <>
                        {' '}
                        — re-authenticated via {event.stepUp.method} (
                        {new Date(event.stepUp.authTime * 1000).toLocaleString()})
                      </>
                    ) : null}
                  </p>
                  {event.reason ? (
                    <p className="mt-1 text-text-secondary">Reason: {event.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Issue #659: read-only formatting for an already-recorded synoptic element
// result — reused as-is regardless of dataType, matching the `results`
// entries' own already-labeled shape (no need to re-fetch or re-join
// `synoptic_element` here; `elementLabel`/`value` are already a point-in-time
// copy from when the response was recorded).
function FragmentResultRow({
  result,
}: {
  result: { elementKey: string; elementLabel: string; value: string | number | string[] };
}) {
  const formattedValue = Array.isArray(result.value)
    ? result.value.join(', ')
    : String(result.value);
  return (
    <>
      <dt className="text-text-secondary">{result.elementLabel}</dt>
      <dd className="font-medium text-foreground">{formattedValue}</dd>
    </>
  );
}
