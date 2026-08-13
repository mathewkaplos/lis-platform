import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken } from '@/auth/access-token';

/**
 * FEAT-067 (ADR-0055, docs/plans/feat-067-wsi-viewer.md). The first
 * genuinely client-browser-facing proxy this codebase has needed -- every
 * other `apps/web` → `apps/api` call runs server-side (a Server Component
 * or Server Action). A deep-zoom viewer's own hundreds of sequential tile
 * fetches can't practically go through a Server Action (one Next.js server
 * round trip per tile), so this Route Handler is the real browser-facing
 * endpoint instead: same-origin to the browser (the existing session
 * cookie is sent automatically, no CORS or new public env var needed), it
 * resolves a real bearer token server-side, calls `apps/api`'s own tile
 * route with it, and relays the resulting `302`'s `Location` straight back
 * -- no tile bytes ever pass through `apps/web` either (`redirect:
 * 'manual'` so `fetch` itself never follows it, keeping this handler from
 * accidentally downloading the bytes to relay them).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'path query parameter is required' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Your session has expired' }, { status: 401 });
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const apiUrl = new URL(`${baseUrl}/v1/whole-slide-images/${id}/tiles`);
  apiUrl.searchParams.set('path', path);

  const apiRes = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'manual',
  });

  if (apiRes.status !== 302) {
    return NextResponse.json(
      { error: 'Tile not found' },
      { status: apiRes.status === 404 ? 404 : 502 },
    );
  }
  const location = apiRes.headers.get('location');
  if (!location) {
    return NextResponse.json({ error: 'No redirect target' }, { status: 502 });
  }
  return NextResponse.redirect(location);
}
