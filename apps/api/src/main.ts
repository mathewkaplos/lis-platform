import './instrument';

import { randomUUID } from 'crypto';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ genReqId: () => randomUUID(), logger: true }),
  );

  // world-class-final-assessment-2026-09 §9: baseline HTTP security headers
  // -- previously nothing set X-Content-Type-Options/X-Frame-Options/HSTS
  // anywhere in the stack. `contentSecurityPolicy: false` is deliberate,
  // not an oversight: this API returns only JSON (and the Swagger UI HTML
  // below, which needs its own inline scripts/styles CSP would break) --
  // apps/web is the one surface that actually renders untrusted-adjacent
  // HTML to a browser and owns its own CSP separately.
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // FEAT-061: registered as a real Fastify plugin (not Nest middleware) --
  // same pattern @fastify/static already establishes for this app. No
  // fileSize limit override (proposal §5/§10 Q4: no size cap in this v1
  // scope) -- the plugin's own defaults apply.
  await app.register(fastifyMultipart);

  // ADR-0013 §1: OpenAPI generated from the same Zod schemas used for
  // request validation — never a hand-maintained parallel spec. `/v1/*`
  // resource routes only (see PatientController); `/auth/*` and `/health`
  // are intentionally not part of this versioned document (ADR-0013 §3).
  //
  // world-class-final-assessment-2026-09 §9: this endpoint had no auth
  // guard and no environment gate. It stays unauthenticated (schema
  // exploration, not data access) but is now gated off in a real NODE_ENV=
  // production deployment -- today's staging container runs NODE_ENV=
  // staging (infra/docker-compose.staging.yml), so this is a no-op there
  // and only takes effect once a true production tier exists.
  if (process.env.NODE_ENV !== 'production') {
    const openApiConfig = new DocumentBuilder()
      .setTitle('LIS Platform API')
      .setDescription('Versioned resource API — see ADR-0013')
      .setVersion('1.0')
      .build();
    const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('v1/docs', app, cleanupOpenApiDoc(openApiDocument));
  }

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0');
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
