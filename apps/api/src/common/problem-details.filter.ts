import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ObservationResult } from '@lis/domain';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { PanelHoldException } from '../observation/finalization-rollup.interceptor';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: Array<{ path: string; message: string; code: string }>;
  // ADR-0021 / issue #400: only present on a PanelHoldException -- lets a
  // consumer (apps/web's finalizeResult()) tell "the write committed, the
  // panel just can't close yet" apart from every other ConflictException,
  // without a second network round-trip to discover the value it already has.
  reason?: 'unacknowledged_critical' | 'qc_violation';
  heldObservation?: ObservationResult;
  heldCalculatedDependents?: ObservationResult[];
}

/**
 * ADR-0013 §2: RFC 9457 `problem+json` errors, applied globally, replacing
 * Nest's default JSON error shape for every route (including the existing
 * `auth/*` proof routes — a deliberate, accepted side effect per the ADR's
 * own Consequences, verified non-breaking by TASK-039's own testing plan
 * since every existing e2e assertion checks status codes, never error-body
 * shape).
 *
 * This is the sole global exception filter (replacing the bare
 * `SentryGlobalFilter` registration in AppModule) rather than stacking a
 * second global filter alongside it — NestJS's own docs recommend declaring
 * a catch-all filter first when combined with a type-specific one, and
 * Sentry's own NestJS docs recommend exactly this shape for a codebase with
 * a custom catch-all filter: decorate `catch()` with
 * `@SentryExceptionCaptured()` instead of running two competing global
 * filters whose precedence would otherwise have to be reasoned about.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const problem: ProblemDetails = {
      type: `https://lis.internal/problems/${status}`,
      title: 'Error',
      status,
      detail: 'An unexpected error occurred',
      instance: request.url,
      code: 'internal_error',
    };

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      problem.title = 'Validation failed';
      problem.detail = 'One or more fields failed validation';
      problem.code = 'validation_failed';
      problem.errors =
        zodError instanceof ZodError
          ? zodError.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code,
            }))
          : [];
    } else if (exception instanceof PanelHoldException) {
      problem.title = 'Panel held';
      problem.detail = exception.message;
      problem.code = 'panel_hold';
      problem.reason = exception.reason;
      problem.heldObservation = exception.heldObservation;
      problem.heldCalculatedDependents = exception.heldCalculatedDependents;
    } else if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string }).message ?? exception.message);
      problem.title = exception.name;
      problem.detail = message;
      problem.code = exception.name;
    }

    response
      .status(status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }
}
