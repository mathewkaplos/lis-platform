import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { catalogSchema, CATALOG_RESULT_LIMIT, type Catalog } from '@lis/domain';
import { panel, panelTest, testDefinition } from '@lis/db';
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
    const tests = await tx
      .select({
        id: testDefinition.id,
        code: testDefinition.code,
        displayName: testDefinition.displayName,
      })
      .from(testDefinition)
      .orderBy(asc(testDefinition.displayName))
      .limit(CATALOG_RESULT_LIMIT);

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
