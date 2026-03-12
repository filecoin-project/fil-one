import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { RecentActivityResponse, RecentActivity } from '@filone/shared';
import { Resource } from 'sst';
import { ResponseBuilder } from '../lib/response-builder.js';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { getUserInfo } from '../lib/user-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';
import type { BucketRecord, ObjectRecord } from '../lib/dynamo-records.js';

const dynamo = new DynamoDBClient({});

async function baseHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  const { userId } = getUserInfo(event);
  const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? '10', 10), 50);
  const uploadsTableName = Resource.UploadsTable.name;

  const activities: RecentActivity[] = [];

  // Get buckets
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

  for (const bucket of buckets) {
    activities.push({
      id: `bucket-${bucket.name}`,
      action: 'bucket.created',
      resourceType: 'bucket',
      resourceName: bucket.name,
      timestamp: bucket.createdAt,
    });

    // Get objects for this bucket
    const objectsResult = await dynamo.send(
      new QueryCommand({
        TableName: uploadsTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `BUCKET#${userId}#${bucket.name}` },
          ':skPrefix': { S: 'OBJECT#' },
        },
      }),
    );

    for (const item of objectsResult.Items ?? []) {
      const obj = unmarshall(item) as ObjectRecord;
      activities.push({
        id: `object-${bucket.name}-${obj.key}`,
        action: 'object.uploaded',
        resourceType: 'object',
        resourceName: obj.key,
        timestamp: obj.uploadedAt,
        sizeBytes: obj.sizeBytes || undefined,
        cid: obj.cid || undefined,
      });
    }
  }

  // Most recent first, take top N
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const response: RecentActivityResponse = { activities: activities.slice(0, limit) };
  return new ResponseBuilder().status(200).body(response).build();
}

export const handler = middy(baseHandler)
  .use(httpHeaderNormalizer())
  .use(authMiddleware())
  .use(errorHandlerMiddleware());
