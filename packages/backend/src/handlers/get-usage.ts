import { GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { UsageResponse } from '@filone/shared';
import { Resource } from 'sst';
import { getDynamoClient } from '../lib/ddb-client.js';
import { getAuroraS3Credentials, listObjects } from '../lib/aurora-s3-client.js';
import { isOrgSetupComplete } from '../lib/org-setup-status.js';
import { ResponseBuilder } from '../lib/response-builder.js';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { getUserInfo } from '../lib/user-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';
import type { BucketRecord } from '../lib/dynamo-records.js';

const dynamo = getDynamoClient();

async function baseHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  const { userId, orgId } = getUserInfo(event);
  const uploadsTableName = Resource.UploadsTable.name;

  // 1. Query all buckets
  const bucketsResult = await dynamo.send(
    new QueryCommand({
      TableName: uploadsTableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':skPrefix': { S: 'BUCKET#' },
      },
    }),
  );
  const buckets = (bucketsResult.Items ?? []).map((item) => unmarshall(item) as BucketRecord);

  // 2. Look up org profile for Aurora S3 credentials
  const { Item: orgProfile } = await dynamo.send(
    new GetItemCommand({
      TableName: Resource.UserInfoTable.name,
      Key: { pk: { S: `ORG#${orgId}` }, sk: { S: 'PROFILE' } },
    }),
  );

  const auroraTenantId = orgProfile?.auroraTenantId?.S;
  const setupStatus = orgProfile?.setupStatus?.S;

  // 3. Sum object sizes + count across all buckets via S3
  let storageUsedBytes = 0;
  let objectCount = 0;

  if (buckets.length > 0 && auroraTenantId && isOrgSetupComplete(setupStatus)) {
    const stage = process.env.FILONE_STAGE!;
    const gatewayUrl = process.env.AURORA_S3_GATEWAY_URL!;
    const credentials = await getAuroraS3Credentials(stage, auroraTenantId);

    for (const bucket of buckets) {
      let continuationToken: string | undefined;
      do {
        const result = await listObjects({
          endpointUrl: gatewayUrl,
          credentials,
          bucket: bucket.name,
          continuationToken,
        });
        for (const obj of result.objects) {
          storageUsedBytes += obj.sizeBytes;
          objectCount++;
        }
        continuationToken = result.nextToken;
      } while (continuationToken);
    }
  }

  // 4. Count access keys (stored in UserInfoTable with ORG# pk and ACCESSKEY# sk prefix)
  const keysResult = await dynamo.send(
    new QueryCommand({
      TableName: Resource.UserInfoTable.name,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `ORG#${orgId}` },
        ':skPrefix': { S: 'ACCESSKEY#' },
      },
      Select: 'COUNT',
    }),
  );

  const response: UsageResponse = {
    storage: {
      usedBytes: storageUsedBytes,
    },
    egress: {
      // TODO: implement egress: https://linear.app/filecoin-foundation/issue/FIL-82/get-egress-from-aurora
      usedBytes: 0,
    },
    buckets: {
      count: buckets.length,
      limit: 100,
    },
    objects: {
      count: objectCount,
    },
    accessKeys: {
      count: keysResult.Count ?? 0,
      limit: 300,
    },
  };

  return new ResponseBuilder().status(200).body(response).build();
}

export const handler = middy(baseHandler)
  .use(httpHeaderNormalizer())
  .use(authMiddleware())
  .use(errorHandlerMiddleware());
