import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEvent } from '../test/lambda-test-utilities.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sst', () => ({
  Resource: {
    Auth0LogStreamToken: { value: 'test-auth0-log-stream-token' },
  },
}));

import { handler } from './auth0-log-stream.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTH_TOKEN = 'test-auth0-log-stream-token';

function buildLogStreamEvent(body: unknown, opts?: { token?: string; omitAuth?: boolean }) {
  const evt = buildEvent({
    body: JSON.stringify(body),
    method: 'POST',
    rawPath: '/api/auth0/log-stream',
  });
  if (!opts?.omitAuth) {
    evt.headers['authorization'] = opts?.token ?? AUTH_TOKEN;
  }
  return evt;
}

function buildAuth0LogEntry(overrides?: {
  log_id?: string;
  type?: string;
  data?: Record<string, unknown>;
}) {
  return {
    log_id: overrides?.log_id ?? 'log-001',
    data: {
      type: 's',
      date: '2026-04-14T12:00:00.000Z',
      user_id: 'auth0|user-123',
      user_name: 'test@example.com',
      connection: 'Username-Password-Authentication',
      client_id: 'client-abc',
      ip: '203.0.113.1',
      description: 'Successful login',
      ...overrides?.data,
      ...(overrides?.type !== undefined ? { type: overrides.type } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth0-log-stream handler', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // -----------------------------------------------------------------------
  // 1. Authorization
  // -----------------------------------------------------------------------
  describe('authorization', () => {
    it('returns 401 when authorization header is missing', async () => {
      const evt = buildLogStreamEvent([], { omitAuth: true });
      const result = await handler(evt);
      expect(result).toEqual({
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });

    it('returns 401 when authorization header has wrong token', async () => {
      const evt = buildLogStreamEvent([], { token: 'wrong-token' });
      const result = await handler(evt);
      expect(result).toEqual({
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });

    it('accepts request when authorization header matches', async () => {
      const evt = buildLogStreamEvent([]);
      const result = await handler(evt);
      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({ received: true }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // 2. Payload parsing
  // -----------------------------------------------------------------------
  describe('payload parsing', () => {
    it('returns 400 for invalid JSON body', async () => {
      const evt = buildEvent({ body: 'not json', method: 'POST' });
      evt.headers['authorization'] = AUTH_TOKEN;
      const result = await handler(evt);
      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid JSON' }),
      });
    });

    it('returns 400 when body is not an array', async () => {
      const evt = buildLogStreamEvent({ not: 'an array' });
      const result = await handler(evt);
      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({ message: 'Expected array' }),
      });
    });

    it('handles base64-encoded body', async () => {
      const body = JSON.stringify([buildAuth0LogEntry()]);
      const evt = buildEvent({ method: 'POST' });
      evt.headers['authorization'] = AUTH_TOKEN;
      evt.body = Buffer.from(body).toString('base64');
      evt.isBase64Encoded = true;

      const result = await handler(evt);
      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({ received: true }),
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"source":"auth0-audit"'));
    });
  });

  // -----------------------------------------------------------------------
  // 3. Event processing
  // -----------------------------------------------------------------------
  describe('event processing', () => {
    it('emits one console.log per event with correct structure', async () => {
      const entry = buildAuth0LogEntry();
      const evt = buildLogStreamEvent([entry]);
      await handler(evt);

      const logCalls = consoleSpy.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('"source":"auth0-audit"'),
      );
      expect(logCalls).toHaveLength(1);

      const parsed = JSON.parse(logCalls[0][0] as string);
      expect(parsed).toEqual({
        source: 'auth0-audit',
        log_id: 'log-001',
        event_type: 's',
        category: 'login-success',
        timestamp: '2026-04-14T12:00:00.000Z',
        user_id: 'auth0|user-123',
        user_name: 'test@example.com',
        connection: 'Username-Password-Authentication',
        client_id: 'client-abc',
        ip: '203.0.113.1',
        description: 'Successful login',
        details: undefined,
      });
    });

    it('emits multiple logs for multiple events', async () => {
      const events = [
        buildAuth0LogEntry({ log_id: 'log-001', type: 's' }),
        buildAuth0LogEntry({ log_id: 'log-002', type: 'f' }),
        buildAuth0LogEntry({ log_id: 'log-003', type: 'ss' }),
      ];
      const evt = buildLogStreamEvent(events);
      await handler(evt);

      const logCalls = consoleSpy.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('"source":"auth0-audit"'),
      );
      expect(logCalls).toHaveLength(3);

      const categories = logCalls.map((call: unknown[]) => JSON.parse(call[0] as string).category);
      expect(categories).toEqual(['login-success', 'login-failure', 'signup-success']);
    });

    it('maps known event types to categories', async () => {
      const testCases = [
        { type: 's', expected: 'login-success' },
        { type: 'f', expected: 'login-failure' },
        { type: 'ss', expected: 'signup-success' },
        { type: 'fp', expected: 'login-failure-incorrect-password' },
        { type: 'scp', expected: 'password-change-success' },
        { type: 'gd_auth_succeed', expected: 'mfa-success' },
        { type: 'gd_auth_failed', expected: 'mfa-failure' },
        { type: 'slo', expected: 'logout-success' },
        { type: 'pwd_leak', expected: 'breached-password' },
      ];

      for (const { type, expected } of testCases) {
        consoleSpy.mockClear();
        const evt = buildLogStreamEvent([buildAuth0LogEntry({ type })]);
        await handler(evt);

        const logCalls = consoleSpy.mock.calls.filter(
          (call: unknown[]) =>
            typeof call[0] === 'string' && call[0].includes('"source":"auth0-audit"'),
        );
        const parsed = JSON.parse(logCalls[0][0] as string);
        expect(parsed.category).toBe(expected);
      }
    });

    it('maps unknown event types to "other"', async () => {
      const evt = buildLogStreamEvent([buildAuth0LogEntry({ type: 'zzzz_unknown_type' })]);
      await handler(evt);

      const logCalls = consoleSpy.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('"source":"auth0-audit"'),
      );
      const parsed = JSON.parse(logCalls[0][0] as string);
      expect(parsed).toMatchObject({
        event_type: 'zzzz_unknown_type',
        category: 'other',
      });
    });

    it('handles events with missing optional fields', async () => {
      const entry = {
        log_id: 'log-minimal',
        data: { type: 'sapi' },
      };
      const evt = buildLogStreamEvent([entry]);
      await handler(evt);

      const logCalls = consoleSpy.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('"source":"auth0-audit"'),
      );
      const parsed = JSON.parse(logCalls[0][0] as string);
      expect(parsed).toEqual({
        source: 'auth0-audit',
        log_id: 'log-minimal',
        event_type: 'sapi',
        category: 'management-api-success',
        timestamp: undefined,
        user_id: undefined,
        user_name: undefined,
        connection: undefined,
        client_id: undefined,
        ip: undefined,
        description: undefined,
        details: undefined,
      });
    });

    it('returns 200 for empty array without emitting event logs', async () => {
      const evt = buildLogStreamEvent([]);
      const result = await handler(evt);

      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({ received: true }),
      });

      const logCalls = consoleSpy.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('"source":"auth0-audit"'),
      );
      expect(logCalls).toHaveLength(0);
    });
  });
});
