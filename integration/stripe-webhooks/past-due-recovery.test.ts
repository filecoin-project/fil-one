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

describe('Past Due Recovery (invoice.payment_succeeded with canceledAt)', () => {
  let userId: string;
  let cusId: string;

  beforeAll(async () => {
    userId = `test-pdr-${crypto.randomUUID()}`;
    cusId = await createTestCustomer(userId);
    await attachValidCard(cusId);

    const canceledAt = new Date().toISOString();
    await seedBillingRecord(userId, cusId, 'past_due', {
      lastPaymentFailedAt: { S: '2024-01-01T00:00:00Z' },
      canceledAt: { S: canceledAt },
    });
  });

  afterAll(async () => {
    await stripe()
      .customers.del(cusId)
      .catch(() => {});
    await deleteBillingRecord(userId);
  });

  it('should restore status to active and clear all failure/cancel fields', async () => {
    await createAndPayInvoice(cusId);
    await waitForWebhook(15);
    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe('active');
    expect(record!.lastPaymentAt?.S).toBeTruthy();
    expect(record!.lastPaymentFailedAt).toBeUndefined();
    expect(record!.canceledAt).toBeUndefined();
    expect(record!.gracePeriodEndsAt).toBeUndefined();
  });
});
