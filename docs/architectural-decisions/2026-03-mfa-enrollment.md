# ADR: Multi-Factor Authentication

**Status:** Proposed
**Created:** 2026-04-29
**Last updated:** 2026-04-29

## Context

The platform authenticates users via Auth0 with an authorization code flow, HTTP-only cookie sessions, and social login support (Google, GitHub) alongside native Auth0 username/password. Enterprise clients expect MFA as a security baseline, but the current Settings page shows a disabled "Enable" button with placeholder text. No MFA factors are configured in Auth0.

MFA must be opt-in per user (not org-enforced), must not require ongoing per-use costs, and must work for all connection types (database and social). The enrollment flow should reuse Auth0 Universal Login rather than building a custom enrollment UI.

## Options Considered

### MFA Factors

| Factor                            | Pros                                      | Cons                                                               |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| OTP (authenticator app)           | Free, no vendor dependency, works offline | User must install an app                                           |
| WebAuthn (passkeys/security keys) | Phishing-resistant, great UX              | Device/browser support varies                                      |
| Email (one-time code)             | No app install, low friction              | Weakest factor, less useful if email is the login method           |
| SMS                               | Familiar, no app install                  | Auth0 charges ~$0.008-0.05/message via Twilio, SIM-swap vulnerable |

SMS is excluded due to per-message cost and SIM-swap vulnerability. The remaining three factors cover the security spectrum: OTP for offline-capable security, WebAuthn for phishing resistance, and email for low-friction challenge.

Email cannot be enrolled through Auth0 Actions (`enrollWithAny` does not accept `email`), but the Management API's `POST /api/v2/users/{id}/authentication-methods` endpoint will create a confirmed email factor _only when no other factors exist_. We use that to offer email as a zero-redirect first-factor on-ramp; users who want a strong factor go through Universal Login enrollment. The two paths cannot coexist: enrolling a strong factor must replace the email factor first.

### Enrollment Approach

**Custom enrollment UI** — Build our own TOTP secret display, QR code generation, and WebAuthn registration. Rejected because it duplicates what Auth0 Universal Login already provides and introduces security surface area.

**`acr_values` parameter** — Force a fresh login with `acr_values` requesting MFA. Rejected because Auth0 does not reliably pass `acr_values` to Post-Login Actions in all configurations.

**`app_metadata.mfa_enrolling` flag** — Backend sets a flag, the Post-Login Action reads it and triggers enrollment. The flag is a one-time signal, not a source of truth. Chosen because it reliably triggers enrollment through Auth0's Action system.

### MFA Status Source of Truth

Auth0 stores MFA factors in two endpoints, neither of which is a superset of the other:

- **Guardian enrollments** — `GET /api/v2/users/{id}/enrollments`. Returns OTP and WebAuthn (`webauthn-roaming`, `webauthn-platform`) factors. Does NOT return email. This is what Auth0 Actions enroll into via `enrollWithAny`.
- **Authentication methods** — `GET /api/v2/users/{id}/authentication-methods`. Returns email factors (and password, social identities, etc.). Does NOT mirror Guardian enrollments.

`getMfaEnrollments(sub, { includeEmail: true })` queries both endpoints and merges the results, normalizing email entries into the same shape as Guardian enrollments so the UI and deletion paths can treat them uniformly. Deletion routes by type — Guardian factors hit `DELETE /api/v2/guardian/enrollments/{id}`, email factors hit `DELETE /api/v2/users/{id}/authentication-methods/{id}`.

The merged read is only performed when `?include=mfa` is passed to `GET /api/me` (currently only the Settings page).

## Decision

Enable **OTP, WebAuthn (roaming + platform), and Email** as MFA factors in Auth0. Set the MFA policy to **"Never"**. SMS is excluded. MFA is opt-in per user and available for all connection types (database and social).

The MFA policy is "Never" because enrollment and challenge are controlled entirely by a Post-Login Action plus a server-side email-enrollment endpoint. The Action uses `app_metadata.mfa_enrolling` as a one-time enrollment trigger and checks `enrolledFactors` to challenge enrolled users on every login.

The Action is created, deployed, and bound to the post-login trigger automatically by the `setup-integrations` deploy Lambda (staging/production only).

### Auth0 MFA Architecture

Auth0 splits MFA across two systems with different APIs and capabilities:

- **Guardian factors** — `otp`, `webauthn-roaming`, `webauthn-platform`, `push-notification`, `recovery-code`. Enrolled by Actions via `enrollWithAny`. Listed via `GET /api/v2/users/{id}/enrollments`. Deleted via `DELETE /api/v2/guardian/enrollments/{id}`.
- **Authentication methods** — `email` (for our purposes), plus `password`, social identities, etc. Created via `POST /api/v2/users/{id}/authentication-methods`. Listed via `GET /api/v2/users/{id}/authentication-methods`. Deleted via `DELETE /api/v2/users/{id}/authentication-methods/{id}`.

