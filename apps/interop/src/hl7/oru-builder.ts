import type { InteropOruData } from '@lis/domain';
import { HL7_2_5 } from 'node-hl7-client';

/**
 * Builds a real ORU^R01 from an already-verified Observation's resolved
 * data (FEAT-036 AC #2, KB-30's OBX-3/5/6/7/8 mapping: analyte code, typed
 * value, unit, reference range, flag). Pure function -- takes the JSON
 * `apps/api`'s `GET /internal/interop/observations/:id/oru-data` route
 * returns, has no knowledge of HTTP/auth/transport itself.
 *
 * v1 scope (mirrors the inbound ORM mapper's own single-OBR
 * simplification): exactly one OBX per message. `analyteCode` is the
 * analyte's real `codeSystemValue.code` (LOINC in this repo's seeded
 * catalog, ADR-0004) -- OBX-3 carries the *system* qualifier too
 * (`^L` for LOINC) per HL7's own CE composite convention, not a bare code.
 *
 * `obx_11` (Result Status) is always `"F"` (Final) -- this function is only
 * ever called for an already-`verified` Observation (enforced by
 * `InteropOruDataService`'s own 409 on anything less), so there is no
 * `"P"` (Preliminary)/other status to distinguish here.
 *
 * `flags` (0 or more of `N`/`L`/`H`/`LL`/`HH`/`D`, this repo's own vocabulary
 * -- confirmed identical to HL7's TABLE_0078) can genuinely be more than one
 * at once (`mergeDeltaFlag` appends `D` alongside a severity flag, KB-14).
 * The typed `buildOBX({ obx_8 })` prop only accepts one `Table0078Value` at
 * a time, so multiple flags are written via `message.set('OBX.8', ...)`
 * after building, joined with `~` (HL7's own repetition separator) --
 * bypassing the single-value table validation deliberately, since this
 * repo's own flag vocabulary is already a confirmed subset of TABLE_0078.
 */
export function buildOru(data: InteropOruData): string {
  const referenceRange =
    data.refLow !== null && data.refHigh !== null
      ? `${data.refLow}-${data.refHigh}`
      : (data.refLow ?? data.refHigh ?? '')?.toString();

  const message = new HL7_2_5()
    .buildMSH({
      msh_3: 'LIS',
      msh_5: 'EHR',
      msh_9_1: 'ORU',
      msh_9_2: 'R01',
      msh_11_1: 'P',
    })
    .buildPID({
      pid_3: data.patientMrn,
      pid_5: `${data.patientLastName}^${data.patientFirstName}`,
    })
    .buildOBR({
      obr_1: '1',
      obr_4: `${data.analyteCode}^${data.analyteDisplay}^L`,
    })
    .buildOBX({
      obx_1: '1',
      obx_2: 'NM',
      obx_3: `${data.analyteCode}^${data.analyteDisplay}^L`,
      obx_5: data.value,
      obx_6: data.unit ?? '',
      obx_7: referenceRange,
      obx_11: 'F',
    })
    .toMessage();

  if (data.flags.length > 0) {
    message.set('OBX.8', data.flags.join('~'));
  }

  return message.toString();
}
