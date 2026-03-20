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
} from './helpers.js';

describe('Grace Period Recovery (invoice.payment_succeeded)', () => {
  let userId: string;
  let cusId: string;

  beforeAll(async () => {
    userId = `test-gpr-${crypto.randomUUID()}`;
    cusId = await createTestCustomer(userId);
    await attachValidCard(cusId);

    const graceEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const canceledAt = new Date().toISOString();
    await seedBillingRecord(userId, cusId, 'grace_period', {
      gracePeriodEndsAt: { S: graceEnd },
      canceledAt: { S: canceledAt },
    });
  });

  afterAll(async () => {
    await stripe()
      .customers.del(cusId)
      .catch(() => {});
    await deleteBillingRecord(userId);
  });

  it('should restore status to active and clear grace period fields', async () => {
    await createAndPayInvoice(cusId);
    await waitForWebhook(15);
    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe('active');
    expect(record!.lastPaymentAt?.S).toBeTruthy();
    expect(record!.gracePeriodEndsAt).toBeUndefined();
    expect(record!.canceledAt).toBeUndefined();
    expect(record!.lastPaymentFailedAt).toBeUndefined();
  });
});
