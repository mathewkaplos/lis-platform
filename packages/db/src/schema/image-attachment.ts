import { pgTable, uuid, text, integer, timestamp, jsonb, index, pgPolicy, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { observation } from "./observation";

// Tenant-scoped per KB-06 ("Object storage, referenced by row"): an image
// attachment is operational, tenant-varying data, same category as
// order/specimen/case.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-061 (ADR-0052, docs/plans/feat-061-image-attachments-annotations.md).
// A gross or microscopic image attached to a Case/Specimen/Block/Slide,
// stored in object storage (MinIO, self-hosted -- proposal §5/§10 Q1) and
// referenced by row -- never inline in Postgres (KB-06's own "Big binaries
// | Object storage, referenced by row" precedent).
//
// resourceType/resourceId: polymorphic parent, no FK -- same "discriminated-
// union FK mechanism doesn't exist in this schema builder" precedent
// audit_event.resource_id already established (packages/db/src/schema/audit.ts's
// own header comment), reused here rather than four separate per-resource-
// type attachment tables.
export const imageAttachment = pgTable(
  "image_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    resourceType: text("resource_type").notNull(), // 'case' | 'specimen' | 'block' | 'slide'
    resourceId: uuid("resource_id").notNull(),
    category: text("category").notNull(), // 'gross' | 'microscopic' (KB-17's own two image categories)
    objectKey: text("object_key").notNull(), // the object-storage key -- never the bytes
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull(), // no FK: no user table exists yet, mirrors report.generatedByUserId
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_image_attachment_tenant_resource").on(table.tenantId, table.resourceType, table.resourceId),
    check("ck_image_attachment_resource_type", sql`${table.resourceType} IN ('case','specimen','block','slide')`),
    check("ck_image_attachment_category", sql`${table.category} IN ('gross','microscopic')`),
    tenantIsolation(),
  ],
).enableRLS();

// An annotated region on an image, optionally tied back to a specific
// synoptic finding (proposal §5/§10 Q3: the discrete per-response
// Observation FEAT-058's assembleAndPersistSynopticResponse already writes,
// e.g. "tumor grade: high_grade" -- not the synoptic_element field
// definition itself, and not the whole signed case_report_version).
//
// observationId/observationCreatedAt: composite FK into observation(id,
// created_at) -- observation's primary key is composite post-partitioning
// (ADR-0008), so a single-column FK to observation.id alone is impossible
// (database-design Skill entries #5/#10, critical_notification's own
// identical precedent). Both nullable together (an annotation may exist
// with no finding link at all) -- the writer must always set both or
// neither, matching critical_notification's own "always set atomically from
// the same already-in-hand row, never a caller-supplied lookup" discipline,
// via the entry #10 server-side-subquery INSERT technique, not a JS Date.
export const imageAnnotation = pgTable(
  "image_annotation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    imageAttachmentId: uuid("image_attachment_id")
      .notNull()
      .references(() => imageAttachment.id),
    // Normalized 0-1 fractions of the image's own width/height
    // ({x,y,width,height}), not pixel values -- survives any future
    // re-encode/resize without the annotation drifting off its region.
    coordinates: jsonb("coordinates").notNull(),
    observationId: uuid("observation_id"),
    observationCreatedAt: timestamp("observation_created_at", { withTimezone: true }),
    label: text("label"), // short free-text caption, narrative-adjacent (not a structured clinical value, Constitution Law #1 unaffected) -- same class as a report's own comment field
    annotatedByUserId: uuid("annotated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_image_annotation_tenant_image").on(table.tenantId, table.imageAttachmentId),
    index("ix_image_annotation_observation").on(table.observationId),
    foreignKey({
      columns: [table.observationId, table.observationCreatedAt],
      foreignColumns: [observation.id, observation.createdAt],
      name: "image_annotation_observation_id_created_at_fk",
    }),
    tenantIsolation(),
  ],
).enableRLS();
