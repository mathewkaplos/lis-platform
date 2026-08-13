import { pgTable, uuid, text, timestamp, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { slide } from "./anatomic-pathology";

// Tenant-scoped per ADR-0004: operational, tenant-varying clinical-workflow
// data, same category as image_attachment.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-067 (ADR-0055, docs/plans/feat-067-wsi-viewer.md). A dedicated table,
// not image_attachment's polymorphic resourceType/resourceId shape -- a WSI
// is slide-specific by nature (unlike a gross/microscopic photo, which
// genuinely attaches to Case/Specimen/Block/Slide alike) and its own
// storage shape (a tile-pyramid prefix, not one flat objectKey) doesn't fit
// image_attachment's existing category CHECK or single-object-key column.
//
// Multiple rows per slide are allowed (a rescan is a real, plausible
// event) -- no supersede/version chain built for v1 (no named requirement
// for it); the most recent 'ready' row per slide is what the UI surfaces.
export const wholeSlideImage = pgTable(
  "whole_slide_image",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    slideId: uuid("slide_id")
      .notNull()
      .references(() => slide.id),
    // Unzip-to-object-storage is a real multi-second-to-minutes operation
    // that can genuinely fail partway (ADR-0055) -- unlike image_attachment's
    // single-buffered-PUT upload, which either succeeds or 500s outright.
    status: text("status").notNull().default("processing"),
    // Every tile plus the .dzi descriptor live under this prefix (e.g.
    // "{tenantId}/wsi/{id}/"), same per-tenant-prefixed key convention
    // image-attachment.controller.ts's own objectKey construction already
    // establishes.
    tileObjectPrefix: text("tile_object_prefix").notNull(),
    // The specific key of the .dzi XML descriptor within the prefix --
    // nullable until status = 'ready'.
    dziObjectKey: text("dzi_object_key"),
    // Populated only on status = 'failed'.
    errorMessage: text("error_message"),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull(), // no FK: no user table exists yet, mirrors image_attachment.uploadedByUserId
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_whole_slide_image_tenant_slide").on(table.tenantId, table.slideId),
    check("ck_whole_slide_image_status", sql`${table.status} IN ('processing','ready','failed')`),
    tenantIsolation(),
  ],
).enableRLS();
