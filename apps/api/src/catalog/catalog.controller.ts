import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  catalogSchema,
  CATALOG_RESULT_LIMIT,
  type Catalog,
  type CatalogAnalyte,
} from '@lis/domain';
import {
  analyte,
  codeSystemValue,
  panel,
  panelTest,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { asc, inArray } from 'drizzle-orm';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DbTx } from '../auth/db-tx.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class CatalogDto extends createZodDto(catalogSchema) {}

/**
 * TASK-043 (FEAT-012 proposal §1/§2): the order builder's own catalog-read
 * prerequisite -- no earlier task exposed test_definition/panel via the API.
 * A single, unfiltered `GET /v1/catalog` (no search query, capped at
 * `CATALOG_RESULT_LIMIT`) -- the builder filters client-side (proposal §5).
 * Not audited (a read, `engineering/api-design` entry #6); no capability
 * gate (browsing the catalog is informational, matching patient search's
 * own gate-free reads).
 */
@Controller('v1/catalog')
export class CatalogController {
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: CatalogDto, status: 200 })
  async get(@DbTx() tx: RequestWithTx['tx']): Promise<Catalog> {
    const testRows = await tx
      .select({
        id: testDefinition.id,
        code: testDefinition.code,
        displayName: testDefinition.displayName,
      })
      .from(testDefinition)
      .orderBy(asc(testDefinition.displayName))
      .limit(CATALOG_RESULT_LIMIT);

    // TASK-052 (FEAT-014 revision §10 Q1): each test's own analyte(s), with
    // enough catalog metadata (dataType, unit) for the result-entry grid to
    // render a field -- reuses this already-fetched-everywhere endpoint
    // rather than a new per-orderedTest read (proposal §1 finding #1).
    // Separate queries + in-memory maps, not .innerJoin() -- matching
    // order.controller.ts's/specimen.controller.ts's own established
    // convention (no join-result-key precedent exists elsewhere in this
    // repo, `engineering/api-design` entry #7's neighboring discipline).
    const testIds = testRows.map((row) => row.id);
    const linkRows =
      testIds.length > 0
        ? await tx
            .select({
              testDefinitionId: testAnalyte.testDefinitionId,
              analyteId: testAnalyte.analyteId,
            })
            .from(testAnalyte)
            .where(inArray(testAnalyte.testDefinitionId, testIds))
        : [];
    const analyteIds = Array.from(
      new Set(linkRows.map((row) => row.analyteId)),
    );
    const analyteRows =
      analyteIds.length > 0
        ? await tx
            .select({
              id: analyte.id,
              codeSystemValueId: analyte.codeSystemValueId,
              display: analyte.display,
              dataType: analyte.dataType,
              defaultUnitId: analyte.defaultUnitId,
            })
            .from(analyte)
            .where(inArray(analyte.id, analyteIds))
        : [];
    const unitIds = Array.from(
      new Set(
        analyteRows
          .map((row) => row.defaultUnitId)
          .filter((id): id is string => id !== null),
      ),
    );
    const unitRows =
      unitIds.length > 0
        ? await tx
            .select({
              id: unit.id,
              codeSystemValueId: unit.codeSystemValueId,
              displayOverride: unit.displayOverride,
            })
            .from(unit)
            .where(inArray(unit.id, unitIds))
        : [];
    // TASK-053 (FEAT-014 revision §2): the analyte's own LOINC code is
    // resolved the same way as unit's UCUM code below -- combining both id
    // sets into one codeSystemValue lookup, not two separate round trips.
    const codeSystemValueIds = Array.from(
      new Set([
        ...unitRows.map((row) => row.codeSystemValueId),
        ...analyteRows.map((row) => row.codeSystemValueId),
      ]),
    );
    const codeSystemValueRows =
      codeSystemValueIds.length > 0
        ? await tx
            .select({ id: codeSystemValue.id, code: codeSystemValue.code })
            .from(codeSystemValue)
            .where(inArray(codeSystemValue.id, codeSystemValueIds))
        : [];
    const codeById = new Map(
      codeSystemValueRows.map((row) => [row.id, row.code]),
    );
    const unitDisplayById = new Map(
      unitRows.map((row) => [
        row.id,
        row.displayOverride ?? codeById.get(row.codeSystemValueId) ?? null,
      ]),
    );
    const analyteById = new Map(
      analyteRows.map((row) => [
        row.id,
        {
          id: row.id,
          code: codeById.get(row.codeSystemValueId) ?? '',
          display: row.display,
          dataType: row.dataType,
          unit: row.defaultUnitId
            ? (unitDisplayById.get(row.defaultUnitId) ?? null)
            : null,
          unitId: row.defaultUnitId,
        } satisfies CatalogAnalyte,
      ]),
    );
    const analytesByTestId = new Map<string, CatalogAnalyte[]>();
    for (const row of linkRows) {
      const analyteRow = analyteById.get(row.analyteId);
      if (!analyteRow) continue;
      const existing = analytesByTestId.get(row.testDefinitionId) ?? [];
      existing.push(analyteRow);
      analytesByTestId.set(row.testDefinitionId, existing);
    }
    const tests = testRows.map((row) => ({
      ...row,
      analytes: analytesByTestId.get(row.id) ?? [],
    }));

    const panelRows = await tx
      .select({
        id: panel.id,
        code: panel.code,
        displayName: panel.displayName,
      })
      .from(panel)
      .orderBy(asc(panel.displayName))
      .limit(CATALOG_RESULT_LIMIT);

    const panelIds = panelRows.map((row) => row.id);
    const panelTestRows =
      panelIds.length > 0
        ? await tx
            .select({
              panelId: panelTest.panelId,
              testDefinitionId: panelTest.testDefinitionId,
            })
            .from(panelTest)
            .where(inArray(panelTest.panelId, panelIds))
        : [];
    const testIdsByPanelId = new Map<string, string[]>();
    for (const row of panelTestRows) {
      const existing = testIdsByPanelId.get(row.panelId) ?? [];
      existing.push(row.testDefinitionId);
      testIdsByPanelId.set(row.panelId, existing);
    }

    return {
      tests,
      panels: panelRows.map((row) => ({
        ...row,
        testDefinitionIds: testIdsByPanelId.get(row.id) ?? [],
      })),
    };
  }
}
