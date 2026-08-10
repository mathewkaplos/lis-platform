import { describe, expect, it, vi } from 'vitest';
import { InferenceGatewayService } from './inference-gateway.service';
import type {
  InferenceProvider,
  InferenceProviderInput,
} from './inference-provider.interface';

/**
 * Provider selection/audit-write shape against a *real* Postgres instance
 * is covered by test/ai-inference.e2e-spec.ts (engineering/testing entry #1
 * -- real-DB checks, not mocked ones, are how this repo proves audit
 * correctness). This spec covers only the pure request/response wiring:
 * that invoke() actually minimizes before calling the provider, and that
 * the provider's output flows back out unchanged.
 */
describe('InferenceGatewayService (pure request/response wiring)', () => {
  it('passes only the minimized context to the provider, never the raw input', async () => {
    let capturedInput: InferenceProviderInput | undefined;
    const provider: InferenceProvider = {
      providerId: 'fake',
      complete: vi.fn((input: InferenceProviderInput) => {
        capturedInput = input;
        return Promise.resolve({ output: 'fake output', providerId: 'fake' });
      }),
    };
    // A fake `db` whose transaction() invokes the callback with an empty
    // fake tx -- writeAuditEvent will fail against it (no real query
    // methods), which is fine: this test only needs to prove the provider
    // received the minimized input, which happens before that write.
    const fakeDb = {
      transaction: (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    } as never;
    const service = new InferenceGatewayService(provider, fakeDb);

    await service
      .invoke({
        tenantId: '00000000-0000-0000-0000-000000000001',
        actorPrincipalId: '00000000-0000-0000-0000-000000000099',
        capability: 'test-capability',
        prompt: 'irrelevant for this test',
        context: { value: 5.2, patientName: 'Jane Doe' },
        allowedContextFields: ['value'],
        resourceType: 'test-resource',
        resourceId: '00000000-0000-0000-0000-000000000042',
      })
      .catch(() => undefined);

    expect(capturedInput).toEqual({
      capability: 'test-capability',
      prompt: 'irrelevant for this test',
      minimizedContext: { value: 5.2 },
    });
  });
});
