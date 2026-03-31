import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  createTestCustomer,
  attachValidCard,
  seedBillingRecord,
  createAndPayInvoice,
  deleteBillingRecord,
  getStripeClient,
  pollForBillingStatus,
  pollForPaymentMethod,
} from './helpers.js';

describe('Invoice Creation (invoice.payment_succeeded)', () => {
  let userId: string;
  let cusId: string;
  let paymentMethodId: string;

  beforeAll(async () => {
    userId = `test-ic-${crypto.randomUUID()}`;
    cusId = await createTestCustomer(userId);
    await seedBillingRecord(userId, cusId, 'past_due', {
      lastPaymentFailedAt: { S: '2024-01-01T00:00:00Z' },
    });
    paymentMethodId = await attachValidCard(cusId);
  });

  afterAll(async () => {
    await getStripeClient().customers.del(cusId);
    await deleteBillingRecord(userId);
  });

  it('should set status to active and clear failure fields', async () => {
    await pollForPaymentMethod(userId, paymentMethodId);
    await createAndPayInvoice(cusId);
    const record = await pollForBillingStatus(userId, 'active', 'past_due');
    expect(record).toStrictEqual({
      pk: { S: `CUSTOMER#${userId}` },
      sk: { S: 'SUBSCRIPTION' },
      orgId: { S: 'test-org' },
      stripeCustomerId: { S: cusId },
      subscriptionStatus: { S: 'active' },
      updatedAt: { S: expect.any(String) },
      lastPaymentAt: { S: expect.any(String) },
      paymentMethodBrand: { S: 'visa' },
      paymentMethodId: { S: expect.any(String) },
      paymentMethodLast4: { S: '4242' },
      paymentMethodExpYear: { N: expect.any(String) },
      paymentMethodExpMonth: { N: expect.any(String) },
    });
  });
});
