import { and, eq } from 'drizzle-orm';
import {
  createDb,
  organism,
  antimicrobial,
  codeSystemValue,
  interpretMic,
  resolveSusceptibility,
} from '@lis/db';
import { getMicrobiologyCatalog } from '../src/microbiology-catalog/microbiology-catalog.controller';

/**
 * FEAT-051 (docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md,
 * ADR-0045). Proves the real, cited EUCAST v16.0 seed data
 * (db/seed/microbiology-catalog.sql) resolves correctly -- no synthetic
 * fixtures for the breakpoint values themselves (unlike
 * reference-range-resolution.e2e-spec.ts's own "synthetic fixtures"
 * describe block), since this feature's own real, cited data is exactly
 * what's under test. `organism`/`antimicrobial`/`breakpoint_table`/
 * `breakpoint` carry no RLS (ADR-0045) -- no `set_config('app.tenant_id',
 * ...)` needed anywhere in this spec, unlike every other e2e spec in this
 * suite.
 */
describe('Microbiology catalog & breakpoint resolution (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let ecoliId: string;
  let staphAureusId: string;
  let ampicillinId: string;
  let meropenemId: string;
  let ciprofloxacinId: string;
  let vancomycinId: string;

  beforeAll(async () => {
    const [ecoli] = await db
      .select({ id: organism.id })
      .from(organism)
      .innerJoin(
        codeSystemValue,
        eq(organism.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'SNOMED'),
          eq(codeSystemValue.code, '112283007'),
        ),
      );
    if (!ecoli) {
      throw new Error(
        'microbiology-catalog seed data (E. coli, SNOMED 112283007) not found -- run `pnpm db:reset` first',
      );
    }
    ecoliId = ecoli.id;

    const [staphAureus] = await db
      .select({ id: organism.id })
      .from(organism)
      .innerJoin(
        codeSystemValue,
        eq(organism.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'SNOMED'),
          eq(codeSystemValue.code, '3092008'),
        ),
      );
    staphAureusId = staphAureus.id;

    async function antimicrobialIdByAtc(atcCode: string): Promise<string> {
      const [row] = await db
        .select({ id: antimicrobial.id })
        .from(antimicrobial)
        .innerJoin(
          codeSystemValue,
          eq(antimicrobial.codeSystemValueId, codeSystemValue.id),
        )
        .where(
          and(
            eq(codeSystemValue.system, 'ATC'),
            eq(codeSystemValue.code, atcCode),
          ),
        );
      if (!row) {
        throw new Error(
          `microbiology-catalog seed data (ATC ${atcCode}) not found`,
        );
      }
      return row.id;
    }
    ampicillinId = await antimicrobialIdByAtc('J01CA01');
    meropenemId = await antimicrobialIdByAtc('J01DH02');
    ciprofloxacinId = await antimicrobialIdByAtc('J01MA02');
    vancomycinId = await antimicrobialIdByAtc('J01XA01');
  });

  it('interpretMic: pure S/I/R logic at and around each real threshold', () => {
    // Enterobacterales/Ampicillin: S<=8, R>8 (EUCAST v16.0 p.13)
    expect(interpretMic(8, 8, 8)).toBe('S');
    expect(interpretMic(8.01, 8, 8)).toBe('R');
    // Enterobacterales/Meropenem: S<=2, R>8 (p.15) -- real gap between S and R
    expect(interpretMic(2, 2, 8)).toBe('S');
    expect(interpretMic(4, 2, 8)).toBe('I');
    expect(interpretMic(8.01, 2, 8)).toBe('R');
  });

  it('getMicrobiologyCatalog returns the real seeded organisms/antimicrobials/breakpoint table/breakpoints', async () => {
    const catalog = await getMicrobiologyCatalog(db);

    const ecoliRow = catalog.organisms.find(
      (o) => o.snomedCode === '112283007',
    );
    expect(ecoliRow).toMatchObject({ display: 'Escherichia coli' });

    const vancoRow = catalog.antimicrobials.find(
      (a) => a.atcCode === 'J01XA01',
    );
    expect(vancoRow).toMatchObject({ display: 'Vancomycin' });

    const eucastTable = catalog.breakpointTables.find(
      (t) => t.publisher === 'EUCAST' && t.version === '16.0',
    );
    expect(eucastTable).toBeDefined();
    expect(eucastTable?.sourceUrl).toContain('eucast.org');

    expect(catalog.breakpoints.length).toBeGreaterThanOrEqual(4);
  });

  it('resolveSusceptibility: E. coli + Ampicillin, a real MIC of 16 mg/L resolves Resistant against the real EUCAST breakpoint', async () => {
    const result = await resolveSusceptibility(db, {
      organismId: ecoliId,
      antimicrobialId: ampicillinId,
      method: 'MIC',
      micValue: 16,
    });
    expect(result).toMatchObject({ matched: true, interpretation: 'R' });
  });

  it('resolveSusceptibility: E. coli + Meropenem, a real MIC of 1 mg/L resolves Susceptible', async () => {
    const result = await resolveSusceptibility(db, {
      organismId: ecoliId,
      antimicrobialId: meropenemId,
      method: 'MIC',
      micValue: 1,
    });
    expect(result).toMatchObject({ matched: true, interpretation: 'S' });
  });

  it('resolveSusceptibility: E. coli + Ciprofloxacin, a real MIC of 0.375 mg/L (between S and R) resolves Intermediate', async () => {
    const result = await resolveSusceptibility(db, {
      organismId: ecoliId,
      antimicrobialId: ciprofloxacinId,
      method: 'MIC',
      micValue: 0.375,
    });
    expect(result).toMatchObject({ matched: true, interpretation: 'I' });
  });

  it('resolveSusceptibility: S. aureus + Vancomycin, a real MIC of 1 mg/L resolves Susceptible', async () => {
    const result = await resolveSusceptibility(db, {
      organismId: staphAureusId,
      antimicrobialId: vancomycinId,
      method: 'MIC',
      micValue: 1,
    });
    expect(result).toMatchObject({ matched: true, interpretation: 'S' });
  });

  it('returns {matched: false} for an organism/antimicrobial pair with no configured breakpoint (E. coli + Vancomycin)', async () => {
    const result = await resolveSusceptibility(db, {
      organismId: ecoliId,
      antimicrobialId: vancomycinId,
      method: 'MIC',
      micValue: 1,
    });
    expect(result).toEqual({ matched: false });
  });

  it("returns {matched: false} when resolved before the breakpoint table's own effective_from (2026-01-01) -- proves effective-dating is real, not decorative", async () => {
    const result = await resolveSusceptibility(db, {
      organismId: ecoliId,
      antimicrobialId: ampicillinId,
      method: 'MIC',
      micValue: 4,
      at: new Date('2025-01-01T00:00:00Z'),
    });
    expect(result).toEqual({ matched: false });
  });
});
