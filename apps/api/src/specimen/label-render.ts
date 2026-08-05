import bwipjs from 'bwip-js';

/**
 * TASK-046 (FEAT-013 revision §2/§5/§10 Q1/Q4). The only file in this task
 * that imports `bwip-js` — both symbologies encode the same payload, the
 * specimen's own accession number, per KB-24's identifier decision
 * ("Accession-based... opaque, privacy-friendly, stable handle") and its
 * PHI-minimization default. No patient identifier, order id, or test name
 * is ever passed in here.
 *
 * `bcid: 'code128'` (1D, tubes/standard containers) and `bcid: 'datamatrix'`
 * (2D, space-constrained surfaces) per KB-24's symbology-to-surface mapping
 * — plain Data Matrix, not `gs1datamatrix`, since no GS1 compliance
 * requirement is named anywhere in this repo's KB or issues.
 */
export function renderSpecimenLabel(accessionNumber: string): {
  code128Svg: string;
  dataMatrixSvg: string;
} {
  const code128Svg = bwipjs.toSVG({
    bcid: 'code128',
    text: accessionNumber,
    includetext: true,
    textxalign: 'center',
  });
  const dataMatrixSvg = bwipjs.toSVG({
    bcid: 'datamatrix',
    text: accessionNumber,
  });
  return { code128Svg, dataMatrixSvg };
}
