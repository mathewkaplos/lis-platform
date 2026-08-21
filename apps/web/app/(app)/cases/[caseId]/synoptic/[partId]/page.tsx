import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { hasSpecimenManagementRole } from '@/auth/roles';
import { createLisApiClient } from '@/lib/api-client';
import { ProtocolForm } from './protocol-form';

/**
 * Issue #642 (docs/plans/task-642-synoptic-protocol-recording.md). A
 * dedicated page, not a case-detail-page card (proposal §1) -- a real CAP/
 * ICCR protocol runs 20-40+ elements, unlike issue #636's 3-textarea
 * Narrative card. `orderedTestId` resolves through the case's own order
 * (proposal §5.2: `orderedTests[0].id`, the order's own original test, not a
 * later reflex/add-on) -- there is no dedicated "AP exam" catalog entry to
 * anchor against instead. Eligibility (which protocol applies to this part)
 * is re-derived here rather than passed from the case detail page's own link
 * -- this page must be safe to reach directly by URL, not only via that link.
 */
export default async function SynopticProtocolPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; partId: string }>;
  searchParams: Promise<{ protocolId?: string; organProtocolId?: string }>;
}) {
  const { caseId, partId } = await params;
  const { protocolId: requestedProtocolId, organProtocolId: requestedOrganProtocolId } = await searchParams;
  const [accessToken, session] = await Promise.all([getValidAccessToken(), getSession()]);
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  if (!hasSpecimenManagementRole(session)) {
    throw new Error('You do not have permission to record a synoptic protocol on this case.');
  }
  const client = createLisApiClient(accessToken);

  const { data: caseData, response: caseResponse } = await client.GET('/v1/cases/{id}', {
    params: { path: { id: caseId } },
  });
  if (caseResponse.status === 404) {
    notFound();
  }
  if (caseResponse.status === 403) {
    throw new Error('You do not have permission to view this case.');
  }
  if (!caseResponse.ok || !caseData) {
    throw new Error('Something went wrong loading this case. Please try again.');
  }

  const part = caseData.parts.find((p) => p.id === partId);
  if (!part) {
    notFound();
  }

  const [{ data: protocolList }, { data: order, response: orderResponse }] = await Promise.all([
    client.GET('/v1/synoptic-protocols'),
    client.GET('/v1/orders/{id}', { params: { path: { id: caseData.orderId } } }),
  ]);
  if (!orderResponse.ok || !order) {
    throw new Error('Something went wrong loading this case’s order. Please try again.');
  }

  // Issue #690: a panel (isPanel: true) is never the primary thing shown
  // here -- only reachable via an organ protocol's own "Linked panels"
  // list below (#668) -- so it's excluded from organ-slot eligibility
  // entirely. This also fixes a real, already-live bug: the breast
  // biomarker panel shares specimenType 'breast' with the organ protocol,
  // and a plain .find() (this page's own prior implementation) would
  // silently pick whichever one a query happened to return first.
  const eligibleOrganProtocols = (protocolList?.protocols ?? []).filter(
    (p) => p.specimenType === part.specimenType && !p.isPanel,
  );

  if (eligibleOrganProtocols.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Record synoptic protocol</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">
              No published synoptic protocol is available for specimen type &quot;
              {part.specimenType}&quot;.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Issue #690: more than one non-panel protocol shares this specimenType
  // (e.g. ICCR vs. CAP colon/rectum, both intentionally coexisting per
  // explicit product decision) -- a real chooser, not a silent pick.
  // `organProtocolId` is distinct from `protocolId` below (which keeps its
  // own existing #668 meaning: "which linked panel of the resolved organ
  // protocol") so the two selection axes never collide.
  let protocol = eligibleOrganProtocols[0];
  if (eligibleOrganProtocols.length > 1) {
    let chosen = eligibleOrganProtocols.find((p) => p.id === requestedOrganProtocolId);
    if (!chosen) {
      // Issue #692: an org-wide default reporting standard, checked only
      // once no explicit organProtocolId resolved the choice already --
      // if set and exactly one eligible protocol matches it, that's the
      // same as if the caller had picked it themselves. Falls through to
      // the picker below when no preference is set, or the preferred
      // standard has no eligible protocol for this specimenType.
      const { data: orgSettings } = await client.GET('/v1/org-settings');
      if (orgSettings?.preferredSynopticSourceStandard) {
        const preferredMatches = eligibleOrganProtocols.filter(
          (p) => p.sourceStandard === orgSettings.preferredSynopticSourceStandard,
        );
        if (preferredMatches.length === 1) {
          chosen = preferredMatches[0];
        }
      }
    }
    if (!chosen) {
      return (
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Card className="mx-auto w-full max-w-3xl">
            <CardHeader>
              <CardTitle>Choose reporting standard</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-text-secondary">
                More than one synoptic protocol is available for specimen type &quot;
                {part.specimenType}&quot; -- choose which standard to record against.
              </p>
              <ul className="flex flex-col gap-2">
                {eligibleOrganProtocols.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      href={`/cases/${caseId}/synoptic/${partId}?organProtocolId=${candidate.id}`}
                      className="text-sm underline"
                    >
                      {candidate.name} ({candidate.sourceStandard})
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      );
    }
    protocol = chosen;
  }

  if (!protocol.publishedVersionId) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Record synoptic protocol</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">
              No published synoptic protocol is available for specimen type &quot;
              {part.specimenType}&quot;.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const orderedTestId = order.orderedTests[0]?.id;
  if (!orderedTestId) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Record synoptic protocol</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-sm text-danger">
              This case&apos;s order has no ordered test to attach synoptic responses to.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: organVersion, response: organVersionResponse } = await client.GET(
    '/v1/synoptic-protocols/{id}/versions/{versionId}',
    { params: { path: { id: protocol.id, versionId: protocol.publishedVersionId } } },
  );
  if (!organVersionResponse.ok || !organVersion) {
    throw new Error('Something went wrong loading this synoptic protocol. Please try again.');
  }

  // Issue #690: carries the chosen organ standard through every link on
  // this page (back link, panel links) only when disambiguation actually
  // happened -- every existing single-protocol specimenType keeps its
  // exact prior URL shape (no ?organProtocolId= at all).
  const organQuery = eligibleOrganProtocols.length > 1 ? `organProtocolId=${protocol.id}` : '';
  function withOrganQuery(query: string): string {
    return [organQuery, query].filter(Boolean).join('&');
  }

  // Issue #668: CAP's "linked document" shape -- ?protocolId= reaches a
  // linked biomarker/ancillary panel from the organ protocol's own
  // recording page, recorded as its own independent response. Validated
  // against the organ protocol's own linkedPanels for correct routing,
  // not as a security boundary (the recorder itself has never scoped by
  // specimenType eligibility, proposal §5).
  let activeProtocolId = protocol.id;
  let activeProtocolName = protocol.name;
  let activeSourceStandard = protocol.sourceStandard;
  let activeVersion = organVersion;
  if (requestedProtocolId) {
    const linkedPanel = organVersion.linkedPanels.find((p) => p.id === requestedProtocolId);
    if (linkedPanel?.publishedVersionId) {
      const { data: panelVersion, response: panelVersionResponse } = await client.GET(
        '/v1/synoptic-protocols/{id}/versions/{versionId}',
        { params: { path: { id: linkedPanel.id, versionId: linkedPanel.publishedVersionId } } },
      );
      if (panelVersionResponse.ok && panelVersion) {
        activeProtocolId = linkedPanel.id;
        activeProtocolName = linkedPanel.name;
        activeSourceStandard = linkedPanel.sourceStandard;
        activeVersion = panelVersion;
      }
    }
  }
  const viewingLinkedPanel = activeProtocolId !== protocol.id;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader>
          <CardTitle>
            {activeProtocolName} ({activeSourceStandard})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {viewingLinkedPanel ? (
            <Link
              href={`/cases/${caseId}/synoptic/${partId}${organQuery ? `?${organQuery}` : ''}`}
              className="text-sm text-text-secondary underline"
            >
              ← Back to {protocol.name}
            </Link>
          ) : null}
          <ProtocolForm
            caseId={caseId}
            orderedTestId={orderedTestId}
            specimenId={partId}
            synopticProtocolVersionId={activeVersion.id}
            elements={activeVersion.elements}
            sourceStandard={activeSourceStandard}
          />
          {!viewingLinkedPanel && organVersion.linkedPanels.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-sm font-medium text-foreground">Linked panels</span>
              <ul className="flex flex-col gap-1">
                {organVersion.linkedPanels.map((panel) => (
                  <li key={panel.id}>
                    {panel.publishedVersionId ? (
                      <Link
                        href={`/cases/${caseId}/synoptic/${partId}?${withOrganQuery(`protocolId=${panel.id}`)}`}
                        className="text-sm underline"
                      >
                        Record {panel.name} ({panel.sourceStandard})
                      </Link>
                    ) : (
                      <span className="text-sm text-text-secondary">
                        {panel.name} ({panel.sourceStandard}) — no published version
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
