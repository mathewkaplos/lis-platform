import { rawResultSchema } from '@lis/domain';
import { createZodDto } from 'nestjs-zod';

export { rawResultSchema, rawResultIdempotencyKey as idempotencyKey } from '@lis/domain';
export type { RawResult } from '@lis/domain';

/** nestjs-zod DTO wrapper around the shared `@lis/domain` schema. */
export class RawResultDto extends createZodDto(rawResultSchema) {}
