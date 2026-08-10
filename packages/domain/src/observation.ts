import { z } from "zod";

/**
 * TASK-051 (FEAT-014 revision, docs/plans/feat-014-result-entry-engine.md):
 * single source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1), same as every other domain file.
 *
 * `observation.data_type` (packages/db/src/schema/observation.ts) is a
 * native Postgres enum with 10 values (KB-14) — this schema originally
 * covered only 3 of them (proposal §10 Q2, resolved 2026-08-06), matching
 * that AC's own literal "Numeric, coded, and text" wording. FEAT-024
 * (ADR-0025) adds the 4th, `ordinal` -- the first of the remaining 6
 * (boolean, ratio, datetime, table, structured, attachment) to become real;
 * those stay genuinely out of scope until a task needs them, per
 * ADR-0025's own "one new branch per dataType, not built ahead of a real
 * need" precedent.
 */
export const resultEntryDataTypeSchema = z.enum(["quantity", "coded", "text", "ordinal"]);
export type ResultEntryDataType = z.infer<typeof resultEntryDataTypeSchema>;

/**
 * FEAT-024 (ADR-0025): the shared grading vocabulary for every seeded
 * morphology analyte (Anisocytosis, Poikilocytosis, Polychromasia, Platelet
 * Estimate) -- KB-19's own literal example ("graded none/1+/2+/3+"), one
 * scale for all of them rather than inventing per-analyte variation with no
 * real clinical source to justify it (ADR-0025 decision 2).
 */
export const morphologyGradeSchema = z.enum(["none", "1+", "2+", "3+"]);
export type MorphologyGrade = z.infer<typeof morphologyGradeSchema>;

/**
 * The request body shared by both the draft (`PUT .../results/:analyteId`)
 * and finalize (`POST .../results/:analyteId/finalize`) routes — a
 * discriminated union so exactly one typed value field is required and no
 * other is accepted, per `dataType` (proposal §2). The server independently
 * checks the submitted `dataType` matches the target analyte's own catalog
 * `dataType` — this schema alone cannot know that, it only shapes the body.
 *
 * FEAT-024 (ADR-0025 decision 1/3): the new `ordinal` branch requires a
 * validated grade (`morphologyGradeSchema`, never an arbitrary string) and
 * accepts an optional `notes` -- narrative *in addition* to the graded
 * value, never a substitute for it (KB-14's own "narrative text is allowed
 * in addition, never instead" principle; a note with no grade is rejected
 * by this same discriminated union, since `valueCode` is required on this
 * branch regardless of whether `notes` is present). `notes` is scoped to
 * this one branch only (ADR-0025 decision 3) -- not exposed for
 * quantity/coded/text writes, which no AC asks for.
 */
// FEAT-042: mirrors observation.ts's own ck_observation_notes_ai_disposition
// CHECK constraint at the request-validation layer, not just the DB -- a
// caller sending disposition without originated (or vice versa) is rejected
// as a 400 before it ever reaches a write, same "narrow at the boundary,
// trust internally" discipline (see AGENTS.md).
export const notesAiDispositionSchema = z.enum(["accepted", "edited"]);
export type NotesAiDisposition = z.infer<typeof notesAiDispositionSchema>;

export const resultEntrySchema = z
  .discriminatedUnion("dataType", [
    z.object({ dataType: z.literal("quantity"), valueNum: z.number() }),
    z.object({ dataType: z.literal("coded"), valueCode: z.string().min(1) }),
    z.object({ dataType: z.literal("text"), valueText: z.string().min(1) }),
    z.object({
      dataType: z.literal("ordinal"),
      valueCode: morphologyGradeSchema,
      notes: z.string().max(2000).optional(),
      // FEAT-042 (KB-11's "every AI suggestion and its human disposition"):
      // notesAiOriginated/notesAiDisposition travel with notes, always
      // absent unless the technologist's note started from a draft-narrative
      // suggestion (accepted verbatim or edited before finalizing).
      notesAiOriginated: z.boolean().optional(),
      notesAiDisposition: notesAiDispositionSchema.optional(),
    }),
  ])
  .refine(
    (value) =>
      value.dataType !== "ordinal" ||
      Boolean(value.notesAiOriginated) === Boolean(value.notesAiDisposition),
    {
      message: "notesAiOriginated and notesAiDisposition must be set together, or not at all",
      path: ["notesAiDisposition"],
    },
  )
  .meta({ id: "ResultEntryDto" }); // nestjs-zod docs: names the OpenAPI/SDK schema -- otherwise a generic "AugmentedZodDto"
