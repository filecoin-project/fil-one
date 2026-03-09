import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, ScanCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sst', () => ({
  Resource: {
    BillingTable: { name: 'BillingTable' },
    UserInfoTable: { name: 'UserInfoTable' },
  },
}));

vi.stubEnv('USAGE_WORKER_FUNCTION_NAME', 'usage-worker-fn');

const ddbMock = mockClient(DynamoDBClient);
const lambdaMock = mockClient(LambdaClient);

import { handler } from './usage-reporting-orchestrator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subscriptionItem(userId: string, extra: Record<string, unknown> = {}) {
  return marshall({
    pk: `CUSTOMER#${userId}`,
    sk: 'SUBSCRIPTION',
    subscriptionId: `sub_${userId}`,
    stripeCustomerId: `cus_${userId}`,
    subscriptionStatus: 'active',
    currentPeriodStart: '2024-01-01T00:00:00Z',
    ...extra,
  }, { removeUndefinedValues: true });
}

function profileItem(userId: string, orgId: string) {
  return marshall({
    pk: `USER#${userId}`,
    sk: 'PROFILE',
    orgId,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usage-reporting-orchestrator', () => {
  beforeEach(() => {
    ddbMock.reset();
    lambdaMock.reset();
    vi.clearAllMocks();
  });

  it('does nothing when no active subscriptions', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    await handler();

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('invokes worker for a single tenant', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [subscriptionItem('user-1')] });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: { UserInfoTable: [profileItem('user-1', 'org-1')] },
    });
    lambdaMock.on(InvokeCommand).resolves({});

    await handler();

    const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
    expect(invokeCalls).toHaveLength(1);
    const payload = JSON.parse(Buffer.from(invokeCalls[0].args[0].input.Payload as Uint8Array).toString());
    expect(payload.userId).toBe('user-1');
    expect(payload.orgId).toBe('org-1');
    expect(payload.subscriptionId).toBe('sub_user-1');
  });

  it('invokes worker for multiple tenants', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [subscriptionItem('user-1'), subscriptionItem('user-2')],
    });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        UserInfoTable: [profileItem('user-1', 'org-1'), profileItem('user-2', 'org-2')],
      },
    });
    lambdaMock.on(InvokeCommand).resolves({});

    await handler();

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(2);
  });

  it('handles paginated scan', async () => {
    ddbMock.on(ScanCommand)
      .resolvesOnce({
        Items: [subscriptionItem('user-1')],
        LastEvaluatedKey: marshall({ pk: 'CUSTOMER#user-1', sk: 'SUBSCRIPTION' }),
      })
      .resolvesOnce({
        Items: [subscriptionItem('user-2')],
      });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        UserInfoTable: [profileItem('user-1', 'org-1'), profileItem('user-2', 'org-2')],
      },
    });
    lambdaMock.on(InvokeCommand).resolves({});

    await handler();

    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(2);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(2);
  });

  it('skips tenant with missing orgId', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [subscriptionItem('user-1')] });
    ddbMock.on(BatchGetItemCommand).resolves({ Responses: { UserInfoTable: [] } });
    lambdaMock.on(InvokeCommand).resolves({});

    await handler();

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('skips tenant with missing currentPeriodStart', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [subscriptionItem('user-1', { currentPeriodStart: undefined })],
    });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: { UserInfoTable: [profileItem('user-1', 'org-1')] },
    });
    lambdaMock.on(InvokeCommand).resolves({});

    await handler();

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('continues when one Lambda invoke fails', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [subscriptionItem('user-1'), subscriptionItem('user-2')],
    });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        UserInfoTable: [profileItem('user-1', 'org-1'), profileItem('user-2', 'org-2')],
      },
    });
    lambdaMock.on(InvokeCommand)
      .rejectsOnce(new Error('invoke failed'))
      .resolves({});

    await handler();

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(2);
  });

  it('deduplicates by orgId — two users same org = one worker invocation', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [subscriptionItem('user-1'), subscriptionItem('user-2')],
    });
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        UserInfoTable: [profileItem('user-1', 'shared-org'), profileItem('user-2', 'shared-org')],
      },
    });
    lambdaMock.on(InvokeCommand).resolves({});

    await handler();

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
    const payload = JSON.parse(Buffer.from(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input.Payload as Uint8Array).toString());
    expect(payload.orgId).toBe('shared-org');
  });
});
