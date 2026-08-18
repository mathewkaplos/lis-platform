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

/** Sum of `succeeded` payments against one invoice -- the single source of
 * truth for "how much has actually been paid," shared by `recordPayment`'s
 * own overpayment guard and `billing.controller.ts`'s `amountPaidCents`/
 * `balanceDueCents` response fields (never two separately-maintained
 * computations of the same number). */
export async function getPaidCents(tx: Tx, invoiceId: string): Promise<number> {
  const result = await tx.execute<{ total: string }>(
    sql`SELECT COALESCE(SUM(amount_cents), 0)::text AS total FROM payment WHERE invoice_id = ${invoiceId} AND status = 'succeeded'`,
  );
  return Number(result.rows[0]?.total ?? 0);
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
    // `FOR UPDATE` locks this exact invoice row for the rest of the
    // transaction -- a second concurrent `recordPayment` call against the
    // same invoice blocks here until this transaction commits (or rolls
    // back), then re-reads the now-current paid total. This is the same
    // "serialize the read-then-write race" goal `writeAuditEvent`'s own
    // `pg_advisory_xact_lock` (ADR-0036) solves for the audit chain --
    // here a plain row lock is used instead, since (unlike the audit
    // chain's append-only inserts) there's already a real row being read
    // then updated in this same function; no separate advisory-lock key
    // needed. Confirmed live: two concurrent payment requests against the
    // same invoice, together exceeding its balance, no longer both
    // succeed -- see billing.e2e-spec.ts's own concurrency test.
    const [invoiceRow] = await tx
      .select()
      .from(invoice)
      .where(eq(invoice.id, input.invoiceId))
      .for('update')
      .limit(1);
    if (!invoiceRow) {
      throw new BadRequestException('Invoice not found');
    }
    if (invoiceRow.status === 'paid') {
      throw new BadRequestException('Invoice is already fully paid');
    }

    // The overpayment guard: computed from the real `payment` rows (never
    // from `invoice.status`, which only has three coarse buckets and can't
    // tell "partial with $10 left" from "partial with $200 left"), and
    // checked *before* calling the payment provider -- an invalid amount
    // must never reach a real charge attempt.
    const paidBeforeCents = await getPaidCents(tx, input.invoiceId);
    const remainingCents = invoiceRow.totalCents - paidBeforeCents;
    if (input.amountCents > remainingCents) {
      // Dollars, not cents -- every other amount on this cashier-facing
      // screen (invoice total, take-payment field, receipt) is already
      // shown in dollars; a cents-denominated error would be the one
      // inconsistent number on the page.
      const formatDollars = (cents: number) => (cents / 100).toFixed(2);
      throw new BadRequestException(
        `Payment amount ($${formatDollars(input.amountCents)}) exceeds the remaining balance ($${formatDollars(remainingCents)}) on this invoice`,
      );
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
      // No second SUM query needed -- `paidBeforeCents` is already known
      // correct under the row lock held since before this insert, so the
      // new total is just arithmetic, not a fresh read.
      const paidCents = paidBeforeCents + input.amountCents;
      const newStatus = computeInvoiceStatus(paidCents, invoiceRow.totalCents);
      await tx
        .update(invoice)
        .set({ status: newStatus })
        .where(eq(invoice.id, input.invoiceId));
    }

    return paymentRow;
  }
}
