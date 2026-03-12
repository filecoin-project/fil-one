import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { UsageTrendsResponse, UsageDataPoint } from '@filone/shared';
import { Resource } from 'sst';
import { ResponseBuilder } from '../lib/response-builder.js';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { getUserInfo } from '../lib/user-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';

const dynamo = new DynamoDBClient({});

async function baseHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  const { userId } = getUserInfo(event);
  const period = event.queryStringParameters?.period === '30d' ? 30 : 7;
  const uploadsTableName = Resource.UploadsTable.name;

  // Get all buckets
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
  const bucketNames = (bucketsResult.Items ?? []).map((item) => unmarshall(item).name as string);

  // Get all objects with sizeBytes + uploadedAt
  const allObjects: { sizeBytes: number; uploadedAt: string }[] = [];
  for (const bucketName of bucketNames) {
    const objectsResult = await dynamo.send(
      new QueryCommand({
        TableName: uploadsTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `BUCKET#${userId}#${bucketName}` },
          ':skPrefix': { S: 'OBJECT#' },
        },
        ProjectionExpression: 'sizeBytes, uploadedAt',
      }),
    );
    for (const item of objectsResult.Items ?? []) {
      const record = unmarshall(item);
      allObjects.push({
        sizeBytes: (record.sizeBytes as number) || 0,
        uploadedAt: record.uploadedAt as string,
      });
    }
  }

  // Build daily data points
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - period + 1);
  startDate.setHours(0, 0, 0, 0);

  allObjects.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

  const storageSeries: UsageDataPoint[] = [];
  const objectsSeries: UsageDataPoint[] = [];

  for (let d = 0; d < period; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let cumulativeStorage = 0;
    let dailyObjectCount = 0;
    for (const obj of allObjects) {
      const objDate = new Date(obj.uploadedAt);
      if (objDate <= endOfDay) cumulativeStorage += obj.sizeBytes;
      if (objDate >= date && objDate <= endOfDay) dailyObjectCount++;
    }

    storageSeries.push({ date: label, value: cumulativeStorage });
    objectsSeries.push({ date: label, value: dailyObjectCount });
  }

  const response: UsageTrendsResponse = { storage: storageSeries, objects: objectsSeries };
  return new ResponseBuilder().status(200).body(response).build();
}

export const handler = middy(baseHandler)
  .use(httpHeaderNormalizer())
  .use(authMiddleware())
  .use(errorHandlerMiddleware());
