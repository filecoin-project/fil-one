import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { FINAL_SETUP_STATUS } from '../lib/org-setup-status.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sst', () => ({
  Resource: {
    UploadsTable: { name: 'UploadsTable' },
    UserInfoTable: { name: 'UserInfoTable' },
  },
}));

const mockGetAuroraS3Credentials = vi.fn();
const mockListObjects = vi.fn();

vi.mock('../lib/aurora-s3-client.js', () => ({
  getAuroraS3Credentials: (...args: unknown[]) => mockGetAuroraS3Credentials(...args),
  listObjects: (...args: unknown[]) => mockListObjects(...args),
}));

process.env.FILONE_STAGE = 'test';
process.env.AURORA_S3_GATEWAY_URL = 'https://s3.dev.aur.lu';

const ddbMock = mockClient(DynamoDBClient);

import { baseHandler } from './get-activity.js';
import { buildEvent } from '../test/lambda-test-utilities.js';
import { S3_REGION } from '@filone/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_INFO = { userId: 'user-1', orgId: 'org-1' };

function bucketItem(name: string, createdAt: string) {
  return marshall({
    pk: `USER#${USER_INFO.userId}`,
    sk: `BUCKET#${name}`,
    name,
    region: S3_REGION,
    createdAt,
    isPublic: false,
  });
}

function keyItem(id: string, keyName: string, createdAt: string) {
  return marshall({
    pk: `ORG#${USER_INFO.orgId}`,
    sk: `ACCESSKEY#${id}`,
    keyName,
    accessKeyId: `AKIA-${id}`,
    createdAt,
    status: 'active',
  });
}

function orgProfileWithTenant() {
  return {
    Item: {
      pk: { S: `ORG#${USER_INFO.orgId}` },
      sk: { S: 'PROFILE' },
      auroraTenantId: { S: 'aurora-t-1' },
      setupStatus: { S: FINAL_SETUP_STATUS },
    },
  };
}

