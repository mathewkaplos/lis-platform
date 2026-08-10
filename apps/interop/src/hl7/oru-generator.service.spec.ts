import type { InteropOruData } from '@lis/domain';
import type { InteropAuthService } from '../auth/interop-auth.service';
import { OruGeneratorService } from './oru-generator.service';

function oruData(): InteropOruData {
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
  };
}

describe('OruGeneratorService.generate', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches oru-data with a bearer token and returns a real built ORU', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    global.fetch = (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedAuth = (init.headers as Record<string, string>).Authorization;
      return Promise.resolve(
        new Response(JSON.stringify(oruData()), { status: 200 }),
      );
    };
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as InteropAuthService;

    const service = new OruGeneratorService(auth);
    const oru = await service.generate('obs-123');

    expect(capturedUrl).toBe(
      'http://localhost:4000/internal/interop/observations/obs-123/oru-data',
    );
    expect(capturedAuth).toBe('Bearer test-token');
    expect(oru).toContain('ORU^R01');
    expect(oru).toContain('2345-7');
  });

  it('invalidates the cached token and throws on a 401', async () => {
    global.fetch = () =>
      Promise.resolve(new Response('unauthorized', { status: 401 }));
    let invalidated = false;
    const auth = {
      getToken: () => Promise.resolve('stale-token'),
      invalidate: () => {
        invalidated = true;
      },
    } as unknown as InteropAuthService;

    const service = new OruGeneratorService(auth);
    await expect(service.generate('obs-123')).rejects.toThrow();
    expect(invalidated).toBe(true);
  });

  it('throws with the response body on any other non-OK status', async () => {
    global.fetch = () =>
      Promise.resolve(new Response('not verified yet', { status: 409 }));
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as InteropAuthService;

    const service = new OruGeneratorService(auth);
    await expect(service.generate('obs-123')).rejects.toThrow(
      /409.*not verified yet/,
    );
  });
});
