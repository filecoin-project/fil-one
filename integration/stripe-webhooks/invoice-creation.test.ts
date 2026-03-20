import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  createTestCustomer,
  attachValidCard,
  seedBillingRecord,
  createAndPayInvoice,
  waitForWebhook,
  getBillingRecord,
  deleteBillingRecord,
  stripe,
  randomId,
} from './helpers.js';

describe('Invoice Creation (invoice.payment_succeeded)', () => {
  let userId: string;
  let cusId: string;

  beforeAll(async () => {
    userId = `test-ic-${randomId()}`;
    cusId = await createTestCustomer(userId);
    await attachValidCard(cusId);
    await seedBillingRecord(userId, cusId, 'past_due', {
      lastPaymentFailedAt: { S: '2024-01-01T00:00:00Z' },
    });
  });

  afterAll(async () => {
    await stripe()
      .customers.del(cusId)
      .catch(() => {});
    await deleteBillingRecord(userId);
  });

  it('should set status to active and clear failure fields', async () => {
    await createAndPayInvoice(cusId);
    await waitForWebhook(15);
    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe('active');
    expect(record!.lastPaymentAt?.S).toBeTruthy();
    expect(record!.lastPaymentFailedAt).toBeUndefined();
    expect(record!.gracePeriodEndsAt).toBeUndefined();
  });
});
