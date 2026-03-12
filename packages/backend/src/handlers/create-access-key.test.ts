import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sst', () => ({
  Resource: {
    AccessKeysTable: { name: 'AccessKeysTable' },
    UserInfoTable: { name: 'UserInfoTable' },
  },
}));

const mockCreateAuroraAccessKey = vi.fn();

vi.mock('../lib/aurora-portal.js', () => ({
  createAuroraAccessKey: (...args: unknown[]) => mockCreateAuroraAccessKey(...args),
}));

const ddbMock = mockClient(DynamoDBClient);

import { baseHandler } from './create-access-key.js';
import { buildEvent } from '../test/lambda-test-utilities.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_INFO = { userId: 'user-1', orgId: 'org-1' };

function validBody() {
  return JSON.stringify({ keyName: 'My Key' });
}

function orgProfileWithTenant(tenantId: string) {
  return {
    Item: {
      pk: { S: `ORG#${USER_INFO.orgId}` },
      sk: { S: 'PROFILE' },
      auroraTenantId: { S: tenantId },
      setupStatus: { S: 'AURORA_TENANT_API_KEY_CREATED' },
    },
  };
}

function orgProfileWithoutTenant() {
  return {
    Item: {
      pk: { S: `ORG#${USER_INFO.orgId}` },
      sk: { S: 'PROFILE' },
    },
  };
}

function auroraAccessKeyResponse(name: string) {
  return {
    id: 'aurora-key-1',
    name,
    accessKeyId: 'AKIA1234567890',
    accessKeySecret: 'secret-abc-123',
    createdAt: '2026-03-10T13:36:07.752371Z',
    modifiedAt: '2026-03-10T13:36:07.752371Z',
    tenantId: 'aurora-t-1',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create-access-key baseHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
  });

  it('returns 201 with keyName, accessKeyId, and secretAccessKey on success', async () => {
    ddbMock.on(GetItemCommand).resolves(orgProfileWithTenant('aurora-t-1'));
    ddbMock.on(PutItemCommand).resolves({});
    mockCreateAuroraAccessKey.mockResolvedValue(auroraAccessKeyResponse('My Key'));

    const event = buildEvent({ body: validBody(), userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body).toStrictEqual({
      id: 'aurora-key-1',
      keyName: 'My Key',
      accessKeyId: 'AKIA1234567890',
      secretAccessKey: 'secret-abc-123',
    });
  });

  it('calls createAuroraAccessKey with correct params', async () => {
    ddbMock.on(GetItemCommand).resolves(orgProfileWithTenant('aurora-t-1'));
    ddbMock.on(PutItemCommand).resolves({});
    mockCreateAuroraAccessKey.mockResolvedValue(auroraAccessKeyResponse('My Key'));

    const event = buildEvent({ body: validBody(), userInfo: USER_INFO });
    await baseHandler(event);

    expect(mockCreateAuroraAccessKey).toHaveBeenCalledWith({
      tenantId: 'aurora-t-1',
      name: 'My Key',
    });
  });

  it('stores access key in DynamoDB without the secret', async () => {
    ddbMock.on(GetItemCommand).resolves(orgProfileWithTenant('aurora-t-1'));
    ddbMock.on(PutItemCommand).resolves({});
    mockCreateAuroraAccessKey.mockResolvedValue(auroraAccessKeyResponse('My Key'));

    const event = buildEvent({ body: validBody(), userInfo: USER_INFO });
    await baseHandler(event);

    const putCalls = ddbMock.commandCalls(PutItemCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item!;
    expect(item.pk.S).toBe('ORG#org-1');
    expect(item.sk.S).toBe('ACCESSKEY#aurora-key-1');
    expect(item.keyName.S).toBe('My Key');
    expect(item.accessKeyId.S).toBe('AKIA1234567890');
    expect(item.createdAt.S).toBe('2026-03-10T13:36:07.752371Z');
    expect(item.status.S).toBe('active');
    // Secret must NOT be stored
    expect(item.accessKeySecret).toBeUndefined();
    expect(item.secretAccessKey).toBeUndefined();
  });

  it('returns 400 when keyName is missing', async () => {
    const event = buildEvent({ body: JSON.stringify({}), userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    expect(mockCreateAuroraAccessKey).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = buildEvent({ body: 'not-json', userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
  });

  it('returns 503 when auroraTenantId is missing', async () => {
    ddbMock.on(GetItemCommand).resolves(orgProfileWithoutTenant());

    const event = buildEvent({ body: validBody(), userInfo: USER_INFO });
    const result = await baseHandler(event);

    expect(result.statusCode).toBe(503);
    expect(mockCreateAuroraAccessKey).not.toHaveBeenCalled();
  });

  it('throws when Aurora Portal API fails', async () => {
    ddbMock.on(GetItemCommand).resolves(orgProfileWithTenant('aurora-t-1'));
    mockCreateAuroraAccessKey.mockRejectedValue(new Error('Aurora API error'));

    const event = buildEvent({ body: validBody(), userInfo: USER_INFO });

    await expect(baseHandler(event)).rejects.toThrow('Aurora API error');
    expect(ddbMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });
});
