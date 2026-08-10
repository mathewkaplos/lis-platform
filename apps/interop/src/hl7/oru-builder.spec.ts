import type { InteropOruData } from '@lis/domain';
import { Message } from 'node-hl7-client';
import { buildOru } from './oru-builder';

function oruData(overrides: Partial<InteropOruData> = {}): InteropOruData {
  return {
    patientMrn: 'MRN12345',
    patientFirstName: 'Jane',
    patientLastName: 'Doe',
    analyteCode: '2345-7',
    analyteDisplay: 'Glucose',
    value: '90',
    unit: 'mg/dL',
    refLow: 70,
    refHigh: 99,
    flags: ['N'],
    verifiedAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildOru', () => {
  it('produces a real ORU^R01 message carrying the LOINC code/value/unit/range/flag in OBX-3/5/6/7/8 (KB-30)', () => {
    const text = buildOru(oruData());
    const message = new Message({ text });

    expect(message.get('MSH.9.1').toString()).toBe('ORU');
    expect(message.get('MSH.9.2').toString()).toBe('R01');
    expect(message.get('PID.3').toString()).toBe('MRN12345');
    expect(message.get('PID.5.1').toString()).toBe('Doe');
    expect(message.get('PID.5.2').toString()).toBe('Jane');
    expect(message.get('OBX.3.1').toString()).toBe('2345-7');
    expect(message.get('OBX.3.2').toString()).toBe('Glucose');
    expect(message.get('OBX.5').toString()).toBe('90');
    expect(message.get('OBX.6').toString()).toBe('mg/dL');
    expect(message.get('OBX.7').toString()).toBe('70-99');
    expect(message.get('OBX.8').toString()).toBe('N');
    expect(message.get('OBX.11').toString()).toBe('F');
  });

  it('joins more than one simultaneous flag with the HL7 repetition separator (KB-14: severity + delta)', () => {
    const text = buildOru(oruData({ flags: ['H', 'D'] }));
    // The raw wire format carries both repetitions verbatim ("H~D") --
    // confirmed directly against a real serialized message. `.get(...)`
    // alone reads back only the first repetition; `.toArray()` is this
    // library's own way to read every repetition of a field back out.
    expect(text).toContain('H~D');
    const message = new Message({ text });
    expect(
      message
        .get('OBX.8')
        .toArray()
        .map((n) => n.toString()),
    ).toEqual(['H', 'D']);
  });

  it('omits OBX-8 entirely when there is no flag', () => {
    const text = buildOru(oruData({ flags: [] }));
    const message = new Message({ text });
    expect(message.get('OBX.8').toString()).toBe('');
  });

  it('renders a one-sided reference range (only a critical-low threshold, no upper bound)', () => {
    const text = buildOru(oruData({ refLow: null, refHigh: 40 }));
    const message = new Message({ text });
    expect(message.get('OBX.7').toString()).toBe('40');
  });

  it('renders an empty reference range when neither bound is set', () => {
    const text = buildOru(oruData({ refLow: null, refHigh: null }));
    const message = new Message({ text });
    expect(message.get('OBX.7').toString()).toBe('');
  });
});
