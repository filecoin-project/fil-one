import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  createTestCustomer,
  attachValidCard,
  seedBillingRecord,
  getBillingRecord,
  deleteBillingRecord,
  getStripeClient,
  pollForPaymentMethod,
} from './helpers.js';

describe('Payment Method Update (customer.updated)', () => {
  let userId: string;
  let cusId: string;
  let firstPmId: string;

  beforeAll(async () => {
    userId = `test-pmu-${crypto.randomUUID()}`;
    cusId = await createTestCustomer(userId);
    await seedBillingRecord(userId, cusId, 'active');
    firstPmId = await attachValidCard(cusId);
  });

  afterAll(async () => {
    await getStripeClient().customers.del(cusId);
    await deleteBillingRecord(userId);
  });

  it('should sync new payment method last4 after customer portal card update', async () => {
    const stripe = getStripeClient();

    // Wait for initial customer.updated webhook (from attachValidCard in beforeAll)
    // to finish processing — the webhook adds paymentMethodExpYear which wasn't in the seed.
    await pollForPaymentMethod(userId, firstPmId);

    // Attach a second card (Mastercard) and set as default
    const newPm = await stripe.paymentMethods.attach('pm_card_mastercard', {
      customer: cusId,
    });
    await stripe.customers.update(cusId, {
      invoice_settings: { default_payment_method: newPm.id },
    });

    // Wait for customer.updated webhook to process the new payment method
    await pollForPaymentMethod(userId, newPm.id);

    const record = await getBillingRecord(userId);
    expect(record).toBeTruthy();
    expect(record!.paymentMethodId?.S).toBe(newPm.id);
    expect(record!.paymentMethodLast4?.S).toBe('4444');
    expect(record!.paymentMethodBrand?.S).toBe('mastercard');
  });
});