Action capabilities:

- `enrollWithAny(factors)` shows a selection screen — accepts Guardian factor types only; **email is not supported**
- `challengeWithAny(factors)` shows a selection screen — accepts all factor types including `email`
- `event.user.enrolledFactors` includes every factor type (social identities, password, MFA factors, etc.) — code must filter to MFA types before deciding `hasMfa`

### Post-Login Action

```js
exports.onExecutePostLogin = async (event, api) => {
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

  // Email is the weakest factor (same channel as password reset). Only allow
  // the email challenge when the user has nothing stronger enrolled — otherwise
  // anyone with the password could downgrade to email.
  const strongFactorTypes = new Set(['otp', 'webauthn-roaming', 'webauthn-platform']);
  const hasStrongFactor = enrolledFactors.some((f) => strongFactorTypes.has(f.type));
  const challengeTypes = [
    { type: 'otp' },
    { type: 'webauthn-roaming' },
    { type: 'webauthn-platform' },
  ];
  if (!hasStrongFactor) challengeTypes.push({ type: 'email' });

  if (mfaEnrolling && !hasMfa) {
    api.authentication.enrollWithAny([
      { type: 'otp' },
      { type: 'webauthn-roaming' },
      { type: 'webauthn-platform' },
    ]);
  } else if (mfaEnrolling && hasMfa) {
    api.user.setAppMetadata('mfa_enrolling', false);
    api.authentication.challengeWithAny(challengeTypes);
  } else if (hasMfa) {
    api.authentication.challengeWithAny(challengeTypes);
  }
};
```

The canonical source is `packages/backend/src/jobs/stack-setup/mfa-action.ts` — that file is type-checked, then serialized via `Function.prototype.toString()` and deployed to Auth0 by `setup-integrations.ts`. Email enrollment never goes through this Action; it is created server-side via the Management API (see Path 1 below).

### Enrollment Flow

There are two entry points from the Settings page, gated by Auth0's "email-only-when-no-other-factors" Management API constraint.

**Path 1 — Email (low friction, no redirect):**

1. User clicks "Enable with email" on the Settings page
2. Frontend calls `POST /api/mfa/enroll-email`
3. Backend re-checks no factors are enrolled (including email) and calls `POST /api/v2/users/{id}/authentication-methods` to create a confirmed email factor
4. Settings page invalidates the MFA cache and shows the email enrollment as enabled
5. On the next login, the Post-Login Action sees the email factor in `event.user.enrolledFactors` and challenges with a 6-digit email code

**Path 2 — Authenticator app or security key (Universal Login):**

