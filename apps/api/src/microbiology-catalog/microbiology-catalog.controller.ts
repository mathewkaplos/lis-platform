import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  microbiologyCatalogSchema,
  type AntimicrobialResult,
  type BreakpointResult,
  type BreakpointTableResult,
  type MicrobiologyCatalog,
  type OrganismResult,
} from '@lis/domain';
import {
  antimicrobial,
  breakpoint,
  breakpointTable,
  codeSystemValue,
  createDb,
  organism,
} from '@lis/db';
import { eq } from 'drizzle-orm';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { db } from '../auth/db';

class MicrobiologyCatalogDto extends createZodDto(microbiologyCatalogSchema) {}

type Db = ReturnType<typeof createDb>;

/**
 * FEAT-051 (docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md,
 * ADR-0045). Read endpoints only (proposal §2 -- "no write/admin UI yet";
 * seed data ships via `db/seed/microbiology-catalog.sql`, the same
 * mechanism `chemistry-catalog.sql`/`haematology-catalog.sql` already use).
 *
 * No `TenantContextInterceptor`/`@DbTx()` -- unlike `CatalogController`
 * (which reads a mix of global and tenant-scoped tables), every table this
 * controller reads is global with no RLS policy at all (ADR-0045). Queries
 * the raw `db` connection directly, matching this repo's own convention
 * that RLS-bound `TenantContextInterceptor` is only needed when a query
 * actually touches a tenant-scoped table.
 *
 * No capability gate, matching `GET /v1/catalog`'s own established
 * precedent -- browsing the organism/antimicrobial/breakpoint catalog is
 * informational, the same class as browsing the test catalog.
 */
@Controller('v1/microbiology-catalog')
@UseGuards(JwtAuthGuard)
export class MicrobiologyCatalogController {
  @Get()
  @ZodResponse({ type: MicrobiologyCatalogDto, status: 200 })
  async get(): Promise<MicrobiologyCatalog> {
    return getMicrobiologyCatalog(db);
  }
}

/** Exported for direct testing without an HTTP layer, matching
 * `report-assembly.ts`'s own exported-function precedent. */
export async function getMicrobiologyCatalog(
  tx: Db,
): Promise<MicrobiologyCatalog> {
  const organismRows = await tx
    .select({
      id: organism.id,
      display: organism.display,
      snomedCode: codeSystemValue.code,
    })
    .from(organism)
    .innerJoin(
      codeSystemValue,
      eq(organism.codeSystemValueId, codeSystemValue.id),
    );
  const organisms: OrganismResult[] = organismRows;

  const antimicrobialRows = await tx
    .select({
      id: antimicrobial.id,
      display: antimicrobial.display,
      atcCode: codeSystemValue.code,
    })
    .from(antimicrobial)
    .innerJoin(
      codeSystemValue,
      eq(antimicrobial.codeSystemValueId, codeSystemValue.id),
    );
  const antimicrobials: AntimicrobialResult[] = antimicrobialRows;

  const breakpointTableRows = await tx.select().from(breakpointTable);
  const breakpointTables: BreakpointTableResult[] = breakpointTableRows.map(
    (row) => ({
      id: row.id,
      publisher: row.publisher,
      version: row.version,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
      sourceUrl: row.sourceUrl,
    }),
  );

  const breakpointRows = await tx.select().from(breakpoint);
  const breakpoints: BreakpointResult[] = breakpointRows.map((row) => ({
    id: row.id,
    breakpointTableId: row.breakpointTableId,
    organismId: row.organismId,
    antimicrobialId: row.antimicrobialId,
    method: row.method,
    susceptibleMax: row.susceptibleMax,
    resistantMin: row.resistantMin,
    sourceNote: row.sourceNote,
  }));

  return { organisms, antimicrobials, breakpointTables, breakpoints };
}
