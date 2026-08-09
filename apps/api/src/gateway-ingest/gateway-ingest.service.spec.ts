import { GatewayIngestService } from './gateway-ingest.service';

describe('GatewayIngestService', () => {
  it('is not a duplicate the first time a key is seen', () => {
    const svc = new GatewayIngestService();
    expect(svc.isDuplicate('k1')).toBe(false);
    svc.record('k1');
    expect(svc.isDuplicate('k1')).toBe(true);
  });

  it('recording the same key twice is idempotent', () => {
    const svc = new GatewayIngestService();
    svc.record('k1');
    svc.record('k1');
    expect(svc.isDuplicate('k1')).toBe(true);
  });

  it('distinct keys do not collide', () => {
    const svc = new GatewayIngestService();
    svc.record('k1');
    expect(svc.isDuplicate('k2')).toBe(false);
  });
});
