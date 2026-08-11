import { BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { invoice, payment } from '@lis/db';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import type { PaymentProvider } from './payment-provider.interface';

type Tx = RequestWithTx['tx'];

export interface RecordPaymentInput {
  tenantId: string;
  invoiceId: string;
  method: 'cash' | 'mobile_money';
  amountCents: number;
  reference?: string;
}

/** Pure, unit-testable in isolation from the DB round trip -- see
 * payment.service.spec.ts. */
export function computeInvoiceStatus(
  paidCents: number,
  totalCents: number,
): 'unpaid' | 'partial' | 'paid' {
  if (paidCents <= 0) return 'unpaid';
  if (paidCents >= totalCents) return 'paid';
  return 'partial';
}

/**
 * FEAT-046 (ADR-0041): records one payment attempt against an invoice and
 * recomputes the invoice's status from the sum of succeeded payments --
 * inside the same transaction as the write (same race-safety discipline
 * `OrderCreationService`/`writeAuditEvent` already establish), never a
 * separate read-then-update.
 *
 * Plain class, not `@Injectable()` -- constructed directly in
 * `billing.module.ts` with its `PaymentProvider` passed explicitly, same
 * reasoning `InferenceGatewayService`'s own header comment already
 * establishes.
 */
export class PaymentService {
  constructor(private readonly provider: PaymentProvider) {}

  async recordPayment(tx: Tx, input: RecordPaymentInput) {
    const [invoiceRow] = await tx
      .select()
      .from(invoice)
      .where(eq(invoice.id, input.invoiceId))
      .limit(1);
    if (!invoiceRow) {
      throw new BadRequestException('Invoice not found');
    }
    if (invoiceRow.status === 'paid') {
      throw new BadRequestException('Invoice is already fully paid');
    }

    let status: 'pending' | 'succeeded' | 'failed';
    let providerReference: string | null = null;

    if (input.method === 'mobile_money') {
      const result = await this.provider.charge({
        invoiceId: input.invoiceId,
        amountCents: input.amountCents,
        method: 'mobile_money',
        reference: input.reference,
      });
      status = result.status;
      providerReference = result.providerReference;
    } else {
      // Cash: an immediate success, no external provider call -- the same
      // "status only, never a ledger" boundary ADR-0041 establishes for
      // every payment method, not just mobile money.
      status = 'succeeded';
    }

    const [paymentRow] = await tx
      .insert(payment)
      .values({
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        method: input.method,
        amountCents: input.amountCents,
        providerReference,
        status,
      })
      .returning();

    if (status === 'succeeded') {
      const paidResult = await tx.execute<{ total: string }>(
        sql`SELECT COALESCE(SUM(amount_cents), 0)::text AS total FROM payment WHERE invoice_id = ${input.invoiceId} AND status = 'succeeded'`,
      );
      const paidCents = Number(paidResult.rows[0]?.total ?? 0);
      const newStatus = computeInvoiceStatus(paidCents, invoiceRow.totalCents);
      await tx
        .update(invoice)
        .set({ status: newStatus })
        .where(eq(invoice.id, input.invoiceId));
    }

    return paymentRow;
  }
}
