import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { interopOrderIngestSchema, interopOruDataSchema } from '@lis/domain';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { OrderCreationService } from '../order/order-creation.service';
import { InteropOrderCorrelationService } from './interop-order-correlation.service';
import { InteropOruDataService } from './interop-oru-data.service';
import { UnmatchedOrderException } from './unmatched-order.exception';

class InteropOrderIngestDto extends createZodDto(interopOrderIngestSchema) {}

const observationIdParamSchema = z.object({ id: z.uuid() });
class ObservationIdParamDto extends createZodDto(observationIdParamSchema) {}
const InteropOruDataDto = createZodDto(interopOruDataSchema);
type InteropOruDataDto = InstanceType<typeof InteropOruDataDto>;

type Tx = RequestWithTx['tx'];

/**
 * FEAT-036 (ADR-0034/ADR-0035): the cloud-core side of `apps/interop`'s
 * inbound ORM handling. Correlates the ACL's already-parsed MRN/test-code
 * strings to a real patient/testDefinition (`InteropOrderCorrelationService`,
 * KB-30's PID/OBR mapping) and writes through the same `OrderCreationService`
 * a human `POST /v1/orders` call uses (mirrors `GatewayIngestController` /
 * ADR-0027's identical reasoning for observations) -- one order-creation
 * implementation, not a second copy for the machine caller.
 *
 * An unmatched order (KB-30/KB-29: "park, never drop") returns 422, not a
 * write -- `apps/interop`'s own MLLP layer maps that to an HL7 "AR"
 * (Application Reject) ACK back to the sending EHR/HIS, not "AA".
 */
@Controller('internal/interop')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class InteropBridgeController {
  constructor(
    @Inject(InteropOrderCorrelationService)
    private readonly correlation: InteropOrderCorrelationService,
    @Inject(OrderCreationService)
    private readonly orderCreationService: OrderCreationService,
    @Inject(InteropOruDataService)
    private readonly oruDataService: InteropOruDataService,
  ) {}

  @Get('health')
  @RequireCapability('interop_ingest')
  @UseInterceptors(TenantContextInterceptor)
  health() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Post('orders')
  @HttpCode(202)
  @RequireCapability('interop_ingest')
  @UseInterceptors(TenantContextInterceptor)
  async ingestOrder(
    @Body(new ZodValidationPipe(interopOrderIngestSchema))
    body: InteropOrderIngestDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const correlated = await this.correlation.correlate(tx, user.tenantId, {
      mrn: body.mrn,
      testCode: body.testCode,
    });
    if (!correlated.matched) {
      throw new UnmatchedOrderException(correlated.reason);
    }

    const { orderRow, orderedTestRows } =
      await this.orderCreationService.create(tx, {
        tenantId: user.tenantId,
        patientId: correlated.patientId,
        testDefinitionIds: [correlated.testDefinitionId],
        priority: body.priority,
      });

    return {
      status: 'accepted',
      orderId: orderRow.id,
      orderedTestIds: orderedTestRows.map((row) => row.id),
    };
  }

  /**
   * FEAT-036 AC #2: the read side `apps/interop`'s `OruBuilderService` calls
   * to get everything it needs to build a real ORU^R01 -- a query, not a
   * write, same authorization shape as the order-ingest route above.
   */
  @Get('observations/:id/oru-data')
  @RequireCapability('interop_ingest')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: InteropOruDataDto, status: 200 })
  async getOruData(
    @Param(new ZodValidationPipe(observationIdParamSchema))
    { id }: ObservationIdParamDto,
    @DbTx() tx: Tx,
  ): Promise<InteropOruDataDto> {
    return this.oruDataService.getOruData(tx, id);
  }
}
