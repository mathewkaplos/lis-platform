import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PatientModule } from './patient/patient.module';
import { OrderModule } from './order/order.module';
import { CatalogModule } from './catalog/catalog.module';
import { SpecimenModule } from './specimen/specimen.module';
import { ObservationModule } from './observation/observation.module';
import { ReportModule } from './report/report.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';

@Module({
  imports: [
    SentryModule.forRoot(),
    AuthModule,
    PatientModule,
    OrderModule,
    CatalogModule,
    SpecimenModule,
    ObservationModule,
    ReportModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ADR-0013 §1: one global Zod validation pipe for every route.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // ADR-0013 §2: replaces the bare SentryGlobalFilter — see
    // ProblemDetailsFilter's own header comment for why this is one filter,
    // not two stacked global filters.
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
