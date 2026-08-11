import type {
  PaymentChargeInput,
  PaymentChargeResult,
  PaymentProvider,
} from '../payment-provider.interface';

/**
 * The only provider this repo ships until a real mobile-money vendor/
 * target market is decided (ADR-0041, mirroring ADR-0037/FEAT-041's own
 * stub-provider precedent). Deterministic, no network call -- proves the
 * charge -> status-update mechanism without a real vendor dependency this
 * feature doesn't need. Always succeeds; a real provider's own failure
 * modes (declined, timeout, webhook retry) are explicitly not simulated
 * here -- see the approved proposal's §6 Risks.
 */
export class StubMobileMoneyProvider implements PaymentProvider {
  readonly providerId = 'stub-mobile-money';

  charge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    return Promise.resolve({
      providerReference: `stub-${Date.now()}-${input.invoiceId.slice(0, 8)}`,
      status: 'succeeded',
    });
  }
}
