import { Message } from 'node-hl7-client';
import { mapOrmToOrderIngest, OrmMappingError } from './orm-mapper';

function ormMessage(overrides: { pid3?: string; obr4?: string }): Message {
  const pid3 = overrides.pid3 ?? 'MRN12345^^^HOSP^MR';
  const obr4 = overrides.obr4 ?? 'GLU^Glucose^L';
  const text = [
    'MSH|^~\\&|EHR|HOSP|LIS|LAB|20260810120000||ORM^O01|MSG00001|P|2.5',
    `PID|1||${pid3}||DOE^JANE^A||19800101|F`,
    'ORC|NW',
    `OBR|1|||${obr4}`,
  ].join('\r');
  return new Message({ text });
}

describe('mapOrmToOrderIngest', () => {
  it('extracts the MRN (PID.3.1) and test code (OBR.4.1) from a real ORM^O01 message', () => {
    const message = ormMessage({});
    const rawMessage = 'raw-text-placeholder';
    const result = mapOrmToOrderIngest(message, rawMessage);
    expect(result).toEqual({
      mrn: 'MRN12345',
      testCode: 'GLU',
      rawMessage,
    });
  });

  it('throws OrmMappingError when PID.3 is missing (malformed, not unmatched)', () => {
    const message = ormMessage({ pid3: '' });
    expect(() => mapOrmToOrderIngest(message, 'raw')).toThrow(OrmMappingError);
  });

  it('throws OrmMappingError when OBR.4 is missing', () => {
    const message = ormMessage({ obr4: '' });
    expect(() => mapOrmToOrderIngest(message, 'raw')).toThrow(OrmMappingError);
  });
});
