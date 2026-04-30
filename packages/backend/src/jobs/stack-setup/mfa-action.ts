/**
 * Auth0 Post-Login Action for MFA enrollment and challenge.
 *
 * This file is type-checked at build time via the interfaces below, then
 * serialized to a string at runtime via Function.prototype.toString().
 * The resulting JS is deployed to Auth0 as a Post-Login Action.
 *
 * Do NOT import any modules here — Auth0 Actions run in an isolated sandbox
 * with only Node.js built-ins and explicitly declared dependencies.
 */

// ── Auth0 Action runtime types ──────────────────────────────────────────

export interface MfaFactor {
  type: string;
}

export interface PostLoginEvent {
  user: {
    enrolledFactors?: MfaFactor[];
    app_metadata?: Record<string, unknown>;
  };
}

export interface PostLoginApi {
  authentication: {
    enrollWithAny(factors: MfaFactor[]): void;
    challengeWithAny(factors: MfaFactor[]): void;
  };
  user: {
    setAppMetadata(key: string, value: unknown): void;
  };
}

// ── Action handler ──────────────────────────────────────────────────────

export async function onExecutePostLogin(event: PostLoginEvent, api: PostLoginApi): Promise<void> {
  const allMfaTypes = new Set([
    'otp',
    'webauthn-roaming',
    'webauthn-platform',
    'email',
    'recovery-code',
  ]);
  const enrolledFactors = (event.user.enrolledFactors || []).filter((f) => allMfaTypes.has(f.type));
  const hasMfa = enrolledFactors.length > 0;
  const mfaEnrolling = event.user.app_metadata?.mfa_enrolling === true;

  if (mfaEnrolling) {
    // User clicked "Enable" / "Add authenticator or key" — clear the flag and
    // offer strong-factor enrollment. This works whether or not the user
    // already has a strong factor, allowing additional methods to be added.
    // Email enrollment is handled server-side via the Management API.
    api.user.setAppMetadata('mfa_enrolling', false);
    api.authentication.enrollWithAny([
      { type: 'otp' },
      { type: 'webauthn-roaming' },
      { type: 'webauthn-platform' },
    ]);
    return;
  }

  if (hasMfa) {
    // Email is the weakest factor (same channel as password reset). Only allow
    // the email challenge when the user has nothing stronger enrolled — otherwise
    // anyone with the password could downgrade to email.
    const strongFactorTypes = new Set(['otp', 'webauthn-roaming', 'webauthn-platform']);
    const hasStrongFactor = enrolledFactors.some((f) => strongFactorTypes.has(f.type));
    const challengeTypes: MfaFactor[] = [
      { type: 'otp' },
      { type: 'webauthn-roaming' },
      { type: 'webauthn-platform' },
    ];
    if (!hasStrongFactor) {
      challengeTypes.push({ type: 'email' });
    }
    api.authentication.challengeWithAny(challengeTypes);
  }
  // No MFA enrolled and not enrolling — skip MFA.
}
