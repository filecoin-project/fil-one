import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  createTestCustomer,
  attachDecliningCard,
  seedBillingRecord,
  createAndFailInvoice,
  deleteBillingRecord,
  getStripeClient,
  pollForBillingStatus,
  pollForPaymentMethod,
} from './helpers.js';

describe('Payment Failure (invoice.payment_failed)', () => {
  let userId: string;
  let cusId: string;
  let paymentMethodId: string;

  beforeAll(async () => {
    userId = `test-pf-${crypto.randomUUID()}`;
    cusId = await createTestCustomer(userId);
    await seedBillingRecord(userId, cusId, 'active');
    paymentMethodId = await attachDecliningCard(cusId);
  });

  afterAll(async () => {
    await getStripeClient().customers.del(cusId);
    await deleteBillingRecord(userId);
  });

  it('should set status to past_due and record failure timestamp', async () => {
    await pollForPaymentMethod(userId, paymentMethodId);
    await createAndFailInvoice(cusId);
    const record = await pollForBillingStatus(userId, 'past_due', 'active');
    expect(record).toStrictEqual({
      pk: { S: `CUSTOMER#${userId}` },
      sk: { S: 'SUBSCRIPTION' },
      orgId: { S: 'test-org' },
      stripeCustomerId: { S: cusId },
      subscriptionStatus: { S: 'past_due' },
      updatedAt: { S: expect.any(String) },
      lastPaymentFailedAt: { S: expect.any(String) },
      paymentMethodBrand: { S: 'visa' },
      paymentMethodId: { S: expect.any(String) },
      paymentMethodLast4: { S: '0341' }, // last4 numbers for declined after attach test card
      paymentMethodExpYear: { N: expect.any(String) },
      paymentMethodExpMonth: { N: expect.any(String) },
    });
  });
});
