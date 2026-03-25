import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sst', () => ({
  Resource: {
    Auth0MgmtClientId: { value: 'mgmt-client-id' },
    Auth0MgmtClientSecret: { value: 'mgmt-client-secret' },
    Auth0MgmtRuntimeClientId: { value: 'mgmt-runtime-client-id' },
    Auth0MgmtRuntimeClientSecret: { value: 'mgmt-runtime-client-secret' },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

process.env.AUTH0_DOMAIN = 'test.auth0.com';

import {
  flagMfaEnrollment,
  getMfaEnrollments,
  enrollEmailMfa,
  deleteGuardianEnrollment,
  deleteAuthenticationMethod,
  deleteAllAuthenticators,
  getConnectionType,
  MFA_GUARDIAN_TYPES,
} from './auth0-management.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTokenResponse() {
  return new Response(JSON.stringify({ access_token: 'mgmt-token' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupFetchMock(responses: Array<{ match: string; response: Response }>) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = String(url);
    if (urlStr.includes('/oauth/token')) return mockTokenResponse();
    for (const { match, response } of responses) {
      if (urlStr.includes(match)) return response;
    }
    return new Response('Not found', { status: 404 });
  });
}

// ---------------------------------------------------------------------------
// getConnectionType
// ---------------------------------------------------------------------------

describe('getConnectionType', () => {
  it('extracts auth0 from sub', () => {
    expect(getConnectionType('auth0|abc123')).toBe('auth0');
  });

  it('extracts google-oauth2 from sub', () => {
    expect(getConnectionType('google-oauth2|123')).toBe('google-oauth2');
  });

  it('returns unknown for sub without pipe', () => {
    expect(getConnectionType('nopipe')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// MFA_GUARDIAN_TYPES
// ---------------------------------------------------------------------------

describe('MFA_GUARDIAN_TYPES', () => {
  it('includes authenticator, webauthn-roaming, webauthn-platform', () => {
    expect(MFA_GUARDIAN_TYPES.has('authenticator')).toBe(true);
    expect(MFA_GUARDIAN_TYPES.has('webauthn-roaming')).toBe(true);
    expect(MFA_GUARDIAN_TYPES.has('webauthn-platform')).toBe(true);
  });

  it('excludes email and other types', () => {
    expect(MFA_GUARDIAN_TYPES.has('email')).toBe(false);
    expect(MFA_GUARDIAN_TYPES.has('sms')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// flagMfaEnrollment
// ---------------------------------------------------------------------------

describe('flagMfaEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls PATCH with mfa_enrolling: true in app_metadata', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (String(url).includes('/api/v2/users/') && init?.method === 'PATCH') {
        capturedBody = JSON.parse(init.body as string);
        return new Response('{}', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    await flagMfaEnrollment('auth0|abc123');

    expect(capturedBody).toEqual({
      app_metadata: { mfa_enrolling: true },
    });
  });
});

// ---------------------------------------------------------------------------
// getMfaEnrollments
// ---------------------------------------------------------------------------

describe('getMfaEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only confirmed MFA-type enrollments (excludes email by default)', async () => {
    setupFetchMock([
      {
        match: '/enrollments',
        response: new Response(
          JSON.stringify([
            { id: 'otp|1', type: 'authenticator', status: 'confirmed', name: 'My OTP' },
            { id: 'email|2', type: 'email', status: 'confirmed', name: 'auto email' },
            { id: 'webauthn|3', type: 'webauthn-roaming', status: 'confirmed', name: 'My key' },
            { id: 'otp|4', type: 'authenticator', status: 'unconfirmed' },
          ]),
          { status: 200 },
        ),
      },
    ]);

    const result = await getMfaEnrollments('auth0|abc123');

    expect(result).toEqual([
      { id: 'otp|1', type: 'authenticator', status: 'confirmed', name: 'My OTP' },
      { id: 'webauthn|3', type: 'webauthn-roaming', status: 'confirmed', name: 'My key' },
    ]);
  });

  it('includes email enrollments when includeEmail is true', async () => {
    setupFetchMock([
      {
        match: '/enrollments',
        response: new Response(
          JSON.stringify([
            { id: 'otp|1', type: 'authenticator', status: 'confirmed', name: 'My OTP' },
            { id: 'email|2', type: 'email', status: 'confirmed', name: 'auto email' },
            { id: 'webauthn|3', type: 'webauthn-roaming', status: 'confirmed', name: 'My key' },
          ]),
          { status: 200 },
        ),
      },
    ]);

    const result = await getMfaEnrollments('auth0|abc123', { includeEmail: true });

    expect(result).toEqual([
      { id: 'otp|1', type: 'authenticator', status: 'confirmed', name: 'My OTP' },
      { id: 'email|2', type: 'email', status: 'confirmed', name: 'auto email' },
      { id: 'webauthn|3', type: 'webauthn-roaming', status: 'confirmed', name: 'My key' },
    ]);
  });

  it('returns empty array when no MFA enrollments exist', async () => {
    setupFetchMock([
      {
        match: '/enrollments',
        response: new Response(
          JSON.stringify([{ id: 'email|1', type: 'email', status: 'confirmed' }]),
          { status: 200 },
        ),
      },
    ]);

    const result = await getMfaEnrollments('auth0|abc123');

    expect(result).toEqual([]);
  });

  it('throws on API error', async () => {
    setupFetchMock([
      {
        match: '/enrollments',
        response: new Response('Forbidden', { status: 403 }),
      },
    ]);

    await expect(getMfaEnrollments('auth0|abc123')).rejects.toThrow(
      'Auth0 list enrollments failed (403): Forbidden',
    );
  });
});

// ---------------------------------------------------------------------------
// enrollEmailMfa
// ---------------------------------------------------------------------------

describe('enrollEmailMfa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls POST on authentication-methods with email type', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (String(url).includes('/authentication-methods') && init?.method === 'POST') {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init.body as string);
        return new Response('{}', { status: 201 });
      }
      return new Response('Not found', { status: 404 });
    });

    await enrollEmailMfa('auth0|abc123', 'user@example.com');

    expect(capturedUrl).toContain('/api/v2/users/auth0%7Cabc123/authentication-methods');
    expect(capturedBody).toEqual({
      type: 'email',
      name: 'Email',
      email: 'user@example.com',
    });
  });

  it('throws on API error', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (init?.method === 'POST') {
        return new Response('Conflict', { status: 409 });
      }
      return new Response('Not found', { status: 404 });
    });

    await expect(enrollEmailMfa('auth0|abc123', 'user@example.com')).rejects.toThrow(
      'Auth0 enroll email MFA failed (409): Conflict',
    );
  });
});