export type ResultEntryInput = z.infer<typeof resultEntrySchema>;

/**
 * `observation.status`. TASK-051 (FEAT-014) only ever wrote the two
 * pre-verification values (`'registered'`/`'preliminary'`); TASK-055
 * (FEAT-015 revision §1 finding #5) widens this to include `'verified'` —
 * the first status this schema represents that the append-only trigger
 * (`db/migrations/0007_observation_append_only_trigger.sql`) actually
 * enforces immutability against. `'reported'`/`'amended'`/`'corrected'`/
 * `'cancelled'`/`'rejected'` (named in the DB column's own comment) remain
 * out of scope — no task writes them yet.
 */
export const observationStatusSchema = z.enum([
  "registered",
  "preliminary",
  "verified",
]);
export type ObservationStatus = z.infer<typeof observationStatusSchema>;

/**
 * Response shape — a flat object (like `Order`/`Specimen`, not a
 * discriminated union) since callers (TASK-052's grid UI) need the
 * flagging/range fields regardless of `dataType`; only the one value field
 * matching `dataType` is ever non-null.
 */
export const observationSchema = z.object({
  id: z.uuid(),
  orderedTestId: z.uuid(),
  analyteId: z.uuid(),
  dataType: resultEntryDataTypeSchema,
  valueNum: z.number().nullable(),
  valueCode: z.string().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  refLow: z.number().nullable(),
  refHigh: z.number().nullable(),
  refCondition: z.string().nullable(),
  refSource: z.string().nullable(),
  flags: z.array(z.string()),
  status: observationStatusSchema,
  // TASK-053 (FEAT-014 revision §2): `observation.source` (manual|analyzer|
  // calculated|imported, packages/db/src/schema/observation.ts) already
  // exists as a real, non-null column -- simply never exposed before this
  // task. The grid needs it to render a calculated row read-only.
  source: z.string(),
  producedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  // TASK-057 (FEAT-015 revision §2/§10 Q4): both columns already exist on
  // `observation` (packages/db/src/schema/observation.ts, set by TASK-055's
  // `verify()`) but were never exposed by any read route before this task
  // (`domain/result-verification` Skill entry #7) -- additive, no migration.
  // Non-`'verified'` rows always carry both as `null` (never set by
  // draft()/finalize()).
  verifierUserId: z.uuid().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  // FEAT-024 (ADR-0025 decision 3): exposed generally on the read side for
  // every dataType, but only ever set on write via the `ordinal` branch of
  // `resultEntrySchema` -- null on every quantity/coded/text row today.
  notes: z.string().nullable(),
  // FEAT-042: same "exposed generally, only ever set via ordinal" shape as
  // notes itself, immediately above.
  notesAiOriginated: z.boolean(),
  notesAiDisposition: notesAiDispositionSchema.nullable(),
});
export type ObservationResult = z.infer<typeof observationSchema>;

/**
 * TASK-057 (FEAT-015 revision §1 finding #3/§2): the patient's own prior
 * result(s) for the same analyte, surfaced during verification -- no
 * computed delta (§10 Q1), just the raw prior value(s), capped at a small N
 * (`PRIOR_OBSERVATION_LIMIT` below) by the read path itself. A small,
 * deliberately narrower shape than `observationSchema` -- only what a
 * verifier's "what did this patient result last time" context needs, not
 * the full observation row.
 */
export const priorObservationSchema = z
  .object({
    id: z.uuid(),
    orderedTestId: z.uuid(),
    valueNum: z.number().nullable(),
    valueCode: z.string().nullable(),
    valueText: z.string().nullable(),
    unit: z.string().nullable(),
    flags: z.array(z.string()),
    producedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "PriorObservationDto" });
export type PriorObservation = z.infer<typeof priorObservationSchema>;

/** Exact cap is an implementation detail (proposal §5, not elevated to a §10
 * question) -- enough for a verifier to see a short recent trend without
 * turning this into an unbounded history read. */
export const PRIOR_OBSERVATION_LIMIT = 3;
