export interface PaymentChargeInput {
  invoiceId: string;
  amountCents: number;
  method: 'mobile_money';
  /** e.g. a mobile-money phone number -- opaque to this interface, the
   * provider's own concern how it's used. Never a card number/PIN. */
  reference?: string;
}

export interface PaymentChargeResult {
  providerReference: string;
  status: 'succeeded' | 'failed';
}

/**
 * ADR-0041: the seam a real mobile-money vendor integration would
 * implement. Only a stub ships in this feature -- no real provider
 * account/target market exists yet (mirrors ADR-0037/FEAT-041's own
 * gateway-provider precedent).
 */
export interface PaymentProvider {
  readonly providerId: string;
  charge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
}