1. User clicks "Enable with authenticator app or security key" (or "Add authenticator or key" if they already have email enrolled)
2. **If only email is currently enrolled**, the UI opens a `ConfirmDialog` warning that the email factor will be replaced. On confirm:
3. Frontend calls `POST /api/mfa/enroll`. Backend deletes any existing email authentication-method (Auth0 will not enroll a strong factor while another factor is present, and the Action's "no MFA" branch only fires when `hasMfa === false`), then sets `app_metadata.mfa_enrolling: true`
4. Frontend redirects to `/login`, which initiates Universal Login
5. The Post-Login Action sees `mfa_enrolling === true` and `hasMfa === false`, calls `enrollWithAny([otp, webauthn-roaming, webauthn-platform])`
6. User enrolls; Auth0 Universal Login handles the entire enrollment UX
7. On the next login (immediately after enrollment), the Action sees `mfa_enrolling === true && hasMfa === true`, clears the flag, and challenges

If the user abandons enrollment, the `mfa_enrolling` flag remains set. The next login re-triggers enrollment. Once enrolled, the Action clears the flag.

**Self-heal on read.** Auth0 may attach an email authentication-method to a user automatically because their email is verified. When `GET /api/me?include=mfa` runs and finds _both_ a strong factor and an email factor, the handler deletes the email auth-method and excludes it from the response. This keeps the settings list and the login challenge list (which already excludes email when a strong factor exists) in sync with each other and with Auth0.

### Disable Flow

Both flows show a `ConfirmDialog` modal before destructive action.

**Remove individual enrollment:**

1. Settings page shows each enrolled factor (including email) with a "Remove" button
2. User confirms in the modal
3. Frontend calls `DELETE /api/mfa/enrollments/{enrollmentId}`
4. Backend re-fetches enrollments to verify the ID belongs to this user, then routes by type:
   - `email` → `DELETE /api/v2/users/{id}/authentication-methods/{id}`
   - everything else → `DELETE /api/v2/guardian/enrollments/{id}`
5. If the last enrollment was removed, clears `mfa_enrolling` flag

**Remove all:**

1. User clicks "Remove all MFA methods" on Settings page and confirms in the modal
2. Frontend calls `POST /api/mfa/disable`
3. Backend iterates all enrollments (Guardian and email) and deletes via the appropriate endpoint, then clears `mfa_enrolling`

### Social Login Users

Social login users (Google, GitHub) can enroll in Auth0 MFA. Auth0 is the session authority regardless of the upstream identity provider — after the social provider returns, Auth0 challenges with MFA before completing the login. The Settings page shows the same MFA UI for all users.

### Auth0 Dashboard Configuration Required

1. **Enable factors** (Security > Multi-factor Auth): OTP, WebAuthn with FIDO Security Keys, WebAuthn with FIDO Device Biometrics, Email
   - "FIDO Device Biometrics" is what surfaces platform passkeys (Touch ID, Face ID, Windows Hello, Android biometrics) on the enrollment screen. Without it, only OTP and hardware security keys appear.
2. **Set MFA policy to "Never"** — the Post-Login Action controls all MFA behavior
3. **Enable "Customize MFA Factors using Actions"** under additional settings — without this, `event.user.enrolledFactors` is `undefined` in the Action
4. **Configure the Auth0 email provider** with an external SMTP provider (SendGrid) for production — Auth0's built-in test provider has strict rate limits and is unsuitable for email MFA codes
5. **Post-Login Action** — automated via `setup-integrations` deploy Lambda (staging/production)

### Management API Scopes

| Scope                           | Used by                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `read:users`                    | `getMfaEnrollments()` — lists Guardian enrollments                                            |
| `update:users`                  | `updateAuth0User()` — sets/clears `mfa_enrolling` flag                                        |
| `update:users_app_metadata`     | `flagMfaEnrollment()` — sets `mfa_enrolling` flag                                             |
| `read:authentication_methods`   | `getMfaEnrollments()` — lists email authentication methods                                    |
| `create:authentication_methods` | `enrollEmailMfa()` — creates the email factor for Path 1                                      |
| `delete:authentication_methods` | `deleteAuthenticationMethod()` — removes email factors                                        |
| `delete:guardian_enrollments`   | `deleteGuardianEnrollment()` / `deleteAllAuthenticators()` — removes OTP/WebAuthn enrollments |
| `create:actions`                | Deploy-time setup — creates the MFA Post-Login Action                                         |
| `read:actions`                  | Deploy-time setup — checks if the Action already exists                                       |
| `update:actions`                | Deploy-time setup — updates the Action code if changed                                        |
| `read:triggers`                 | Deploy-time setup — reads the Login flow bindings                                             |
| `update:triggers`               | Deploy-time setup — binds the Action to the Login flow                                        |

### Backend Changes

- **`auth0-management.ts`** — `getMfaEnrollments(sub, { includeEmail })` queries Guardian `/enrollments` and (optionally) `/authentication-methods` and merges email entries into the same shape; `flagMfaEnrollment(sub)` sets `mfa_enrolling`; `enrollEmailMfa(sub, email)` creates the email factor; `deleteGuardianEnrollment(id)` removes OTP/WebAuthn; `deleteAuthenticationMethod(sub, id)` removes email; `deleteAllAuthenticators(sub)` removes everything and clears the flag
- **`enroll-mfa.ts`** — `POST /api/mfa/enroll` — rejects if a strong factor is enrolled; deletes any existing email factor (so the Action's "no MFA" branch fires); sets `mfa_enrolling: true`; returns 200 so the frontend can redirect
- **`enroll-email-mfa.ts`** — `POST /api/mfa/enroll-email` — rejects if any factor (including email) is enrolled; calls `enrollEmailMfa()` synchronously; no redirect required
- **`disable-mfa.ts`** — `POST /api/mfa/disable` — deletes Guardian and email enrollments and clears `mfa_enrolling`
- **`delete-mfa-enrollment.ts`** — `DELETE /api/mfa/enrollments/{enrollmentId}` — verifies ownership, routes to Guardian or authentication-methods deletion based on type, clears flag if it was the last one
- **`get-me.ts`** — returns `mfaEnrollments` when `?include=mfa` is passed; self-heals orphaned email auth-methods when a strong factor is also enrolled
- **`MeResponse`** (shared types) — `MfaEnrollment` interface (`id`, `type`, `name?`, `createdAt`) and `mfaEnrollments: MfaEnrollment[]` (always present, populated only when `?include=mfa` is requested)
- **`sst.config.ts`** — four MFA routes registered: `/mfa/enroll`, `/mfa/enroll-email`, `/mfa/disable`, `/mfa/enrollments/{enrollmentId}`
- **`setup-integrations.ts`** — deploy-time Lambda creates the Post-Login Action, polls for `built` status, deploys it, and ensures it is bound to the post-login trigger while preserving any existing bindings (staging/production only — dev stages share an Auth0 tenant and would race on the global Action name). Email provider setup is fatal — without it, email MFA, email verification, and password reset all break.

### Frontend Changes

- **`api.ts`** — `enrollMfa(): Promise<void>` posts to `/mfa/enroll` then calls `redirectToLogin()`; `enrollEmailMfa(): Promise<{ message }>` posts to `/mfa/enroll-email`; `disableMfa()` removes all; `deleteMfaEnrollment(id)` removes a single enrollment
- **`MfaSettings.tsx`** (extracted component) — renders the MFA section under the Security `SectionCard`. When no factor is enrolled, shows two choice cards: "Enable with email" (Path 1) and "Enable with authenticator app or security key" (Path 2). When factors are enrolled, lists each one (`EnrollmentRow`) with a Remove button and shows "Add authenticator or key" plus "Remove all MFA methods". All confirmations use the shared `ConfirmDialog` modal: replace-email (when adding a strong factor over email), per-method removal, and remove-all
- **`SettingRow.tsx`** (extracted shared component) — used by `SettingsPage` (for Password) and `MfaSettings` (for the MFA header row); was previously duplicated inline in both files
- **`SettingsPage.tsx`** — fetches `getMe({ include: 'mfa' })` and renders `<MfaSettings>` inside the Security section

## Future Enhancements (Out of Scope)

- **Step-up auth** — require fresh MFA for sensitive actions (disable MFA, delete account)
- **Org-level MFA enforcement** — org setting `requireMfa: boolean` that forces all members to enroll
- **View recovery codes** — custom UI to regenerate/display recovery codes post-enrollment
- **Remember device** — Auth0 can skip MFA on trusted devices for 30 days

## Risks

### Auth0 Management API Rate Limits

`getMfaEnrollments(sub, { includeEmail: true })` issues two Management API calls per Settings page load (`/enrollments` and `/authentication-methods`). The orphan self-heal in `get-me.ts` adds a third call only when a strong factor and an email factor coexist — typically once, then never again. Auth0's Management API rate limit is 50 req/s on free/essentials plans. At current scale this is not a concern.

### Auth0 Guardian vs Authentication Methods Split

The two endpoints do not share data and are unlikely to be unified soon. The merge in `getMfaEnrollments` papers over the split for read paths; deletion explicitly routes by type. If Auth0 ever moves email into Guardian (or removes the Guardian endpoint in favor of authentication-methods only), both paths will need updating.

### Email Provider Setup is Fatal at Deploy Time

`setupAuth0EmailProvider` in the deploy Lambda is intentionally not wrapped in error handling — a failure fails the CloudFormation custom resource and blocks the deploy. Without a working email provider, email MFA, email verification, and password reset are all broken; a deploy failure is preferable to silently broken email flows.

### Action Name is Global per Tenant

`MFA Enrollment Trigger` is a global name within a single Auth0 tenant. Today only the staging stage mutates it in FilOneDev, and production uses a separate tenant. If a future change widens the `setup-integrations` gate to deploy from multiple stages into the same tenant, those stages will race on the Action `code`.

### No Step-Up Auth and No Rate Limiting on MFA Endpoints

Any authenticated session can disable MFA without re-verifying. The endpoints rely on the same auth + CSRF protection as other API routes; there is no per-user throttling. Mitigated by CSRF (an attacker needs the token) and 1-hour access-token expiry. Step-up auth is listed in Future Enhancements.

## Consequences

- MFA is opt-in per user. All connection types (database and social) can enroll.
- The strong-factor enrollment UX is delegated to Auth0 Universal Login; the email enrollment UX is server-side via the Management API and surfaces no redirect to the user.
- The source of truth for MFA status is the union of Guardian `/enrollments` (OTP, WebAuthn) and authentication-methods (email). `getMfaEnrollments` merges them into a single shape for the UI; deletion routes by type.
- Email and a strong factor cannot coexist: enrolling a strong factor first deletes any existing email factor, and `get-me` self-heals if Auth0 attaches one back. Login challenges exclude email when a strong factor is enrolled.
- `app_metadata.mfa_enrolling` is a one-time enrollment trigger only — never a source of truth.
- Abandoned strong-factor enrollment attempts leave `mfa_enrolling: true` — harmless; re-triggers on next login. Once enrolled, the Action clears the flag.
- All four MFA factor types (OTP, WebAuthn-roaming, WebAuthn-platform, email) are enrollable and challengeable; recovery codes are auto-issued by Auth0 during strong-factor enrollment but are not surfaced in our UI.
- Users can view, add, and individually remove MFA methods from the Settings page; all destructive actions are gated by a `ConfirmDialog` modal.
- The Post-Login Action is deployed automatically via the `setup-integrations` Lambda on staging and production. Dev stacks share an Auth0 tenant, so the Action is not deployed from dev — testing on dev runs against whatever was last deployed by staging.
