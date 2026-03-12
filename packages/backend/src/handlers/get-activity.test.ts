import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sst', () => ({
  Resource: {
    UploadsTable: { name: 'UploadsTable' },
  },
}));

const ddbMock = mockClient(DynamoDBClient);

import { baseHandler } from './get-activity.js';
import { buildEvent } from '../test/lambda-test-utilities.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_INFO = { userId: 'user-1', orgId: 'org-1' };

function bucketItem(name: string, createdAt: string) {
  return marshall({
    pk: `USER#${USER_INFO.userId}`,
    sk: `BUCKET#${name}`,
    name,
    region: 'us-east-1',
    createdAt,
    isPublic: false,
  });
}

function objectItem(bucketName: string, key: string, uploadedAt: string, sizeBytes: number) {
  return marshall({
    pk: `BUCKET#${USER_INFO.userId}#${bucketName}`,
    sk: `OBJECT#${key}`,
    key,
    fileName: key,
    contentType: 'application/octet-stream',
    sizeBytes,
    uploadedAt,
    etag: '"abc"',
    s3Key: `${bucketName}/${key}`,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get-activity baseHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
  });

  it('returns 200 with empty activities and flat trends when no buckets exist', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body));
    expect(body.activities).toStrictEqual([]);
    expect(body.trends.storage).toHaveLength(7);
    expect(body.trends.objects).toHaveLength(7);
    // All trend values should be 0
    for (const point of body.trends.storage) {
      expect(point.value).toBe(0);
    }
  });

  it('returns bucket and object activities sorted most-recent-first', async () => {
    // First query: list buckets
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('photos', '2026-01-01T00:00:00Z')],
      });

    // Second query: objects in bucket
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': { S: `BUCKET#${USER_INFO.userId}#photos` },
          ':skPrefix': { S: 'OBJECT#' },
        },
      })
      .resolves({
        Items: [
          objectItem('photos', 'cat.jpg', '2026-01-05T00:00:00Z', 1024),
          objectItem('photos', 'dog.jpg', '2026-01-03T00:00:00Z', 2048),
        ],
      });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body));

    expect(body.activities).toHaveLength(3);
    // Most recent first
    expect(body.activities[0].resourceName).toBe('cat.jpg');
    expect(body.activities[1].resourceName).toBe('dog.jpg');
    expect(body.activities[2].resourceName).toBe('photos');
  });

  it('respects the limit query parameter', async () => {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('b1', '2026-01-01T00:00:00Z')],
      });

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': { S: `BUCKET#${USER_INFO.userId}#b1` },
          ':skPrefix': { S: 'OBJECT#' },
        },
      })
      .resolves({
        Items: [
          objectItem('b1', 'a.txt', '2026-01-02T00:00:00Z', 100),
          objectItem('b1', 'b.txt', '2026-01-03T00:00:00Z', 200),
          objectItem('b1', 'c.txt', '2026-01-04T00:00:00Z', 300),
        ],
      });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { limit: '2' },
    });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body.activities).toHaveLength(2);
  });

  it('caps limit at 50', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { limit: '999' },
    });
    const result = await baseHandler(event);

    // Should not error — just capped
    expect(result.statusCode).toBe(200);
  });

  it('returns 30-day trend series when period=30d', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { period: '30d' },
    });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body.trends.storage).toHaveLength(30);
    expect(body.trends.objects).toHaveLength(30);
  });

  it('defaults to 7-day trend series', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body.trends.storage).toHaveLength(7);
    expect(body.trends.objects).toHaveLength(7);
  });

  it('computes cumulative storage in trends', async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(12, 0, 0, 0);

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('data', '2025-01-01T00:00:00Z')],
      });

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': { S: `BUCKET#${USER_INFO.userId}#data` },
          ':skPrefix': { S: 'OBJECT#' },
        },
      })
      .resolves({
        Items: [
          objectItem('data', 'old.bin', twoDaysAgo.toISOString(), 500),
          objectItem('data', 'new.bin', yesterday.toISOString(), 300),
        ],
      });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    // The last day's cumulative storage should be 800 (500 + 300)
    const lastStoragePoint = body.trends.storage[body.trends.storage.length - 1];
    expect(lastStoragePoint.value).toBe(800);
  });

  it('queries DynamoDB with correct key conditions', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({ userInfo: USER_INFO });
    await baseHandler(event);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    const input = calls.at(0)?.args.at(0)?.input;
    expect(input).toStrictEqual({
      TableName: 'UploadsTable',
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: 'USER#user-1' },
        ':skPrefix': { S: 'BUCKET#' },
      },
    });
  });

  it('includes sizeBytes and cid on object activities when present', async () => {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('b1', '2026-01-01T00:00:00Z')],
      });

    const objWithCid = marshall({
      pk: `BUCKET#${USER_INFO.userId}#b1`,
      sk: 'OBJECT#file.dat',
      key: 'file.dat',
      fileName: 'file.dat',
      contentType: 'application/octet-stream',
      sizeBytes: 4096,
      uploadedAt: '2026-01-02T00:00:00Z',
      etag: '"xyz"',
      s3Key: 'b1/file.dat',
      cid: 'bafy123',
    });

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': { S: `BUCKET#${USER_INFO.userId}#b1` },
          ':skPrefix': { S: 'OBJECT#' },
        },
      })
      .resolves({ Items: [objWithCid] });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    const objectActivity = body.activities.find(
      (a: { resourceType: string }) => a.resourceType === 'object',
    );
    expect(objectActivity.sizeBytes).toBe(4096);
    expect(objectActivity.cid).toBe('bafy123');
  });
});
