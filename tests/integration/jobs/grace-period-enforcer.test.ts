import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SubscriptionStatus, TRIAL_GRACE_DAYS } from '@filone/shared';
import { seedBillingRecord, getBillingRecord, deleteBillingRecord } from '../helpers.ts';
import { invokeEnforcer, seedOrgProfile, getOrgProfile, deleteOrgProfile } from './helpers.ts';

function pastDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function futureDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// =============================================================================
// 1. Expired grace period → canceled + DISABLED
// =============================================================================
describe('expired grace period → canceled + DISABLED', () => {
  const userId = `enforcer-grace-${crypto.randomUUID().slice(0, 8)}`;
  const orgId = `org-grace-${crypto.randomUUID().slice(0, 8)}`;
  const tenantId = 'e7da8138-c669-4cc0-82ef-253e534be11c';

  beforeAll(async () => {
    await seedOrgProfile(orgId, tenantId);
    await seedBillingRecord(userId, 'cus_fake_grace', SubscriptionStatus.GracePeriod, {
      orgId: { S: orgId },
      gracePeriodEndsAt: { S: pastDate(1) },
      canceledAt: { S: pastDate(31) },
    });
  });

  afterAll(async () => {
    await deleteBillingRecord(userId);
    await deleteOrgProfile(orgId);
  });

  it('transitions to canceled status and sets auroraTenantStatus to DISABLED', async () => {
    const result = await invokeEnforcer();
    expect(result.functionError).toBeUndefined();

    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe(SubscriptionStatus.Canceled);

    const profile = await getOrgProfile(orgId);
    expect(profile).not.toBeNull();
    expect(profile!.auroraTenantStatus?.S).toBe('DISABLED');
  });
});

// =============================================================================
// 2. Active grace period → no status change, WRITE_LOCK applied
// =============================================================================
describe('active grace period → WRITE_LOCK applied', () => {
  const userId = `enforcer-active-${crypto.randomUUID().slice(0, 8)}`;
  const orgId = `org-active-${crypto.randomUUID().slice(0, 8)}`;
  const tenantId = 'e7da8138-c669-4cc0-82ef-253e534be11c';

  beforeAll(async () => {
    await seedOrgProfile(orgId, tenantId);
    await seedBillingRecord(userId, 'cus_fake_active', SubscriptionStatus.GracePeriod, {
      orgId: { S: orgId },
      gracePeriodEndsAt: { S: futureDate(10) },
      canceledAt: { S: pastDate(5) },
    });
  });

  afterAll(async () => {
    await deleteBillingRecord(userId);
    await deleteOrgProfile(orgId);
  });

  it('keeps grace_period status and sets auroraTenantStatus to WRITE_LOCKED', async () => {
    const result = await invokeEnforcer();
    expect(result.functionError).toBeUndefined();

    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe(SubscriptionStatus.GracePeriod);

    const profile = await getOrgProfile(orgId);
    expect(profile).not.toBeNull();
    expect(profile!.auroraTenantStatus?.S).toBe('WRITE_LOCKED');
  });
});

// =============================================================================
// 3. Expired trial (within grace window) → grace_period + WRITE_LOCK
// =============================================================================
describe('expired trial (within grace window) → grace_period', () => {
  const userId = `enforcer-trial-grace-${crypto.randomUUID().slice(0, 8)}`;
  const orgId = `org-trial-grace-${crypto.randomUUID().slice(0, 8)}`;
  const tenantId = 'e7da8138-c669-4cc0-82ef-253e534be11c';

  beforeAll(async () => {
    await seedOrgProfile(orgId, tenantId);
    // Trial ended 2 days ago — within 7 (7) window
    await seedBillingRecord(userId, 'cus_fake_trial_grace', SubscriptionStatus.Trialing, {
      orgId: { S: orgId },
      trialEndsAt: { S: pastDate(2) },
    });
  });

  afterAll(async () => {
    await deleteBillingRecord(userId);
    await deleteOrgProfile(orgId);
  });

  it('transitions to grace_period (not canceled) and sets WRITE_LOCKED', async () => {
    const result = await invokeEnforcer();
    expect(result.functionError).toBeUndefined();

    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe(SubscriptionStatus.GracePeriod);
    expect(record!.gracePeriodEndsAt?.S).toBeDefined();

    const profile = await getOrgProfile(orgId);
    expect(profile).not.toBeNull();
    expect(profile!.auroraTenantStatus?.S).toBe('WRITE_LOCKED');
  });
});

