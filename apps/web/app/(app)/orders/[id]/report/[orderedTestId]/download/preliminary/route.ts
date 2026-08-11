import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/auth/access-token';

/**
 * FEAT-054 (ADR-0047). Same shape as the sibling `download/route.ts`
 * (TASK-060) -- a direct authenticated `fetch` to `apps/api`'s new
 * `POST /v1/ordered-tests/:id/report/preliminary`, reached via a plain
 * `<a href>` full-navigation link from the viewer page for the same reason
 * (a raw PDF response, not JSON).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; orderedTestId: string }> },
) {
  const { orderedTestId } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { message: 'Your session has expired — please log in again.' },
      { status: 401 },
    );
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const apiResponse = await fetch(
    `${baseUrl}/v1/ordered-tests/${orderedTestId}/report/preliminary`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!apiResponse.ok) {
    // Mirrors apps/api's own ProblemDetails body back to the browser as-is
    // -- the viewer page gates this link on at least one recorded result,
    // so reaching this branch means the state changed between page load
    // and click (or a direct URL hit), the same real-if-rare case the
    // final route's own identical comment already names.
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
        `attachment; filename="report-preliminary-${orderedTestId}.pdf"`,
    },
  });
}
