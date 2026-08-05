import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { PrintButton } from './print-button';

/**
 * TASK-046 (FEAT-013 revision). Reached only via the "Print label" link on
 * the reception success card (`reception/reception-form.tsx`) -- a link
 * already known to be valid, so a nonexistent/cross-tenant id is a real
 * 404, matching `orders/[id]/page.tsx`'s own convention (not the
 * friendly-retry shape `reception/page.tsx` uses for its own hand-entry
 * lookup).
 *
 * Both barcode SVGs are rendered server-side by `bwip-js` (revision §5) and
 * come back as raw SVG markup strings -- `dangerouslySetInnerHTML` is safe
 * here because the only input `bwip-js` ever encodes is this specimen's own
 * accession number (server-generated, TASK-045's `YYMMDD-NNNNNN` format),
 * never user-supplied text.
 *
 * No patient name, MRN, order id, or test name appears anywhere on this
 * page (revision §5/§10 Q3, KB-24's PHI-minimization default) -- only the
 * accession number, specimen type, and received/accessioned timestamp.
 *
 * The label card below forces a light (white/black) background
 * unconditionally, ignoring the app's own dark-mode toggle -- a real
 * finding from this task's own dark-mode verification: `bwip-js` always
 * renders black bars/modules (`label-render.ts` never passes a color
 * option), so against this repo's dark `bg-surface` card background the
 * barcode was nearly invisible on screen. This is also the *correct*
 * design independent of that bug: a physical label is printed on white
 * stock with black ink regardless of the viewer's app theme, so the
 * preview should always show what will actually print, not follow dark
 * mode.
 */
export default async function SpecimenLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: label, response } = await client.GET('/v1/specimens/{id}/label', {
    params: { path: { id } },
  });
  if (!response.ok || !label) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <PrintButton specimenId={id} />
      <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-white p-6 text-center text-black print:border-0 print:p-0">
        <p className="font-mono text-lg font-semibold">{label.accessionNumber}</p>
        <p className="text-sm text-neutral-600">{label.specimenType}</p>
        {label.receivedAt ? (
          <p className="text-xs text-neutral-600">
            {new Date(label.receivedAt).toLocaleString()}
          </p>
        ) : null}
        <div
          className="w-full [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: label.code128Svg }}
        />
        <div
          className="h-24 w-24 [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: label.dataMatrixSvg }}
        />
      </div>
    </div>
  );
}