// ---------------------------------------------------------------------------
// deleteGuardianEnrollment
// ---------------------------------------------------------------------------

describe('deleteGuardianEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls DELETE on the guardian enrollments endpoint', async () => {
    let deletedUrl: string | undefined;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (String(url).includes('/guardian/enrollments/') && init?.method === 'DELETE') {
        deletedUrl = String(url);
        return new Response('', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    await deleteGuardianEnrollment('webauthn-roaming|dev_abc');

    expect(deletedUrl).toContain(
      `/api/v2/guardian/enrollments/${encodeURIComponent('webauthn-roaming|dev_abc')}`,
    );
  });

  it('throws on API error', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (init?.method === 'DELETE') {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    });

    await expect(deleteGuardianEnrollment('nonexistent')).rejects.toThrow(
      'Auth0 delete enrollment failed (404): Not found',
    );
  });
});

// ---------------------------------------------------------------------------
// deleteAuthenticationMethod
// ---------------------------------------------------------------------------

describe('deleteAuthenticationMethod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls DELETE on the authentication-methods endpoint', async () => {
    let deletedUrl: string | undefined;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (String(url).includes('/authentication-methods/') && init?.method === 'DELETE') {
        deletedUrl = String(url);
        return new Response(null, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    await deleteAuthenticationMethod('auth0|abc123', 'email|dev_abc');

    expect(deletedUrl).toContain(
      `/api/v2/users/${encodeURIComponent('auth0|abc123')}/authentication-methods/${encodeURIComponent('email|dev_abc')}`,
    );
  });

  it('throws on API error', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) return mockTokenResponse();
      if (init?.method === 'DELETE') {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    });

    await expect(deleteAuthenticationMethod('auth0|abc123', 'nonexistent')).rejects.toThrow(
      'Auth0 delete authentication method failed (404): Not found',
    );
  });
});

// ---------------------------------------------------------------------------
// deleteAllAuthenticators
// ---------------------------------------------------------------------------

describe('deleteAllAuthenticators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes Guardian and email enrollments then clears mfa_enrolling flag', async () => {
    const guardianDeletedIds: string[] = [];
    const authMethodDeletedUrls: string[] = [];
    let patchBody: Record<string, unknown> | undefined;

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/oauth/token')) return mockTokenResponse();
      if (urlStr.includes('/enrollments') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify([
            { id: 'otp|1', type: 'authenticator', status: 'confirmed' },
            { id: 'webauthn|2', type: 'webauthn-roaming', status: 'confirmed' },
            { id: 'email|3', type: 'email', status: 'confirmed' },
          ]),
          { status: 200 },
        );
      }
      if (urlStr.includes('/guardian/enrollments/') && init?.method === 'DELETE') {
        const id = urlStr.split('/guardian/enrollments/')[1];
        guardianDeletedIds.push(id);
        return new Response('', { status: 200 });
      }
      if (urlStr.includes('/authentication-methods/') && init?.method === 'DELETE') {
        authMethodDeletedUrls.push(urlStr);
        return new Response(null, { status: 200 });
      }
      if (urlStr.includes('/api/v2/users/') && init?.method === 'PATCH') {
        patchBody = JSON.parse(init.body as string);
        return new Response('{}', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    await deleteAllAuthenticators('auth0|abc123');

    expect(guardianDeletedIds).toEqual([
      encodeURIComponent('otp|1'),
      encodeURIComponent('webauthn|2'),
    ]);
    expect(authMethodDeletedUrls).toHaveLength(1);
    expect(authMethodDeletedUrls[0]).toContain('/authentication-methods/');
    expect(patchBody).toEqual({
      app_metadata: { mfa_enrolling: false },
    });
  });

  it('deletes email-only enrollments via authentication-methods', async () => {
    const authMethodDeletedUrls: string[] = [];
    let patchBody: Record<string, unknown> | undefined;

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/oauth/token')) return mockTokenResponse();
      if (urlStr.includes('/enrollments') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify([{ id: 'email|1', type: 'email', status: 'confirmed' }]),
          { status: 200 },
        );
      }
      if (urlStr.includes('/authentication-methods/') && init?.method === 'DELETE') {
        authMethodDeletedUrls.push(urlStr);
        return new Response(null, { status: 200 });
      }
      if (urlStr.includes('/api/v2/users/') && init?.method === 'PATCH') {
        patchBody = JSON.parse(init.body as string);
        return new Response('{}', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    await deleteAllAuthenticators('auth0|abc123');

    expect(authMethodDeletedUrls).toHaveLength(1);
    expect(patchBody).toEqual({
      app_metadata: { mfa_enrolling: false },
    });
  });
});
