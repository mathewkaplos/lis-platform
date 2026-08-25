import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { PrintButton } from './print-button';

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Issue #704 (EPIC #697). The design partner's own stated real-world
 * scenario: "this facility wants one invoice for all patients/tests
 * performed between date X and date Y." Confirmed via the pilot-readiness
 * audit that no path existed for this at all -- not just missing UI, no
 * screen of any kind.
 *
 * Deliberately a *view*, not a new billing primitive: `invoice` stays "one
 * invoice = one order" (ADR-0041's own "never a ledger/subledger" boundary,
 * `billing.ts`'s header comment) -- generating a single new DB row spanning
 * multiple orders would mean either a schema change (a nullable
 * `invoice.orderId` + a new join table) or re-deriving line items from
 * scratch, both real, separate decisions this issue's own scope doesn't
 * require. Instead: `GenerateInvoiceButton` (order detail page, this same
 * issue) already bills the order's own referring facility automatically
 * when one was set at booking time (`payerType: 'corporate'`); this screen
 * is the facility-scoped, date-ranged *view* across those already-generated
 * invoices -- a real, usable "one statement, all patients in range" printed
 * document, without inventing a second billing ledger underneath it.
 *
 * A plain GET form drives the filters (facility + date range), same
 * "no client JS, searchParams own the state" shape as `patients/page.tsx`.
 */
export default async function FacilityStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string; from?: string; to?: string }>;
}) {
  const { facilityId, from, to } = await searchParams;

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: facilities, response: facilitiesResponse } = await client.GET(
    '/v1/referring-facilities',
  );
  if (!facilitiesResponse.ok || !facilities) {
    throw new Error('Something went wrong loading referring facilities. Please try again.');
  }

  const hasFilter = Boolean(facilityId && from && to);
  const selectedFacility = facilities.find((f) => f.id === facilityId);

  const { data: invoiceData, response: invoiceResponse } = hasFilter
    ? await client.GET('/v1/invoices', {
        params: {
          query: {
            referringFacilityId: facilityId,
            // Date-only inputs (<input type="date">) -- widened to cover
            // the full end day, matching a real "statement covering these
            // calendar dates" expectation rather than midnight-to-midnight
            // UTC cutting off the last day's own invoices.
            createdFrom: new Date(`${from}T00:00:00.000Z`).toISOString(),
            createdTo: new Date(`${to}T23:59:59.999Z`).toISOString(),
          },
        },
      })
    : { data: undefined, response: undefined };
  if (hasFilter && invoiceResponse?.status === 403) {
    throw new Error('You do not have permission to view billing statements.');
  }
  if (hasFilter && (!invoiceResponse?.ok || !invoiceData)) {
    throw new Error('Something went wrong loading this statement. Please try again.');
  }

  const items = invoiceData?.items ?? [];
  const grandTotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  const grandBalanceDueCents = items.reduce((sum, item) => sum + item.balanceDueCents, 0);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 print:p-0">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold text-foreground">Facility statement</h1>
        <p className="mt-1 text-sm text-text-secondary">
          One consolidated statement covering every invoice billed to a referring facility over a
          date range.
        </p>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" action="/billing/facility-statement">
            <FormField id="facilityId" label="Referring facility" required>
              <select
                name="facilityId"
                required
                defaultValue={facilityId ?? ''}
                className="h-9 w-56 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="" disabled>
                  Select…
                </option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="from" label="From" required>
              <Input type="date" name="from" defaultValue={from} required />
            </FormField>
            <FormField id="to" label="To" required>
              <Input type="date" name="to" defaultValue={to} required />
            </FormField>
            <Button type="submit">Generate statement</Button>
          </form>
          {facilities.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              No referring facilities configured yet —{' '}
              <Link href="/admin/referring-facilities" className="underline">
                add one
              </Link>{' '}
              first.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {hasFilter ? (
        <Card className="print:shadow-none">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              Statement — {selectedFacility?.name ?? 'Unknown facility'}
              <span className="ml-2 font-normal text-text-secondary">
                {from} to {to}
              </span>
            </CardTitle>
            <PrintButton />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {items.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No invoices billed to this facility in this date range.
              </p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-secondary">
                      <th className="py-2 font-medium">Invoice #</th>
                      <th className="py-2 font-medium">Patient</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Total</th>
                      <th className="py-2 text-right font-medium">Balance due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-border/50">
                        <td className="py-2 font-mono text-foreground">
                          <Link
                            href={`/billing/invoices/${item.id}`}
                            className="text-primary hover:underline print:text-foreground print:no-underline"
                          >
                            {item.invoiceNumber ?? item.id}
                          </Link>
                        </td>
                        <td className="py-2 text-foreground">{item.patientName}</td>
                        <td className="py-2 text-foreground">{item.status}</td>
                        <td className="py-2 text-right text-foreground">
                          {formatDollars(item.totalCents)}
                        </td>
                        <td className="py-2 text-right text-foreground">
                          {formatDollars(item.balanceDueCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="pt-3 font-medium text-foreground">
                        Facility total ({items.length} {items.length === 1 ? 'patient' : 'patients'})
                      </td>
                      <td className="pt-3 text-right font-medium text-foreground">
                        {formatDollars(grandTotalCents)}
                      </td>
                      <td className="pt-3 text-right font-medium text-foreground">
                        {formatDollars(grandBalanceDueCents)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
