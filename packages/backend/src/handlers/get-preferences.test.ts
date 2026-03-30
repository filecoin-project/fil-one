import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sst', () => ({
  Resource: {
    UserInfoTable: { name: 'UserInfoTable' },
    Auth0ClientId: { value: 'test-client-id' },
    Auth0ClientSecret: { value: 'test-client-secret' },
    AuroraBackofficeToken: { value: 'test-aurora-token' },
  },
}));

vi.mock('../lib/auth-secrets.js', () => ({
  getAuthSecrets: () => ({
    AUTH0_CLIENT_ID: 'test-client-id',
    AUTH0_CLIENT_SECRET: 'test-client-secret',
  }),
}));

const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({
  jwtVerify: (token: unknown, jwks: unknown, opts: unknown) => mockJwtVerify(token, jwks, opts),
  decodeJwt: vi.fn(),
  createRemoteJWKSet: vi.fn((_url: unknown) => 'mock-jwks'),
}));

const ddbMock = mockClient(DynamoDBClient);

process.env.AUTH0_DOMAIN = 'test.auth0.com';
process.env.AUTH0_AUDIENCE = 'https://api.test.com';

import { handler } from './get-preferences.js';
import { buildEvent, buildContext } from '../test/lambda-test-utilities.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_SUB = 'auth0|abc123';
const MOCK_ORG_ID = 'org-1';
const MOCK_USER_ID = 'user-1';
const MOCK_EMAIL = 'user@example.com';

function authenticatedEvent() {
  return buildEvent({
    cookies: [`hs_access_token=valid-token`, `hs_id_token=id-token`],
    userInfo: { userId: MOCK_USER_ID, orgId: MOCK_ORG_ID, email: MOCK_EMAIL },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/me/preferences handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();

    mockJwtVerify.mockResolvedValue({
      payload: { sub: MOCK_SUB, email: MOCK_EMAIL, email_verified: true },
    });

    // Auth middleware: resolve existing user
    ddbMock
      .on(GetItemCommand, {
        TableName: 'UserInfoTable',
        Key: { pk: { S: `SUB#${MOCK_SUB}` }, sk: { S: 'IDENTITY' } },
      })
      .resolves({
        Item: {
          pk: { S: `SUB#${MOCK_SUB}` },
          sk: { S: 'IDENTITY' },
          userId: { S: MOCK_USER_ID },
          orgId: { S: MOCK_ORG_ID },
        },
      });

    // Auth middleware: org confirmed
    ddbMock
      .on(GetItemCommand, {
        TableName: 'UserInfoTable',
        Key: { pk: { S: `ORG#${MOCK_ORG_ID}` }, sk: { S: 'PROFILE' } },
      })
      .resolves({
        Item: {
          orgConfirmed: { BOOL: true },
          setupStatus: { S: 'AURORA_S3_ACCESS_KEY_CREATED' },
        },
      });
  });

  it('returns marketingEmailsOptedIn: true when field is true', async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: 'UserInfoTable',
        Key: { pk: { S: `USER#${MOCK_USER_ID}` }, sk: { S: 'PROFILE' } },
      })
      .resolves({
        Item: {
          pk: { S: `USER#${MOCK_USER_ID}` },
          sk: { S: 'PROFILE' },
          marketingEmailsOptedIn: { BOOL: true },
        },
      });

    const result = await handler(authenticatedEvent(), buildContext());

    expect(result).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ marketingEmailsOptedIn: true }),
    });
  });

  it('returns marketingEmailsOptedIn: false when field is false', async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: 'UserInfoTable',
        Key: { pk: { S: `USER#${MOCK_USER_ID}` }, sk: { S: 'PROFILE' } },
      })
      .resolves({
        Item: {
          pk: { S: `USER#${MOCK_USER_ID}` },
          sk: { S: 'PROFILE' },
          marketingEmailsOptedIn: { BOOL: false },
        },
      });

    const result = await handler(authenticatedEvent(), buildContext());

    expect(result).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ marketingEmailsOptedIn: false }),
    });
  });

  it('defaults to true when field is absent (legacy users)', async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: 'UserInfoTable',
        Key: { pk: { S: `USER#${MOCK_USER_ID}` }, sk: { S: 'PROFILE' } },
      })
      .resolves({
        Item: {
          pk: { S: `USER#${MOCK_USER_ID}` },
          sk: { S: 'PROFILE' },
        },
      });

    const result = await handler(authenticatedEvent(), buildContext());

    expect(result).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ marketingEmailsOptedIn: true }),
    });
  });

  it('defaults to true when user profile item is missing', async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: 'UserInfoTable',
        Key: { pk: { S: `USER#${MOCK_USER_ID}` }, sk: { S: 'PROFILE' } },
      })
      .resolves({});

    const result = await handler(authenticatedEvent(), buildContext());

    expect(result).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ marketingEmailsOptedIn: true }),
    });
  });
});
