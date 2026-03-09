import { DynamoDBClient, ScanCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Resource } from 'sst';
import type { UsageReportingWorkerPayload } from './usage-reporting-worker.js';

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});

interface SubscriptionRecord {
  userId: string;
  subscriptionId: string;
  stripeCustomerId: string;
  currentPeriodStart: string;
}

export async function handler(): Promise<void> {
  const billingTableName = Resource.BillingTable.name;
  const userInfoTableName = Resource.UserInfoTable.name;
  const workerFunctionName = process.env.USAGE_WORKER_FUNCTION_NAME!;
  const reportDate = new Date().toISOString().split('T')[0];

  console.log('[usage-orchestrator] Starting usage reporting', { reportDate });

  // Step 1: Scan for active/trialing subscriptions
  const records: SubscriptionRecord[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: billingTableName,
        FilterExpression: 'sk = :sk AND subscriptionStatus IN (:active, :trialing) AND attribute_exists(subscriptionId)',
        ExpressionAttributeValues: {
          ':sk': { S: 'SUBSCRIPTION' },
          ':active': { S: 'active' },
          ':trialing': { S: 'trialing' },
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      }),
    );

    for (const item of result.Items ?? []) {
      const record = unmarshall(item);
      const userId = (record.pk as string).replace('CUSTOMER#', '');

      if (!record.currentPeriodStart) {
        console.warn('[usage-orchestrator] Missing currentPeriodStart, skipping', { userId });
        continue;
      }

      records.push({
        userId,
        subscriptionId: record.subscriptionId as string,
        stripeCustomerId: record.stripeCustomerId as string,
        currentPeriodStart: record.currentPeriodStart as string,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('[usage-orchestrator] Found subscriptions', { count: records.length });

  if (records.length === 0) return;

  // Step 2: Batch resolve orgIds from UserInfoTable
  const userOrgMap = new Map<string, string>();
  const userIds = records.map((r) => r.userId);

  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    const keys = batch.map((uid) => ({
      pk: { S: `USER#${uid}` },
      sk: { S: 'PROFILE' },
    }));

    let unprocessedKeys: typeof keys | undefined = keys;
    let retryCount = 0;

    while (unprocessedKeys && unprocessedKeys.length > 0 && retryCount < 3) {
      const batchResult = await dynamo.send(
        new BatchGetItemCommand({
          RequestItems: {
            [userInfoTableName]: { Keys: unprocessedKeys },
          },
        }),
      );

      for (const item of batchResult.Responses?.[userInfoTableName] ?? []) {
        const profile = unmarshall(item);
        const uid = (profile.pk as string).replace('USER#', '');
        if (profile.orgId) {
          userOrgMap.set(uid, profile.orgId as string);
        }
      }

      const remaining = batchResult.UnprocessedKeys?.[userInfoTableName]?.Keys;
      unprocessedKeys = remaining as typeof keys | undefined;
      if (unprocessedKeys && unprocessedKeys.length > 0) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      }
    }
  }

  // Step 3: Build payloads, deduplicate by orgId
  const orgSeen = new Set<string>();
  const payloads: UsageReportingWorkerPayload[] = [];
  let skippedNoOrg = 0;
  let skippedDuplicate = 0;

  for (const record of records) {
    const orgId = userOrgMap.get(record.userId);
    if (!orgId) {
      console.warn('[usage-orchestrator] No orgId found, skipping', { userId: record.userId });
      skippedNoOrg++;
      continue;
    }

    if (orgSeen.has(orgId)) {
      skippedDuplicate++;
      continue;
    }
    orgSeen.add(orgId);

    payloads.push({
      userId: record.userId,
      orgId,
      subscriptionId: record.subscriptionId,
      stripeCustomerId: record.stripeCustomerId,
      currentPeriodStart: record.currentPeriodStart,
      reportDate,
    });
  }

  // Step 4: Invoke workers
  let invoked = 0;
  let failed = 0;

  for (const payload of payloads) {
    try {
      await lambda.send(
        new InvokeCommand({
          FunctionName: workerFunctionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
      );
      invoked++;
    } catch (error) {
      failed++;
      console.error('[usage-orchestrator] Failed to invoke worker', {
        userId: payload.userId,
        orgId: payload.orgId,
        error: (error as Error).message,
      });
    }
  }

  console.log('[usage-orchestrator] Complete', {
    totalSubscriptions: records.length,
    uniqueOrgs: payloads.length,
    invoked,
    failed,
    skippedNoOrg,
    skippedDuplicate,
  });
}
