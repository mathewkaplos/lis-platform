import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  orgSettingsSchema,
  orgSettingsUpdateSchema,
  type OrgSettings,
} from '@lis/domain';
import { createDb, tenant } from '@lis/db';
import { eq } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { db } from '../auth/db';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class OrgSettingsDto extends createZodDto(orgSettingsSchema) {}
class OrgSettingsUpdateDto extends createZodDto(orgSettingsUpdateSchema) {}

type Db = ReturnType<typeof createDb>;

/**
 * Issue #692. `tenant` is the global registry table itself (ADR-0039) --
 * no `tenant_id` column, no RLS policy -- so every query here filters
 * manually by `eq(tenant.id, user.tenantId)` rather than relying on RLS
 * (matching TenantCheckController's own documented "unbound" precedent for
 * this exact class of table). GET needs no capability gate (reading one's
 * own org's preference is informational, matching
 * MicrobiologyCatalogController's own precedent); PUT is
 * `manage_org_settings`-gated (`qa` only) and `@Audit()`'d, using
 * `TenantContextInterceptor`'s transaction (`tx`) only so `AuditInterceptor`
 * has a transaction to write the audit_event row through -- not because
 * `tenant` itself is RLS-scoped.
 *
 * A genuine, confirmed-live gap this feature surfaces: `tenant.ts`'s own
 * comment says "every tenant that existed before FEAT-045 resolves to
 * `shared`" -- true because most tenants (every tenant in this dev/test
 * environment, confirmed directly: `SELECT * FROM tenant` returns zero
 * rows) have no row in this table at all; the JWT's own `tenant_id` claim
 * is the only real source of truth for "which tenant." A plain UPDATE
 * would therefore silently no-op for exactly the tenants this feature
 * needs to work for. `update()` below upserts instead -- lazily creates a
 * placeholder row on first write, updates in place afterward.
 *
 * Issue #706: extended to the full organization profile (name, address,
 * phone, email, logo, currency) -- `name` was originally never touched on
 * conflict (this feature had no reason to change it); now genuinely
 * editable, since org identity being editable is #706's whole point. Every
 * field falls back to `before`'s existing value via `??` when the caller's
 * PUT body omits that key, so a partial update never clobbers fields it
 * didn't mention -- matches `orgSettingsUpdateSchema`'s all-optional shape.
 */
@Controller('v1/org-settings')
@UseGuards(JwtAuthGuard)
export class OrgSettingsController {
  @Get()
  @ZodResponse({ type: OrgSettingsDto, status: 200 })
  async get(@CurrentUser() user: RequestContext): Promise<OrgSettings> {
    return getOrgSettings(db, user.tenantId);
  }

  @Put()
  @UseGuards(CapabilityGuard)
  @RequireCapability('manage_org_settings')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'org_settings.update', resourceType: 'tenant' })
  async update(
    @Body(new ZodValidationPipe(orgSettingsUpdateSchema))
    body: OrgSettingsUpdateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    // Reads through `tx`, not the module-level `db` pool -- this handler
    // already holds `db`'s one open connection via TenantContextInterceptor's
    // own transaction, so a second `db`-pool query here would deadlock
    // waiting for a connection the current request itself is holding
    // (concretely reproduced under the e2e suite's DB_POOL_MAX=1).
    const before = await getOrgSettings(tx, user.tenantId);

    // Issue #706: `name` is now genuinely editable -- unlike the original
    // #692 shape (which deliberately never touched `name` on conflict,
    // since that feature had no reason to change it), org identity being
    // editable is this feature's whole point. `undefined` fields (the
    // caller didn't send that key) fall back to the existing row's value
    // via `coalesce`, so a partial PUT never clobbers fields it didn't
    // mention -- matches `orgSettingsUpdateSchema`'s own all-optional shape.
    const [row] = await tx
      .insert(tenant)
      .values({
        id: user.tenantId,
        name: body.name ?? before.name ?? `Tenant ${user.tenantId}`,
        address: body.address ?? before.address,
        phone: body.phone ?? before.phone,
        email: body.email ?? before.email,
        logoUrl: body.logoUrl ?? before.logoUrl,
        currency: body.currency ?? before.currency,
        preferredSynopticSourceStandard:
          body.preferredSynopticSourceStandard ??
          before.preferredSynopticSourceStandard,
      })
      .onConflictDoUpdate({
        target: tenant.id,
        set: {
          name: body.name ?? before.name ?? `Tenant ${user.tenantId}`,
          address: body.address ?? before.address,
          phone: body.phone ?? before.phone,
          email: body.email ?? before.email,
          logoUrl: body.logoUrl ?? before.logoUrl,
          currency: body.currency ?? before.currency,
          preferredSynopticSourceStandard:
            body.preferredSynopticSourceStandard ??
            before.preferredSynopticSourceStandard,
        },
      })
      .returning();

    const after: OrgSettings = toOrgSettings(row);
    return { resourceId: user.tenantId, before, after };
  }
}

function toOrgSettings(row: {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  currency: string | null;
  preferredSynopticSourceStandard: string | null;
}): OrgSettings {
  return {
    name: row.name ?? null,
    address: row.address ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    logoUrl: row.logoUrl ?? null,
    currency: row.currency ?? null,
    preferredSynopticSourceStandard:
      row.preferredSynopticSourceStandard ?? null,
  };
}

async function getOrgSettings(
  queryable: Db | RequestWithTx['tx'],
  tenantId: string,
): Promise<OrgSettings> {
  const [row] = await queryable
    .select({
      name: tenant.name,
      address: tenant.address,
      phone: tenant.phone,
      email: tenant.email,
      logoUrl: tenant.logoUrl,
      currency: tenant.currency,
      preferredSynopticSourceStandard: tenant.preferredSynopticSourceStandard,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);
  return row
    ? toOrgSettings(row)
    : {
        name: null,
        address: null,
        phone: null,
        email: null,
        logoUrl: null,
        currency: null,
        preferredSynopticSourceStandard: null,
      };
}
