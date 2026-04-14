import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Resource } from 'sst';

/**
 * Auth0 event type codes mapped to human-readable categories.
 * See: https://auth0.com/docs/deploy-monitor/logs/log-event-type-codes
 */
const AUTH0_EVENT_CATEGORIES: Record<string, string> = {
  // Authentication
  s: 'login-success',
  f: 'login-failure',
  fp: 'login-failure-incorrect-password',
  fu: 'login-failure-invalid-user',
  fsa: 'silent-auth-failure',
  ssa: 'silent-auth-success',

  // Signup
  ss: 'signup-success',
  fs: 'signup-failure',

  // Password
  scp: 'password-change-success',
  fcp: 'password-change-failure',
  scpr: 'password-reset-request-success',
  fcpr: 'password-reset-request-failure',

  // Email verification
  sv: 'email-verification-success',
  fv: 'email-verification-failure',
  svr: 'email-verification-request-success',
  fvr: 'email-verification-request-failure',
  sce: 'email-change-success',
  fce: 'email-change-failure',

  // MFA
  mfar: 'mfa-required',
  gd_start_auth: 'mfa-started',
  gd_auth_succeed: 'mfa-success',
  gd_auth_failed: 'mfa-failure',
  gd_auth_rejected: 'mfa-rejected',
  gd_start_enroll: 'mfa-enroll-started',
  gd_enrollment_complete: 'mfa-enroll-complete',
  gd_start_enroll_failed: 'mfa-enroll-failure',
  gd_unenroll: 'mfa-unenroll',
  gd_recovery_succeed: 'mfa-recovery-success',
  gd_recovery_failed: 'mfa-recovery-failure',
  gd_otp_rate_limit_exceed: 'mfa-rate-limit',

  // Logout
  slo: 'logout-success',
  flo: 'logout-failure',

  // Token exchange
  seacft: 'token-exchange-authz-code-success',
  feacft: 'token-exchange-authz-code-failure',
  seccft: 'token-exchange-client-credentials-success',
  feccft: 'token-exchange-client-credentials-failure',
  sertft: 'token-exchange-refresh-success',
  fertft: 'token-exchange-refresh-failure',

  // User management
  sdu: 'user-deletion-success',
  fdu: 'user-deletion-failure',
  scu: 'username-change-success',
  fcu: 'username-change-failure',
  scpn: 'phone-change-success',
  fcpn: 'phone-change-failure',

  // Security
  pwd_leak: 'breached-password',
  limit_mu: 'blocked-ip',
  limit_sul: 'blocked-account',
  limit_wc: 'blocked-account',
  api_limit: 'rate-limit',

  // Management API
  sapi: 'management-api-success',
  mgmt_api_read: 'management-api-read',

  // Passwordless
  cls: 'passwordless-code-link-sent',
  cs: 'passwordless-code-sent',

  // Invitations
  si: 'invitation-accepted',
  fi: 'invitation-failed',

  // Warnings
  w: 'login-warning',
  depnote: 'deprecation-notice',
};

interface Auth0LogEventData {
  type?: string;
  date?: string;
  ip?: string;
  user_id?: string;
  user_name?: string;
  connection?: string;
  client_id?: string;
  client_name?: string;
  description?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Auth0LogEvent {
  log_id: string;
  data: Auth0LogEventData;
}

/**
 * Auth0 Log Stream webhook handler — NO auth middleware.
 * Validates authorization token, emits structured JSON for each event,
 * and returns 200. Logs flow to Grafana Loki via the existing
 * CloudWatch → Firehose pipeline.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const authHeader = event.headers['authorization'];
  const expectedToken = Resource.Auth0LogStreamToken.value;

  if (!authHeader || authHeader !== expectedToken) {
    console.warn('[auth0-audit] Unauthorized request');
    return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : (event.body ?? '');

  let logs: Auth0LogEvent[];
  try {
    logs = JSON.parse(rawBody);
  } catch {
    console.error('[auth0-audit] Invalid JSON body');
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON' }) };
  }

  if (!Array.isArray(logs)) {
    console.error('[auth0-audit] Expected array payload');
    return { statusCode: 400, body: JSON.stringify({ message: 'Expected array' }) };
  }

  for (const log of logs) {
    const eventType = log.data?.type ?? 'unknown';
    const category = AUTH0_EVENT_CATEGORIES[eventType] ?? 'other';

    console.log(
      JSON.stringify({
        source: 'auth0-audit',
        log_id: log.log_id,
        event_type: eventType,
        category,
        timestamp: log.data?.date,
        user_id: log.data?.user_id,
        user_name: log.data?.user_name,
        connection: log.data?.connection,
        client_id: log.data?.client_id,
        ip: log.data?.ip,
        description: log.data?.description,
        details: log.data?.details,
      }),
    );
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
