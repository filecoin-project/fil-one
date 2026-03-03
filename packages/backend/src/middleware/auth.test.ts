import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from '@middy/core';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { EventBuilder } from '../test/event-builder.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MOCK_SUB = 'auth0|abc123';
const MOCK_EMAIL = 'user@example.com';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('uuid', () => ({
  v4: () => MOCK_USER_ID,
}));

vi.mock('sst', () => ({
  Resource: {
    UserInfoTable: { name: 'UserInfoTable' },
    Auth0ClientId: { value: 'test-client-id' },
    Auth0ClientSecret: { value: 'test-client-secret' },
  },
}));

vi.mock('../lib/auth-secrets.js', () => ({
  getAuthSecrets: () => ({
    AUTH0_CLIENT_ID: 'test-client-id',
    AUTH0_CLIENT_SECRET: 'test-client-secret',
  }),
}));

const mockJwtVerify = vi.fn();
const mockDecodeJwt = vi.fn();
const mockCreateRemoteJWKSet = vi.fn((_url: unknown) => 'mock-jwks');

vi.mock('jose', () => ({
  jwtVerify: (token: unknown, jwks: unknown, opts: unknown) => mockJwtVerify(token, jwks, opts),
  decodeJwt: (token: unknown) => mockDecodeJwt(token),
  createRemoteJWKSet: (url: unknown) => mockCreateRemoteJWKSet(url),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ddbMock = mockClient(DynamoDBClient);

process.env.AUTH0_DOMAIN = 'test.auth0.com';
process.env.AUTH0_AUDIENCE = 'https://api.test.com';

// Import after all mocks are set up
import { authMiddleware } from './auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AuthRequest = Request<
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Error,
  Context,
  Record<string, unknown>
>;

function makeRequest(event: APIGatewayProxyEventV2): AuthRequest {
  return {
    event,
    context: {} as Context,
    response: null,
    error: null,
    internal: {},
  };
}

function getUserInfoFromEvent(event: APIGatewayProxyEventV2) {
  return (event as AuthenticatedEvent).requestContext.userInfo;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
  });

  describe('before hook', () => {
    it('returns 401 when no cookies are present', async () => {
      const { before } = authMiddleware();
      const request = makeRequest(new EventBuilder().build());

      const result = await before!(request);

      expect(result).toBeDefined();
      const response = result as APIGatewayProxyStructuredResultV2;
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body as string)).toEqual({ message: 'Unauthorized' });
    });

    it('resolves existing user from UserInfoTable on valid access token', async () => {
      const existingUserId = 'existing-user-uuid';

      mockJwtVerify.mockResolvedValue({
        payload: { sub: MOCK_SUB, email: MOCK_EMAIL },
      });

      ddbMock.on(GetItemCommand).resolves({
        Item: {
          pk: { S: `SUB#${MOCK_SUB}` },
          sk: { S: 'IDENTITY' },
          userId: { S: existingUserId },
          email: { S: MOCK_EMAIL },
        },
      });

      const { before } = authMiddleware();
      const event = new EventBuilder().withCookies([
        `hs_access_token=valid-token`,
        `hs_id_token=id-token`,
        `hs_refresh_token=refresh-token`,
      ]).build();
      const request = makeRequest(event);

      const result = await before!(request);

      expect(result).toBeUndefined();
      const userInfo = getUserInfoFromEvent(event);
      expect(userInfo.userId).toBe(existingUserId);
      expect(userInfo.email).toBe(MOCK_EMAIL);
      expect(userInfo).not.toHaveProperty('sub');
    });

    it('creates new user when no UserInfoTable record exists', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: MOCK_SUB, email: MOCK_EMAIL },
      });

      ddbMock.on(GetItemCommand).resolves({ Item: undefined });
      ddbMock.on(TransactWriteItemsCommand).resolves({});

      const { before } = authMiddleware();
      const event = new EventBuilder().withCookies([`hs_access_token=valid-token`]).build();
      const request = makeRequest(event);

      const result = await before!(request);

      expect(result).toBeUndefined();
      const userInfo = getUserInfoFromEvent(event);
      expect(userInfo.userId).toBe(MOCK_USER_ID);
      expect(userInfo.email).toBe(MOCK_EMAIL);

      const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
      expect(transactCalls).toHaveLength(1);
      const items = transactCalls[0].args[0].input.TransactItems!;
      expect(items).toHaveLength(2);
      expect(items[0].Put!.Item!.pk.S).toBe(`SUB#${MOCK_SUB}`);
      expect(items[1].Put!.Item!.pk.S).toBe(`USER#${MOCK_USER_ID}`);
    });

    it('refreshes tokens when access token is expired but refresh token is valid', async () => {
      const existingUserId = 'refreshed-user-uuid';

      mockJwtVerify.mockRejectedValue(new Error('token expired'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          id_token: 'new-id-token',
          refresh_token: 'new-refresh-token',
        }),
      });

      mockDecodeJwt.mockReturnValue({
        sub: MOCK_SUB,
        email: MOCK_EMAIL,
      });

      ddbMock.on(GetItemCommand).resolves({
        Item: {
          pk: { S: `SUB#${MOCK_SUB}` },
          sk: { S: 'IDENTITY' },
          userId: { S: existingUserId },
        },
      });

      const { before } = authMiddleware();
      const event = new EventBuilder().withCookies([
        `hs_access_token=expired-token`,
        `hs_refresh_token=valid-refresh`,
      ]).build();
      const request = makeRequest(event);

      const result = await before!(request);

      expect(result).toBeUndefined();
      const userInfo = getUserInfoFromEvent(event);
      expect(userInfo.userId).toBe(existingUserId);
      expect(request.internal.newTokens).toEqual({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        refresh_token: 'new-refresh-token',
      });
    });

    it('returns 401 when access token expired and refresh fails', async () => {
      mockJwtVerify.mockRejectedValue(new Error('token expired'));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid refresh token',
      });

      const { before } = authMiddleware();
      const request = makeRequest(new EventBuilder().withCookies([
        `hs_access_token=expired`,
        `hs_refresh_token=bad-refresh`,
      ]).build());

      const result = await before!(request);

      expect(result).toBeDefined();
      expect((result as APIGatewayProxyStructuredResultV2).statusCode).toBe(401);
    });

    it('returns 401 when access token expired and refresh fetch throws', async () => {
      mockJwtVerify.mockRejectedValue(new Error('token expired'));
      mockFetch.mockRejectedValue(new Error('network error'));

      const { before } = authMiddleware();
      const request = makeRequest(new EventBuilder().withCookies([
        `hs_access_token=expired`,
        `hs_refresh_token=some-refresh`,
      ]).build());

      const result = await before!(request);

      expect(result).toBeDefined();
      expect((result as APIGatewayProxyStructuredResultV2).statusCode).toBe(401);
    });

    it('parses cookies from event.cookies array correctly', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: MOCK_SUB, email: MOCK_EMAIL },
      });

      ddbMock.on(GetItemCommand).resolves({
        Item: {
          pk: { S: `SUB#${MOCK_SUB}` },
          sk: { S: 'IDENTITY' },
          userId: { S: 'some-user' },
        },
      });

      const { before } = authMiddleware();
      const request = makeRequest(new EventBuilder().withCookies([
        ' hs_access_token = my-token ',
      ]).build());

      await before!(request);

      expect(mockJwtVerify).toHaveBeenCalledWith(
        'my-token',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('after hook', () => {
    it('attaches Set-Cookie headers when newTokens exist', async () => {
      const { after } = authMiddleware();
      const response: APIGatewayProxyStructuredResultV2 = { statusCode: 200, body: '{}' };
      const request: AuthRequest = {
        event: new EventBuilder().build(),
        context: {} as Context,
        response,
        error: null,
        internal: {
          newTokens: {
            access_token: 'new-at',
            id_token: 'new-it',
            refresh_token: 'new-rt',
          },
        },
      };

      await after!(request);

      expect(response.cookies).toHaveLength(4);
      expect(response.cookies![0]).toContain('hs_access_token=new-at');
      expect(response.cookies![1]).toContain('hs_id_token=new-it');
      expect(response.cookies![2]).toContain('hs_refresh_token=new-rt');
      expect(response.cookies![3]).toContain('hs_logged_in=1');
    });

    it('does not modify response when no newTokens', async () => {
      const { after } = authMiddleware();
      const response: APIGatewayProxyStructuredResultV2 = { statusCode: 200, body: '{}' };
      const request: AuthRequest = {
        event: new EventBuilder().build(),
        context: {} as Context,
        response,
        error: null,
        internal: {},
      };

      await after!(request);

      expect(response.cookies).toBeUndefined();
    });
  });
});
