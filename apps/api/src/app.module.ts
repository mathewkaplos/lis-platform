import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
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
import { WorklistModule } from './worklist/worklist.module';
import { ControlLotModule } from './control-lot/control-lot.module';
import { CriticalNotificationModule } from './critical-notification/critical-notification.module';
import { QcRuleViolationModule } from './qc-rule-violation/qc-rule-violation.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';

@Module({
  imports: [
    SentryModule.forRoot(),
    // TASK-066 (ADR-0017): the critical-notification escalation job's own
    // @Interval scheduling. No queue, no event bus -- a plain polling
    // interval (domain/critical-values Skill entry #4).
    ScheduleModule.forRoot(),
    AuthModule,
    PatientModule,
    OrderModule,
    CatalogModule,
    SpecimenModule,
    ObservationModule,
    ReportModule,
    WorklistModule,
    ControlLotModule,
    CriticalNotificationModule,
    QcRuleViolationModule,
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
