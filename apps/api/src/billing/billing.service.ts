import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  generateInvoiceNumber,
  invoice,
  invoiceLineItem,
  orderedTest,
  referringFacility,
  testDefinition,
} from '@lis/db';
import type { Invoice, InvoicePayerType } from '@lis/domain';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

export interface GenerateInvoiceInput {
  tenantId: string;
  orderId: string;
  patientId: string;
  // FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md).
  // Defaults preserve today's exact behavior (cash, no referring facility)
  // when omitted -- no existing caller of this method breaks.
  payerType?: InvoicePayerType;
  referringFacilityId?: string;
}

interface InvoiceableLine {
  priceCents: number | null;
}

/** Issue #711 (approved proposal §10 Q1): plain-text summary only, no PDF
 * -- reused verbatim from the already-rendered invoice DTO, same content
 * the "Receipt" screen already shows on-screen (line items, total,
 * status). Pure, unit-testable in isolation from any DB/SMTP round trip. A
 * plain cents-to-major-unit division (not `Intl.NumberFormat`, which lives
 * only in `apps/web`'s `format-currency.ts` today) -- good enough for a
 * plain-text email body, not a currency-formatting subsystem this route
 * needs of its own. */
export function buildInvoiceEmailBody(invoiceDto: Invoice): string {
  const lines = invoiceDto.lineItems.map(
    (item) =>
      `  ${item.billingCode ?? '—'}  x${item.quantity}  ${(item.amountCents / 100).toFixed(2)}`,
  );
  return [
    `Invoice ${invoiceDto.invoiceNumber ?? invoiceDto.id}`,
    `Status: ${invoiceDto.status}`,
    '',
    'Line items:',
    ...lines,
    '',
    `Total: ${(invoiceDto.totalCents / 100).toFixed(2)}`,
    `Balance due: ${(invoiceDto.balanceDueCents / 100).toFixed(2)}`,
  ].join('\n');
}

/** Pure, unit-testable in isolation from the DB round trip -- see
 * billing.service.spec.ts. Throws (not returns an error value) to match
 * this repo's existing controller-facing exception convention. */
export function validateAndTotal(lines: readonly InvoiceableLine[]): number {
  if (lines.length === 0) {
    throw new BadRequestException('Order has no ordered tests to invoice');
  }
  const missingPrice = lines.filter((line) => line.priceCents === null);
  if (missingPrice.length > 0) {
    throw new BadRequestException(
      `Cannot generate invoice: ${missingPrice.length} ordered test(s) have no price configured in the catalog`,
    );
  }
  return lines.reduce((sum, line) => sum + (line.priceCents ?? 0), 0);
}

/**
 * FEAT-046 (ADR-0041): generates an invoice from an order's ordered tests,
 * snapshotting each line's billing code/price at generation time --
 * `engineering/database-design`'s established snapshot-write discipline. A
 * later catalog price change never alters an already-generated invoice.
 *
 * Plain class, not `@Injectable()` -- constructed directly in
 * `billing.module.ts`, same reasoning `InferenceGatewayService`'s own
 * header comment already establishes (stays importable by a plain unit
 * spec without a DB singleton import).
 */
export class BillingService {
  async generateInvoice(tx: Tx, input: GenerateInvoiceInput) {
    // Pilot-readiness audit fix (P0): one order has at most one invoice --
    // the whole billing UI (order detail's own single invoice slot, facility
    // statements, the invoice list) already assumes this 1:1 shape even
    // though nothing enforced it. Idempotent by design rather than
    // rejecting outright: a user re-clicking "Generate invoice" (the exact,
    // reproduced audit repro -- two rapid clicks before the first request's
    // response lands) should land on the *same* invoice, not see an error
    // for doing the same thing twice. `ux_invoice_tenant_order` (migration
    // 0066) is the real, race-safe backstop for genuinely concurrent
    // requests; this check just avoids a wasted round trip and gives a
    // clean "already exists" path for the sequential case this bug was
    // actually reported as.
    const [existingInvoice] = await tx
      .select()
      .from(invoice)
      .where(
        and(
          eq(invoice.tenantId, input.tenantId),
          eq(invoice.orderId, input.orderId),
        ),
      )
      .limit(1);
    if (existingInvoice) {
      const existingLineItems = await tx
        .select()
        .from(invoiceLineItem)
        .where(eq(invoiceLineItem.invoiceId, existingInvoice.id));
      return {
        invoice: existingInvoice,
        lineItems: existingLineItems,
        alreadyExisted: true as const,
      };
    }

    const payerType = input.payerType ?? 'cash';
    if (payerType === 'corporate' && input.referringFacilityId === undefined) {
      throw new BadRequestException(
        "referringFacilityId is required when payerType is 'corporate'",
      );
    }
    if (input.referringFacilityId !== undefined) {
      const [visibleFacility] = await tx
        .select({ id: referringFacility.id })
        .from(referringFacility)
        .where(eq(referringFacility.id, input.referringFacilityId))
        .limit(1);
      if (!visibleFacility) {
        throw new BadRequestException(
          `Unknown referring facility id: ${input.referringFacilityId}`,
        );
      }
    }

    const lines = await tx
      .select({
        testDefinitionId: testDefinition.id,
        billingCode: testDefinition.billingCode,
        priceCents: testDefinition.priceCents,
      })
      .from(orderedTest)
      .innerJoin(
        testDefinition,
        eq(orderedTest.testDefinitionId, testDefinition.id),
      )
      .where(eq(orderedTest.orderId, input.orderId));

    // A test with no priceCents set cannot be invoiced -- rejected rather
    // than silently billed at $0 (approved proposal §5).
    const totalCents = validateAndTotal(lines);
    // Issue #715: same global-sequence-plus-date-prefix shape as
    // generateAccessionNumber() -- see that function's own header comment.
    const invoiceNumber = await generateInvoiceNumber(tx);

    const [invoiceRow] = await tx
      .insert(invoice)
      .values({
        tenantId: input.tenantId,
        orderId: input.orderId,
        patientId: input.patientId,
        invoiceNumber,
        totalCents,
        payerType,
        referringFacilityId: input.referringFacilityId,
      })
      .returning();

    const lineItems = await tx
      .insert(invoiceLineItem)
      .values(
        lines.map((line) => ({
          tenantId: input.tenantId,
          invoiceId: invoiceRow.id,
          testDefinitionId: line.testDefinitionId,
          billingCode: line.billingCode,
          unitPriceCents: line.priceCents as number,
          quantity: 1,
          amountCents: line.priceCents as number,
        })),
      )
      .returning();

    return { invoice: invoiceRow, lineItems, alreadyExisted: false as const };
  }
}
