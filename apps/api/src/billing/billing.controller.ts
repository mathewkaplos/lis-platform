import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  generateInvoiceRequestSchema,
  invoiceSchema,
  paymentRequestSchema,
  type Invoice,
} from '@lis/domain';
import { invoice, invoiceLineItem, payment, order } from '@lis/db';
import { eq } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { BillingService } from './billing.service';
import { PaymentService } from './payment.service';

const orderIdParamSchema = z.object({ id: z.uuid() });
const invoiceIdParamSchema = z.object({ id: z.uuid() });
// Proper DTO classes, not a bare inline `{ id: string }` type annotation --
// `order.controller.ts`'s own `OrderIdParamDto` precedent. Confirmed live:
// an inline type annotation carries no class metadata for NestJS's OpenAPI
// generator to document, so the generated schema silently showed
// `path?: never` for every one of these routes' `:id` param -- found only
// by diffing the regenerated `openapi.json`/SDK against `order.controller
// .ts`'s own correctly-documented `:id/cancel` route, not by any
// typecheck/lint/test failure.
class OrderIdParamDto extends createZodDto(orderIdParamSchema) {}
class InvoiceIdParamDto extends createZodDto(invoiceIdParamSchema) {}
class PaymentRequestDto extends createZodDto(paymentRequestSchema) {}
class InvoiceDto extends createZodDto(invoiceSchema) {}
class GenerateInvoiceRequestDto extends createZodDto(
  generateInvoiceRequestSchema,
) {}

// `createdAt` converted to an ISO string, same as `toCareRelationshipDto`'s
// own precedent -- required for the audit `after` payload, not just API
// response tidiness: `stableStringify` (packages/db/src/audit.ts) treats a
// raw JS `Date` as a plain object with zero own enumerable keys (`{}`),
// silently discarding the actual timestamp at hash-compute time. The
// stored jsonb column then round-trips it as a real ISO string on read,
// so the write-time hash and a later recomputed hash disagree -- a real,
// reproducible audit-chain break, not a hypothetical (confirmed live,
// FEAT-046, via `verifyAuditChain` flagging exactly this row).
function toInvoiceLineItemDto(row: typeof invoiceLineItem.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
function toInvoiceDto(
  row: typeof invoice.$inferSelect,
  lineItems: (typeof invoiceLineItem.$inferSelect)[],
): Invoice {
  return {
    ...row,
    // `status` is a plain `text` column at the drizzle-schema level (a
    // CHECK constraint enforces the real value set at the DB layer, per
    // this repo's usual text-discriminator convention) -- narrowed here to
    // match the response schema's literal union, same as every other
    // text-discriminator response DTO in this codebase.
    status: row.status as Invoice['status'],
    payerType: row.payerType as Invoice['payerType'], // CHECK-constrained (ck_invoice_payer_type)
    createdAt: row.createdAt.toISOString(),
    lineItems: lineItems.map(toInvoiceLineItemDto),
  };
}
function toPaymentDto(row: typeof payment.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * FEAT-046 (ADR-0041). Action sub-resources throughout
 * (`standards/api-design.md`/`engineering/api-design`), matching
 * `order.controller.ts`'s own `:id/cancel` precedent -- not a bare
 * resource-CRUD shape.
 */
@Controller()
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(PaymentService) private readonly paymentService: PaymentService,
  ) {}

  @Post('v1/orders/:id/invoice')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_billing')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'invoice.generate', resourceType: 'invoice' })
  async generateInvoice(
    @Param(new ZodValidationPipe(orderIdParamSchema)) { id }: OrderIdParamDto,
    @Body(new ZodValidationPipe(generateInvoiceRequestSchema))
    body: GenerateInvoiceRequestDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [orderRow] = await tx
      .select()
      .from(order)
      .where(eq(order.id, id))
      .limit(1);
    if (!orderRow) {
      throw new NotFoundException('Order not found');
    }

    const { invoice: invoiceRow, lineItems } =
      await this.billingService.generateInvoice(tx, {
        tenantId: orderRow.tenantId,
        orderId: id,
        patientId: orderRow.patientId,
        payerType: body.payerType,
        referringFacilityId: body.referringFacilityId,
      });

    return {
      resourceId: invoiceRow.id,
      after: toInvoiceDto(invoiceRow, lineItems),
    };
  }

  @Get('v1/invoices/:id')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_billing')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: InvoiceDto, status: 200 })
  async getInvoice(
    @Param(new ZodValidationPipe(invoiceIdParamSchema)) { id }: InvoiceIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [invoiceRow] = await tx
      .select()
      .from(invoice)
      .where(eq(invoice.id, id))
      .limit(1);
    if (!invoiceRow) {
      throw new NotFoundException('Invoice not found');
    }
    const lineItems = await tx
      .select()
      .from(invoiceLineItem)
      .where(eq(invoiceLineItem.invoiceId, id));
    return toInvoiceDto(invoiceRow, lineItems);
  }

  @Post('v1/invoices/:id/payments')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_billing')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'payment.record', resourceType: 'payment' })
  async recordPayment(
    @Param(new ZodValidationPipe(invoiceIdParamSchema)) { id }: InvoiceIdParamDto,
    @Body(new ZodValidationPipe(paymentRequestSchema)) body: PaymentRequestDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [invoiceRow] = await tx
      .select()
      .from(invoice)
      .where(eq(invoice.id, id))
      .limit(1);
    if (!invoiceRow) {
      throw new NotFoundException('Invoice not found');
    }
    if (body.amountCents <= 0) {
      throw new BadRequestException('amountCents must be positive');
    }

    const paymentRow = await this.paymentService.recordPayment(tx, {
      tenantId: invoiceRow.tenantId,
      invoiceId: id,
      method: body.method,
      amountCents: body.amountCents,
      reference: body.reference,
    });

    return { resourceId: paymentRow.id, after: toPaymentDto(paymentRow) };
  }
}
