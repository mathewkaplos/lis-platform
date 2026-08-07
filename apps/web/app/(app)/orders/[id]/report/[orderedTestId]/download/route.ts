import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/auth/access-token';

/**
 * TASK-060 (FEAT-016 revision §1 finding #4). This repo's only real
 * consumer of `apps/api`'s new `POST /v1/ordered-tests/:id/report` --
 * called via a direct authenticated `fetch`, not `@lis/sdk`'s typed client,
 * since that route deliberately returns raw PDF bytes, not JSON (finding
 * #2). Reached from the browser via a plain `<a href>` full-navigation
 * link (the viewer page), so this `GET` Route Handler is what the browser
 * actually sees -- it translates that into a server-side `POST` to
 * `apps/api`, the same "the two layers are allowed to differ" reasoning
 * the plan doc states explicitly.
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
    `${baseUrl}/v1/ordered-tests/${orderedTestId}/report`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!apiResponse.ok) {
    // Mirrors apps/api's own ProblemDetails body back to the browser as-is
    // -- the viewer page already gates the "Download PDF" link on FINAL +
    // verifier, so reaching this branch means the state changed between
    // page load and click (or a direct URL hit) — a real, if rare, case,
    // not swallowed silently.
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
        `attachment; filename="report-${orderedTestId}.pdf"`,
    },
  });
}
