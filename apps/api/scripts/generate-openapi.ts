// TASK-040 (FEAT-011): generates the same OpenAPI document main.ts serves at
// /v1/docs, as a checked-in file (`apps/api/openapi.json`) packages/sdk's own
// `generate` script reads via `openapi-typescript` -- a visible, diffable
// build artifact reviewed in PRs, per ADR-0013 §1's "contract never drifts
// from the code" principle, not a hand-maintained parallel spec. Boots the
// real Nest app the same way main.ts does (minus actually listening), so
// this is never a second, independent description of the contract.
//
// MUST be run via `ts-node` (see package.json's `generate-openapi` script),
// never `tsx` -- a third real instance of the same root cause `testing`
// Skill entry #6 already documents (vitest's esbuild transform drops
// `design:paramtypes`): `tsx` is also esbuild-based, and running this script
// through it produced a `POST /v1/patients` request body of `content?:
// never` -- Nest/Swagger's own decorator-metadata reading depends on the
// exact same reflection metadata, silently empty either way. `ts-node` uses
// the real TypeScript compiler (`emitDecoratorMetadata: true`), matching
// what `nest build`/production actually does, and produces the correct
// `PatientCreateDto` schema reference.
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );

  const config = new DocumentBuilder()
    .setTitle('LIS Platform API')
    .setDescription('Versioned resource API — see ADR-0013')
    .setVersion('1.0')
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));

  writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
