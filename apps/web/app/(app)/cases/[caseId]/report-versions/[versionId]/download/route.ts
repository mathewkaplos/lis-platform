import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/auth/access-token';

/**
 * Issue #648. Mirrors
 * apps/web/app/(app)/orders/[id]/report/[orderedTestId]/download/route.ts
 * exactly, except the server-side call is a `GET`, matching the backend
 * route's own shape (`GET /v1/cases/:id/report-versions/:versionId/pdf` --
 * a pure read of already-signed content, not a write-and-audit action like
 * the ordered-test report). Reached from the case detail page via a plain
 * `<a href>` full-navigation link, not `next/link` (`frontend-design` Skill
 * entry #5: client-side nav leaves a prior route's RSC payload behind in
 * the DOM).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; versionId: string }> },
) {
  const { caseId, versionId } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { message: 'Your session has expired — please log in again.' },
      { status: 401 },
    );
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const apiResponse = await fetch(
    `${baseUrl}/v1/cases/${caseId}/report-versions/${versionId}/pdf`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!apiResponse.ok) {
    const body = await apiResponse.text();
    return new NextResponse(body, {
      status: apiResponse.status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }

  const pdf = await apiResponse.arrayBuffer();
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        apiResponse.headers.get('Content-Disposition') ??
        `attachment; filename="case-report-${caseId}-${versionId}.pdf"`,
    },
  });
}