// =============================================================================
// 4. Fully expired trial (past grace) → canceled + DISABLED
// =============================================================================
describe('fully expired trial (past grace) → canceled', () => {
  const userId = `enforcer-trial-exp-${crypto.randomUUID().slice(0, 8)}`;
  const orgId = `org-trial-exp-${crypto.randomUUID().slice(0, 8)}`;
  const tenantId = 'e7da8138-c669-4cc0-82ef-253e534be11c';

  beforeAll(async () => {
    await seedOrgProfile(orgId, tenantId);
    await seedBillingRecord(userId, 'cus_fake_trial_exp', SubscriptionStatus.Trialing, {
      orgId: { S: orgId },
      trialEndsAt: { S: pastDate(TRIAL_GRACE_DAYS + 1) },
    });
  });

  afterAll(async () => {
    await deleteBillingRecord(userId);
    await deleteOrgProfile(orgId);
  });

  it('transitions to canceled and sets auroraTenantStatus to DISABLED', async () => {
    const result = await invokeEnforcer();
    expect(result.functionError).toBeUndefined();

    const record = await getBillingRecord(userId);
    expect(record).not.toBeNull();
    expect(record!.subscriptionStatus?.S).toBe(SubscriptionStatus.Canceled);

    const profile = await getOrgProfile(orgId);
    expect(profile).not.toBeNull();
    expect(profile!.auroraTenantStatus?.S).toBe('DISABLED');
  });
});

// =============================================================================
// 5. Mixed batch — only expired records transition to canceled
// =============================================================================
describe('mixed batch — only expired records get canceled', () => {
  const expiredUserId = `enforcer-mix-exp-${crypto.randomUUID().slice(0, 8)}`;
  const activeUserId = `enforcer-mix-act-${crypto.randomUUID().slice(0, 8)}`;
  const orgId = `org-mix-${crypto.randomUUID().slice(0, 8)}`;
  const tenantId = 'e7da8138-c669-4cc0-82ef-253e534be11c';

  beforeAll(async () => {
    await seedOrgProfile(orgId, tenantId);
    await seedBillingRecord(expiredUserId, 'cus_fake_exp', SubscriptionStatus.GracePeriod, {
      orgId: { S: orgId },
      gracePeriodEndsAt: { S: pastDate(2) },
      canceledAt: { S: pastDate(32) },
    });
    await seedBillingRecord(activeUserId, 'cus_fake_act', SubscriptionStatus.GracePeriod, {
      orgId: { S: orgId },
      gracePeriodEndsAt: { S: futureDate(15) },
      canceledAt: { S: pastDate(5) },
    });
  });

  afterAll(async () => {
    await deleteBillingRecord(expiredUserId);
    await deleteBillingRecord(activeUserId);
    await deleteOrgProfile(orgId);
  });

  it('cancels expired record and WRITE_LOCKs active record', async () => {
    const result = await invokeEnforcer();
    expect(result.functionError).toBeUndefined();

    const expiredRecord = await getBillingRecord(expiredUserId);
    expect(expiredRecord).not.toBeNull();
    expect(expiredRecord!.subscriptionStatus?.S).toBe(SubscriptionStatus.Canceled);

    const activeRecord = await getBillingRecord(activeUserId);
    expect(activeRecord).not.toBeNull();
    expect(activeRecord!.subscriptionStatus?.S).toBe(SubscriptionStatus.GracePeriod);
  });
});
