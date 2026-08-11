import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { invoice, invoiceLineItem, orderedTest, testDefinition } from '@lis/db';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

export interface GenerateInvoiceInput {
  tenantId: string;
  orderId: string;
  patientId: string;
}

interface InvoiceableLine {
  priceCents: number | null;
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

    const [invoiceRow] = await tx
      .insert(invoice)
      .values({
        tenantId: input.tenantId,
        orderId: input.orderId,
        patientId: input.patientId,
        totalCents,
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

    return { invoice: invoiceRow, lineItems };
  }
}
