import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CancelOrderButton } from './cancel-order-button';
import { GenerateInvoiceButton } from './generate-invoice-button';

/**
 * TASK-044 (FEAT-012 proposal §1/§5). Overview only -- no Specimens/
 * Timeline/Results/Billing/Documents tabs (FEAT-013/014+, not started), no
 * accession number (TASK-045, not started). "Cancel order" is the one
 * deliberate addition beyond the screen's own literal AC -- see the
 * proposal §5 for why. FEAT-066 (ADR-0053) later added a requesting-doctor
 * line once that column existed; the referring-facility id is not resolved
 * to a display name here (no order-response join for it, matching this
 * screen's own "don't build ahead of a named requirement" discipline).
 *
 * A cross-tenant or nonexistent id surfaces the API's real 404 via
 * `notFound()`, matching `patients/[id]/page.tsx`'s own convention
 * (`engineering/api-design` entry #7).
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    // Issue #758: a thrown Error's message is redacted by Next.js in a real production
    // build (see `frontend-design` Skill entry #12) -- return inline instead.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Your session has expired — please log in again.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  const [
    { data: order, response: orderResponse },
    { data: catalog, response: catalogResponse },
    { data: invoices, response: invoicesResponse },
  ] = await Promise.all([
    client.GET('/v1/orders/{id}', { params: { path: { id } } }),
    client.GET('/v1/catalog'),
    // Pilot-readiness audit fix (P0, duplicate-invoice bug): a user landing
    // back on this page after already generating an invoice (back button,
    // a second tab, re-navigating from the patient/cases screen) saw the
    // exact same "Generate invoice" button as before, with nothing telling
    // them one already existed -- confirmed live, that's what actually let
    // a second real click create a second invoice. `manage_billing`-gated
    // like every other invoice route, so a role without it (reception) gets
    // a 403 here -- handled below by simply not rendering either the link
    // or the button, rather than crashing this whole page for a role that
    // was never going to be able to generate one anyway.
    client.GET('/v1/invoices', { params: { query: { orderId: id } } }),
  ]);
  if (orderResponse.status === 404) {
    notFound();
  }
  if (!orderResponse.ok || !order) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading this order. Please try again.
        </p>
      </div>
    );
  }
  if (!catalogResponse.ok || !catalog) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading the test catalog. Please try again.
        </p>
      </div>
    );
  }
  const existingInvoice =
    invoicesResponse.ok && invoices ? (invoices.items[0] ?? null) : null;

  const testNameById = new Map(catalog.tests.map((t) => [t.id, t.displayName]));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>
              {order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : 'Order'}
            </CardTitle>
            {order.patient ? (
              <p className="mt-1 text-sm text-text-secondary">
                MRN <span className="font-mono text-foreground">{order.patient.mrn}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <Badge variant={order.priority === 'stat' ? 'destructive' : 'outline'}>
                {order.priority}
              </Badge>
              <Badge variant={order.status === 'cancelled' ? 'secondary' : 'outline'}>
                {order.status}
              </Badge>
            </div>
            {order.orderedTests.some((t) => t.status === 'ordered') ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/reception?orderId=${order.id}`}>Receive at reception</Link>
              </Button>
            ) : null}
            {/* TASK-052 (FEAT-014 revision §2): visible once anything has been
                received -- mirrors "Receive at reception"'s own conditional
                shape, using 'received'/'in_process' as the entry-eligible
                statuses observation.controller.ts's own guard requires. */}
            {order.orderedTests.some((t) => t.status === 'received' || t.status === 'in_process') ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/orders/${order.id}/results`}>Enter results</Link>
              </Button>
            ) : null}
            {order.status === 'ordered' ? <CancelOrderButton orderId={order.id} /> : null}
            {/* Issue #633: same gate as GenerateInvoiceButton below -- a
                cancelled order accessioning a new case is a genuine
                nonsense state, matching every other gate on this row being
                about order lifecycle, not test content. */}
            {order.status !== 'cancelled' ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/cases/new?orderId=${order.id}`}>New AP case</Link>
              </Button>
            ) : null}
            {order.status !== 'cancelled' && existingInvoice ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/billing/invoices/${existingInvoice.id}`}>
                  View invoice {existingInvoice.invoiceNumber ?? ''}
                </Link>
              </Button>
            ) : null}
            {order.status !== 'cancelled' && !existingInvoice ? (
              <GenerateInvoiceButton
                orderId={order.id}
                referringFacilityId={order.referringFacilityId}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Ordered at {new Date(order.createdAt).toLocaleString()}
          </p>
          {order.orderingProviderName ? (
            <p className="text-sm text-text-secondary">
              Requesting doctor: <span className="text-foreground">{order.orderingProviderName}</span>
            </p>
          ) : null}
          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">Tests</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {order.orderedTests.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4">
                  <span className="text-foreground">
                    {testNameById.get(t.testDefinitionId) ?? t.testDefinitionId}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* TASK-060 (FEAT-016 revision §1 finding #5): visible
                        once this panel has reached 'resulted' -- mirrors
                        "Enter results"'s own identical conditional shape.
                        'resulted' does not itself guarantee every analyte is
                        verified (TASK-056); the report page shows the real
                        PRELIMINARY/FINAL state once reached. */}
                    {t.status === 'resulted' ? (
                      <Link
                        href={`/orders/${order.id}/report/${t.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        View report
                      </Link>
                    ) : null}
                    <Badge variant="outline">{t.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
