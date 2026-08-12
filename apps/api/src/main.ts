import './instrument';

import { randomUUID } from 'crypto';
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

  // FEAT-061: registered as a real Fastify plugin (not Nest middleware) --
  // same pattern @fastify/static already establishes for this app. No
  // fileSize limit override (proposal §5/§10 Q4: no size cap in this v1
  // scope) -- the plugin's own defaults apply.
  await app.register(fastifyMultipart);

  // ADR-0013 §1: OpenAPI generated from the same Zod schemas used for
  // request validation — never a hand-maintained parallel spec. `/v1/*`
  // resource routes only (see PatientController); `/auth/*` and `/health`
  // are intentionally not part of this versioned document (ADR-0013 §3).
  const openApiConfig = new DocumentBuilder()
    .setTitle('LIS Platform API')
    .setDescription('Versioned resource API — see ADR-0013')
    .setVersion('1.0')
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('v1/docs', app, cleanupOpenApiDoc(openApiDocument));

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0');
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
