import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentService } from './payment.service';
import { StubMobileMoneyProvider } from './providers/stub-mobile-money-provider';

@Module({
  controllers: [BillingController],
  providers: [
    { provide: BillingService, useFactory: () => new BillingService() },
    {
      provide: PaymentService,
      useFactory: () => new PaymentService(new StubMobileMoneyProvider()),
    },
  ],
})
export class BillingModule {}
