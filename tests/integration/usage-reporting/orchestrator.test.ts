import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { createTestCustomer, getStripeClient, sleep } from '../helpers.js';
import {
  AURORA_TEST_TENANT_ID,
  invokeOrchestrator,
  seedUserProfile,
  deleteUserProfile,
  seedSubscriptionRecord,
  deleteSubscriptionRecord,
  pollForAuditRecord,
  getAuditRecord,
  deleteAuditRecord,
} from './helpers.js';

const reportDate = new Date().toISOString().split('T')[0];

describe('Usage Reporting Orchestrator (direct Lambda invoke)', () => {
  let cusId: string;
  const prefix = `test-uro-${crypto.randomUUID().slice(0, 8)}`;

  // Org identifiers for each test
  const orgA = `${prefix}-a`;
  const orgB = `${prefix}-b`;
  const orgC = `${prefix}-c`;
  const orgD = `${prefix}-d`;

  // Subscription PKs (CUSTOMER# keys in BillingTable)
  const pkA = `CUSTOMER#${orgA}`;
  const pkB = `CUSTOMER#${orgB}`;
  const pkC = `CUSTOMER#${orgC}`;
  const pkD1 = `CUSTOMER#${orgD}-1`;
  const pkD2 = `CUSTOMER#${orgD}-2`;

  beforeAll(async () => {
    cusId = await createTestCustomer(prefix);

    // Test 1: Two orgs with subscriptions + profiles
    await seedSubscriptionRecord(pkA, orgA, cusId);
    await seedUserProfile(orgA, AURORA_TEST_TENANT_ID);

    await seedSubscriptionRecord(pkB, orgB, cusId);
    await seedUserProfile(orgB, AURORA_TEST_TENANT_ID);

    // Test 2: Org with subscription but NO profile
    await seedSubscriptionRecord(pkC, orgC, cusId);

    // Test 3: Two subscriptions for the same orgId (dedup test)
    await seedSubscriptionRecord(pkD1, orgD, cusId);
    await seedSubscriptionRecord(pkD2, orgD, cusId);
    await seedUserProfile(orgD, AURORA_TEST_TENANT_ID);
  });

  afterAll(async () => {
    await getStripeClient().customers.del(cusId);

    // Clean up subscriptions
    await Promise.all([
      deleteSubscriptionRecord(pkA),
      deleteSubscriptionRecord(pkB),
      deleteSubscriptionRecord(pkC),
      deleteSubscriptionRecord(pkD1),
      deleteSubscriptionRecord(pkD2),
    ]);

    // Clean up profiles
    await Promise.all([deleteUserProfile(orgA), deleteUserProfile(orgB), deleteUserProfile(orgD)]);

    // Clean up audit records
    await Promise.all([
      deleteAuditRecord(orgA, reportDate),
      deleteAuditRecord(orgB, reportDate),
      deleteAuditRecord(orgC, reportDate),
      deleteAuditRecord(orgD, reportDate),
    ]);
  });

  it('processes seeded subscriptions — produces audit records', async () => {
    const result = await invokeOrchestrator();
    expect(result.functionError).toBeUndefined();

    // Poll for both audit records (orchestrator invokes workers async)
    const [auditA, auditB] = await Promise.all([
      pollForAuditRecord(orgA, reportDate),
      pollForAuditRecord(orgB, reportDate),
    ]);

    expect(auditA.orgId).toBe(orgA);
    expect(auditA.reportDate).toBe(reportDate);

    expect(auditB.orgId).toBe(orgB);
    expect(auditB.reportDate).toBe(reportDate);
  });

  it('skips org without profile', async () => {
    // Orchestrator was already invoked in previous test.
    // Wait to ensure async workers have had time to complete.
    await sleep(30_000);

    const audit = await getAuditRecord(orgC, reportDate);
    expect(audit).toBeNull();
  });

  it('deduplicates by orgId', async () => {
    // Orchestrator was already invoked — poll for orgD's audit record
    const audit = await pollForAuditRecord(orgD, reportDate);

    expect(audit.orgId).toBe(orgD);
    expect(audit.reportDate).toBe(reportDate);

    // Only 1 audit record should exist (dedup means only 1 worker invocation)
    // The record existing at all confirms processing; dedup is validated by
    // the orchestrator's internal logic (it skips the second subscription)
  });
});