/** Build an array of { date: expect.any(String), value } for flat trend assertions. */
function flatTrend(length: number, value: number) {
  return Array.from({ length }, () => ({ date: expect.any(String), value }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get-activity baseHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
    mockGetAuroraS3Credentials.mockResolvedValue({
      accessKeyId: 'AKIA_CONSOLE',
      secretAccessKey: 's3_secret',
    });
    mockListObjects.mockResolvedValue({ objects: [], isTruncated: false });
    ddbMock.on(GetItemCommand, { TableName: 'UserInfoTable' }).resolves(orgProfileWithTenant());
  });

  it('returns 200 with empty activities and flat trends when no buckets exist', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body));
    expect(body).toStrictEqual({
      activities: [],
      trends: {
        storage: flatTrend(7, 0),
        objects: flatTrend(7, 0),
      },
    });
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

    // Access keys query
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `ORG#${USER_INFO.orgId}` } },
      })
      .resolves({ Items: [] });

    mockListObjects.mockResolvedValue({
      objects: [
        { key: 'cat.jpg', sizeBytes: 1024, lastModified: '2026-01-05T00:00:00.000Z' },
        { key: 'dog.jpg', sizeBytes: 2048, lastModified: '2026-01-03T00:00:00.000Z' },
      ],
      isTruncated: false,
    });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body));

    expect(body).toStrictEqual({
      activities: [
        {
          id: 'object-photos-cat.jpg',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'cat.jpg',
          timestamp: '2026-01-05T00:00:00.000Z',
          sizeBytes: 1024,
        },
        {
          id: 'object-photos-dog.jpg',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'dog.jpg',
          timestamp: '2026-01-03T00:00:00.000Z',
          sizeBytes: 2048,
        },
        {
          id: 'bucket-photos',
          action: 'bucket.created',
          resourceType: 'bucket',
          resourceName: 'photos',
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
      trends: {
        storage: flatTrend(7, expect.any(Number)),
        objects: flatTrend(7, expect.any(Number)),
      },
    });
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
        ExpressionAttributeValues: { ':pk': { S: `ORG#${USER_INFO.orgId}` } },
      })
      .resolves({ Items: [] });

    mockListObjects.mockResolvedValue({
      objects: [
        { key: 'a.txt', sizeBytes: 100, lastModified: '2026-01-02T00:00:00.000Z' },
        { key: 'b.txt', sizeBytes: 200, lastModified: '2026-01-03T00:00:00.000Z' },
        { key: 'c.txt', sizeBytes: 300, lastModified: '2026-01-04T00:00:00.000Z' },
      ],
      isTruncated: false,
    });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { limit: '2' },
    });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body).toStrictEqual({
      activities: [
        {
          id: 'object-b1-c.txt',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'c.txt',
          timestamp: '2026-01-04T00:00:00.000Z',
          sizeBytes: 300,
        },
        {
          id: 'object-b1-b.txt',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'b.txt',
          timestamp: '2026-01-03T00:00:00.000Z',
          sizeBytes: 200,
        },
      ],
      trends: {
        storage: flatTrend(7, expect.any(Number)),
        objects: flatTrend(7, expect.any(Number)),
      },
    });
  });

  it('defaults limit to 10 when limit is non-numeric', async () => {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('b1', '2026-01-01T00:00:00Z')],
      });

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `ORG#${USER_INFO.orgId}` } },
      })
      .resolves({ Items: [] });

    mockListObjects.mockResolvedValue({
      objects: [
        { key: 'a.txt', sizeBytes: 100, lastModified: '2026-01-02T00:00:00.000Z' },
        { key: 'b.txt', sizeBytes: 200, lastModified: '2026-01-03T00:00:00.000Z' },
      ],
      isTruncated: false,
    });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { limit: 'abc' },
    });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    // Should fall back to 10, not return empty due to NaN
    expect(body.activities).toHaveLength(3);
  });

  it('defaults limit to 10 when limit is negative', async () => {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('b1', '2026-01-01T00:00:00Z')],
      });

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `ORG#${USER_INFO.orgId}` } },
      })
      .resolves({ Items: [] });

    mockListObjects.mockResolvedValue({
      objects: [
        { key: 'a.txt', sizeBytes: 100, lastModified: '2026-01-02T00:00:00.000Z' },
        { key: 'b.txt', sizeBytes: 200, lastModified: '2026-01-03T00:00:00.000Z' },
      ],
      isTruncated: false,
    });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { limit: '-5' },
    });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body.activities.length).toBeGreaterThanOrEqual(1);
  });

  it('caps limit at 50', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { limit: '999' },
    });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(String(result.body));
    expect(body).toStrictEqual({
      activities: [],
      trends: {
        storage: flatTrend(7, 0),
        objects: flatTrend(7, 0),
      },
    });
  });

  it('returns 30-day trend series when period=30d', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({
      userInfo: USER_INFO,
      queryStringParameters: { period: '30d' },
    });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body).toStrictEqual({
      activities: [],
      trends: {
        storage: flatTrend(30, 0),
        objects: flatTrend(30, 0),
      },
    });
  });

  it('defaults to 7-day trend series', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body).toStrictEqual({
      activities: [],
      trends: {
        storage: flatTrend(7, 0),
        objects: flatTrend(7, 0),
      },
    });
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
        ExpressionAttributeValues: { ':pk': { S: `ORG#${USER_INFO.orgId}` } },
      })
      .resolves({ Items: [] });

    mockListObjects.mockResolvedValue({
      objects: [
        { key: 'old.bin', sizeBytes: 500, lastModified: twoDaysAgo.toISOString() },
        { key: 'new.bin', sizeBytes: 300, lastModified: yesterday.toISOString() },
      ],
      isTruncated: false,
    });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    // The last day's cumulative storage should be 800 (500 + 300)
    const lastStoragePoint = body.trends.storage[body.trends.storage.length - 1];
    expect(lastStoragePoint.value).toBe(800);

    // Full structure check
    expect(body).toStrictEqual({
      activities: expect.arrayContaining([
        {
          id: 'object-data-new.bin',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'new.bin',
          timestamp: yesterday.toISOString(),
          sizeBytes: 300,
        },
        {
          id: 'object-data-old.bin',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'old.bin',
          timestamp: twoDaysAgo.toISOString(),
          sizeBytes: 500,
        },
        {
          id: 'bucket-data',
          action: 'bucket.created',
          resourceType: 'bucket',
          resourceName: 'data',
          timestamp: '2025-01-01T00:00:00Z',
        },
      ]),
      trends: {
        storage: flatTrend(7, expect.any(Number)),
        objects: flatTrend(7, expect.any(Number)),
      },
    });
  });

  it('includes key activities sorted with buckets and objects', async () => {
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
          ':pk': { S: `ORG#${USER_INFO.orgId}` },
          ':skPrefix': { S: 'ACCESSKEY#' },
        },
      })
      .resolves({
        Items: [keyItem('key-1', 'my-api-key', '2026-01-02T00:00:00Z')],
      });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body).toStrictEqual({
      activities: [
        {
          id: 'key-key-1',
          action: 'key.created',
          resourceType: 'key',
          resourceName: 'my-api-key',
          timestamp: '2026-01-02T00:00:00Z',
        },
        {
          id: 'bucket-b1',
          action: 'bucket.created',
          resourceType: 'bucket',
          resourceName: 'b1',
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
      trends: {
        storage: flatTrend(7, expect.any(Number)),
        objects: flatTrend(7, expect.any(Number)),
      },
    });
  });

  it('includes sizeBytes on object activities when present', async () => {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `USER#${USER_INFO.userId}` } },
      })
      .resolves({
        Items: [bucketItem('b1', '2026-01-01T00:00:00Z')],
      });

    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': { S: `ORG#${USER_INFO.orgId}` } },
      })
      .resolves({ Items: [] });

    mockListObjects.mockResolvedValue({
      objects: [{ key: 'file.dat', sizeBytes: 4096, lastModified: '2026-01-02T00:00:00.000Z' }],
      isTruncated: false,
    });

    const event = buildEvent({ userInfo: USER_INFO });
    const result = await baseHandler(event);
    const body = JSON.parse(String(result.body));

    expect(body).toStrictEqual({
      activities: [
        {
          id: 'object-b1-file.dat',
          action: 'object.uploaded',
          resourceType: 'object',
          resourceName: 'file.dat',
          timestamp: '2026-01-02T00:00:00.000Z',
          sizeBytes: 4096,
        },
        {
          id: 'bucket-b1',
          action: 'bucket.created',
          resourceType: 'bucket',
          resourceName: 'b1',
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
      trends: {
        storage: flatTrend(7, expect.any(Number)),
        objects: flatTrend(7, expect.any(Number)),
      },
    });
  });
});
