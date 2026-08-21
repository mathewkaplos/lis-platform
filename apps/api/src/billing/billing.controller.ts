import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  generateInvoiceRequestSchema,
  invoiceListQuerySchema,
  invoiceListResponseSchema,
  invoiceSchema,
  paymentRequestSchema,
  type Invoice,
  type InvoiceListResponse,
} from '@lis/domain';
import { invoice, invoiceLineItem, payment, order, patient } from '@lis/db';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
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
import { getPaidCents, PaymentService } from './payment.service';

const orderIdParamSchema = z.object({ id: z.uuid() });
const invoiceIdParamSchema = z.object({ id: z.uuid() });
// Proper DTO class for the new list route's query, not a bare inline type --
// `billing` Skill entry #2's own finding: a bare inline `@Query()` type
// carries no class metadata for NestJS's OpenAPI generator, silently
// producing `query?: never` in the generated schema.
class InvoiceListQueryDto extends createZodDto(invoiceListQuerySchema) {}
class InvoiceListResponseDto extends createZodDto(invoiceListResponseSchema) {}
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
  paidCents: number,
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
    // `PaymentService.getPaidCents`'s own real sum -- never a second,
    // independently-maintained computation of the same number.
    amountPaidCents: paidCents,
    balanceDueCents: row.totalCents - paidCents,
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
      // A just-generated invoice has no payments yet -- `0`, not a query,
      // same reasoning as not re-deriving `totalCents` from a fresh read.
      after: toInvoiceDto(invoiceRow, lineItems, 0),
    };
  }

  /**
   * Issue #489 (§17.1 only, docs/plans/task-489-invoice-list.md): filtered
   * invoice list. Stays `manage_billing`-gated, deliberately not following
   * `case.controller.ts list()`'s own ungated precedent -- financial data
   * warrants the same gate every other route on this controller already
   * carries; `case`'s ungated list is itself a flagged, accepted gap, not a
   * pattern to copy into a second controller.
   */
  @Get('v1/invoices')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_billing')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: InvoiceListResponseDto, status: 200 })
  async list(
    @Query(new ZodValidationPipe(invoiceListQuerySchema))
    query: InvoiceListQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<InvoiceListResponse> {
    const conditions = [
      query.status ? eq(invoice.status, query.status) : undefined,
      query.payerType ? eq(invoice.payerType, query.payerType) : undefined,
      query.patientId ? eq(invoice.patientId, query.patientId) : undefined,
      query.createdFrom
        ? gte(invoice.createdAt, new Date(query.createdFrom))
        : undefined,
      query.createdTo
        ? lte(invoice.createdAt, new Date(query.createdTo))
        : undefined,
      // Issue #704: the facility-statement screen's own filter.
      query.referringFacilityId
        ? eq(invoice.referringFacilityId, query.referringFacilityId)
        : undefined,
    ].filter((c) => c !== undefined);

    // Issue #704: joined for `patientName` on the list response -- a
    // facility statement's patient-level detail needs a real name, not
    // just an id.
    const rows = await tx
      .select({
        invoice,
        patientFirstName: patient.firstName,
        patientLastName: patient.lastName,
      })
      .from(invoice)
      .innerJoin(patient, eq(invoice.patientId, patient.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(invoice.createdAt));

    // One grouped query for every matched invoice's paid total -- never N
    // separate `getPaidCents` round trips, and never a second,
    // independently-maintained computation of the same number
    // (`billing` Skill entry #3).
    const paidByInvoiceId = new Map<string, number>();
    if (rows.length > 0) {
      const sums = await tx
        .select({
          invoiceId: payment.invoiceId,
          total: sql<string>`COALESCE(SUM(${payment.amountCents}), 0)`,
        })
        .from(payment)
        .where(
          and(
            inArray(
              payment.invoiceId,
              rows.map((r) => r.invoice.id),
            ),
            eq(payment.status, 'succeeded'),
          ),
        )
        .groupBy(payment.invoiceId);
      for (const s of sums) {
        paidByInvoiceId.set(s.invoiceId, Number(s.total));
      }
    }

    const items = rows
      .map(({ invoice: row, patientFirstName, patientLastName }) => {
        const amountPaidCents = paidByInvoiceId.get(row.id) ?? 0;
        return {
          id: row.id,
          patientId: row.patientId,
          patientName: `${patientFirstName} ${patientLastName}`,
          invoiceNumber: row.invoiceNumber,
          status: row.status as Invoice['status'],
          payerType: row.payerType as Invoice['payerType'],
          totalCents: row.totalCents,
          amountPaidCents,
          balanceDueCents: row.totalCents - amountPaidCents,
          createdAt: row.createdAt.toISOString(),
        };
      })
      .filter((item) =>
        query.hasBalance === undefined
          ? true
          : query.hasBalance === 'true'
            ? item.balanceDueCents > 0
            : item.balanceDueCents <= 0,
      );

    return { items };
  }

  @Get('v1/invoices/:id')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_billing')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: InvoiceDto, status: 200 })
  async getInvoice(
    @Param(new ZodValidationPipe(invoiceIdParamSchema))
    { id }: InvoiceIdParamDto,
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
    const paidCents = await getPaidCents(tx, id);
    return toInvoiceDto(invoiceRow, lineItems, paidCents);
  }

  @Post('v1/invoices/:id/payments')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_billing')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'payment.record', resourceType: 'payment' })
  async recordPayment(
    @Param(new ZodValidationPipe(invoiceIdParamSchema))
    { id }: InvoiceIdParamDto,
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
