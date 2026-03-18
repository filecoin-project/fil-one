import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
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

import { baseHandler } from './confirm-upload.js';
import { buildEvent } from '../test/lambda-test-utilities.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_INFO = { userId: 'user-1', orgId: 'org-1' };

function givenRequestBody(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    key: 'photos/cat.jpg',
    fileName: 'cat.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 12345,
    etag: '"abc123"',
    ...overrides,
  });
}

function bucketRecord() {
  return {
    Item: marshall({ pk: `USER#${USER_INFO.userId}`, sk: 'BUCKET#my-bucket' }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirm-upload baseHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
  });

  it('returns 201 with object metadata on success', async () => {
    ddbMock.on(GetItemCommand).resolves(bucketRecord());
    ddbMock.on(PutItemCommand).resolves({});

    const event = buildEvent({ body: givenRequestBody(), userInfo: USER_INFO });
    event.pathParameters = { name: 'my-bucket' };
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.object).toStrictEqual({
      key: 'photos/cat.jpg',
      sizeBytes: 12345,
      lastModified: expect.any(String),
      etag: '"abc123"',
      contentType: 'image/jpeg',
    });
  });

  it('stores metadata in DynamoDB with correct keys', async () => {
    ddbMock.on(GetItemCommand).resolves(bucketRecord());
    ddbMock.on(PutItemCommand).resolves({});

    const event = buildEvent({
      body: givenRequestBody({ description: 'A cute cat' }),
      userInfo: USER_INFO,
    });
    event.pathParameters = { name: 'my-bucket' };
    await baseHandler(event);

    const putCalls = ddbMock.commandCalls(PutItemCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item;
    expect(item).toStrictEqual({
      pk: { S: 'BUCKET#user-1#my-bucket' },
      sk: { S: 'OBJECT#photos/cat.jpg' },
      key: { S: 'photos/cat.jpg' },
      fileName: { S: 'cat.jpg' },
      contentType: { S: 'image/jpeg' },
      sizeBytes: { N: '12345' },
      uploadedAt: { S: expect.any(String) },
      etag: { S: '"abc123"' },
      s3Key: { S: 'my-bucket/photos/cat.jpg' },
      description: { S: 'A cute cat' },
    });
  });

  it('returns 400 when bucket name is missing from path', async () => {
    const event = buildEvent({ body: givenRequestBody(), userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
  });

  const missingFieldCases: Record<string, Record<string, unknown>> = {
    'key is missing': { key: undefined },
    'fileName is missing': { fileName: undefined },
    'contentType is missing': { contentType: undefined },
    'sizeBytes is missing': { sizeBytes: undefined },
  };

  for (const [desc, overrides] of Object.entries(missingFieldCases)) {
    it(`returns 400 when ${desc}`, async () => {
      const event = buildEvent({
        body: givenRequestBody(overrides),
        userInfo: USER_INFO,
      });
      event.pathParameters = { name: 'my-bucket' };
      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
    });
  }

  const omitEtagCases: Record<string, unknown> = {
    undefined: undefined,
    null: null,
    "''": '',
  };

  for (const [desc, value] of Object.entries(omitEtagCases)) {
    it(`omits etag from response when etag is ${desc}`, async () => {
      ddbMock.on(GetItemCommand).resolves(bucketRecord());
      ddbMock.on(PutItemCommand).resolves({});

      const event = buildEvent({
        body: givenRequestBody({ etag: value }),
        userInfo: USER_INFO,
      });
      event.pathParameters = { name: 'my-bucket' };
      const result = await baseHandler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body as string);
      expect(body.object).not.toHaveProperty('etag');

      const putCalls = ddbMock.commandCalls(PutItemCommand);
      const item = putCalls[0].args[0].input.Item;
      expect(item).not.toHaveProperty('etag');
    });
  }

  it('returns 404 when bucket is not found', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });

    const event = buildEvent({ body: givenRequestBody(), userInfo: USER_INFO });
    event.pathParameters = { name: 'no-bucket' };
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(404);
  });
});
