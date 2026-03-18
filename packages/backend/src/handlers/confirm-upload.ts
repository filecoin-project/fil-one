// Temporary workaround: after the browser uploads directly to Aurora S3 Gateway,
// this endpoint stores object metadata in our DynamoDB. This will be replaced once
// we implement proper synchronisation between FilOne Console and Aurora S3 Gateway.

import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ErrorResponse, ConfirmUploadRequest, ConfirmUploadResponse } from '@filone/shared';
import { Resource } from 'sst';
import { getDynamoClient } from '../lib/ddb-client.js';
import { ResponseBuilder } from '../lib/response-builder.js';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { getUserInfo } from '../lib/user-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';
import { subscriptionGuardMiddleware, AccessLevel } from '../middleware/subscription-guard.js';

const dynamo = getDynamoClient();

export async function baseHandler(
  event: AuthenticatedEvent,
): Promise<APIGatewayProxyStructuredResultV2> {
  const bucketName = event.pathParameters?.name;
  if (!bucketName) {
    return new ResponseBuilder()
      .status(400)
      .body<ErrorResponse>({ message: 'Missing bucket name in path' })
      .build();
  }

  let request: ConfirmUploadRequest;
  try {
    request = JSON.parse(event.body ?? '{}') as ConfirmUploadRequest;
  } catch {
    return new ResponseBuilder()
      .status(400)
      .body<ErrorResponse>({ message: 'Invalid JSON body' })
      .build();
  }

  const { key, fileName, contentType, sizeBytes, etag, description } = request;
  if (!key || !fileName || !contentType || sizeBytes == null) {
    return new ResponseBuilder()
      .status(400)
      .body<ErrorResponse>({
        message: 'Missing required fields: key, fileName, contentType, sizeBytes',
      })
      .build();
  }

  const { userId } = getUserInfo(event);
  const tableName = Resource.UploadsTable.name;

  // Verify bucket ownership
  const bucketRecord = await dynamo.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ pk: `USER#${userId}`, sk: `BUCKET#${bucketName}` }),
    }),
  );

  if (!bucketRecord.Item) {
    return new ResponseBuilder()
      .status(404)
      .body<ErrorResponse>({ message: 'Bucket not found' })
      .build();
  }

  // Store metadata in DynamoDB
  const now = new Date().toISOString();
  const s3Key = `${bucketName}/${key}`;

  await dynamo.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        pk: `BUCKET#${userId}#${bucketName}`,
        sk: `OBJECT#${key}`,
        key,
        fileName,
        contentType,
        sizeBytes,
        uploadedAt: now,
        ...(etag && { etag }),
        s3Key,
        ...(description && { description }),
      }),
    }),
  );

  return new ResponseBuilder()
    .status(201)
    .body<ConfirmUploadResponse>({
      object: {
        key,
        sizeBytes,
        lastModified: now,
        contentType,
        ...(etag && { etag }),
        ...(description && { description }),
      },
    })
    .build();
}

export const handler = middy(baseHandler)
  .use(httpHeaderNormalizer())
  .use(authMiddleware())
  .use(csrfMiddleware())
  .use(subscriptionGuardMiddleware(AccessLevel.Write))
  .use(errorHandlerMiddleware());
