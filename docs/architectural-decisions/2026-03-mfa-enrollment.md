# ADR: Multi-Factor Authentication

**Status:** Proposed
**Created:** 2026-04-29
**Last updated:** 2026-04-30

## Context

The platform authenticates users via Auth0 with an authorization code flow, HTTP-only cookie sessions, and social login support (Google, GitHub) alongside native Auth0 username/password. Enterprise clients expect MFA as a security baseline, but the current Settings page shows a disabled "Enable" button with placeholder text. No MFA factors are configured in Auth0.

MFA must be opt-in per user (not org-enforced), must not require ongoing per-use costs, and must work for all connection types (database and social). The enrollment flow should reuse Auth0 Universal Login rather than building a custom enrollment UI.

## Options Considered

### MFA Factors

| Factor                            | Pros                                      | Cons                                                                                                                                      |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OTP (authenticator app)           | Free, no vendor dependency, works offline | User must install an app                                                                                                                  |
| WebAuthn (passkeys/security keys) | Phishing-resistant, great UX              | Device/browser support varies                                                                                                             |
| Email (one-time code)             | No app install, low friction              | Same channel as password reset (not a true second factor); Auth0 auto-enrolls every verified-email user when the factor is on tenant-wide |
| SMS                               | Familiar, no app install                  | Auth0 charges ~$0.008-0.05/message via Twilio, SIM-swap vulnerable                                                                        |

**Email and SMS are excluded.** SMS for cost and SIM-swap. Email because it shares the recovery channel with password reset — anyone able to read the user's email can already reset the password, so the email code adds little real defense — and because supporting it required a meaningful amount of code to work around Auth0's behavior of silently auto-enrolling every verified-email user into email MFA whenever the tenant-level email factor is on. The product decision is that "two-factor" means a real second channel: an authenticator app, a security key, or a platform passkey.

The remaining factors are **OTP**, **WebAuthn (roaming)** for hardware security keys, and **WebAuthn (platform)** for device biometrics (Touch ID, Face ID, Windows Hello, Android biometrics).

### Enrollment Approach

**Custom enrollment UI** — Build our own TOTP secret display, QR code generation, and WebAuthn registration. Rejected because it duplicates what Auth0 Universal Login already provides and introduces security surface area.

**`acr_values` parameter** — Force a fresh login with `acr_values` requesting MFA. Rejected because Auth0 does not reliably pass `acr_values` to Post-Login Actions in all configurations.

**`app_metadata.mfa_enrolling` flag** — Backend sets a flag, the Post-Login Action reads it and triggers enrollment. The flag is a one-time signal, not a source of truth. Chosen because it reliably triggers enrollment through Auth0's Action system.

### MFA Status Source of Truth

Auth0 stores MFA factors in two endpoints. The earlier assumption that Guardian was authoritative for OTP/WebAuthn turned out to be wrong: Guardian's `/enrollments` predates WebAuthn entirely (it never returns `webauthn-roaming`/`webauthn-platform`) and modern Auth0 only mirrors a subset of factors into it.

- **Authentication methods** (modern, unified) — `GET /api/v2/users/{id}/authentication-methods`. Returns every factor: TOTP (as `type: 'totp'`), `webauthn-roaming`, `webauthn-platform`, plus `password` and social identities. Newly-added factors land here only.
- **Guardian enrollments** (legacy) — `GET /api/v2/users/{id}/enrollments`. Returns OTP enrollments for users that predate the unified API. Does not contain WebAuthn at all in current Auth0.

`getMfaEnrollments(sub)` queries both endpoints in parallel. It pulls TOTP and WebAuthn from `/authentication-methods` as the primary source, and falls back to Guardian for `authenticator` only when `/authentication-methods` has no `totp` entry — that fallback covers legacy users who never got an auth-methods record. Email rows are filtered out unconditionally; the email factor is disabled tenant-wide (see "Auth0 Dashboard Configuration Required") so they should never appear, but the filter is belt-and-braces against a misconfigured tenant.

Each merged entry carries an internal `source: 'guardian' | 'auth-methods'` field. The two endpoints assign different ids for the same factor (Guardian: `otp|...`, auth-methods: `totp|...`), so source is the only reliable way to choose the right delete endpoint:

- `source: 'guardian'` → `DELETE /api/v2/guardian/enrollments/{id}`
- `source: 'auth-methods'` → `DELETE /api/v2/users/{id}/authentication-methods/{id}`

The merged read is only performed when `?include=mfa` is passed to `GET /api/me` (currently only the Settings page).

## Decision

Enable **OTP and WebAuthn (roaming + platform)** as MFA factors in Auth0. Set the MFA policy to **"Never"**. Email and SMS are excluded. MFA is opt-in per user and available for all connection types (database and social).

The MFA policy is "Never" because enrollment and challenge are controlled entirely by a Post-Login Action. The Action uses `app_metadata.mfa_enrolling` as a one-time enrollment trigger and checks `enrolledFactors` to challenge enrolled users on every login.

The Action is created, deployed, and bound to the post-login trigger automatically by the `setup-integrations` deploy Lambda (staging/production only).

### Auth0 MFA Architecture

Auth0 stores factors in two endpoints with different ids per factor:

- **Authentication methods** (modern, unified) — Lists every factor: TOTP (`type: 'totp'`), WebAuthn (`webauthn-roaming`, `webauthn-platform`), plus `password` and social identities. Populated by Auth0 itself when factors enroll via Universal Login. Listed via `GET /api/v2/users/{id}/authentication-methods`. Deleted via `DELETE /api/v2/users/{id}/authentication-methods/{id}`.
- **Guardian enrollments** (legacy) — Predates WebAuthn; returns OTP and a few other Guardian-managed types but never `webauthn-roaming`/`webauthn-platform`. Listed via `GET /api/v2/users/{id}/enrollments`. Deleted via `DELETE /api/v2/guardian/enrollments/{id}`. Used as a fallback for legacy OTP users only.

Action capabilities:

- `enrollWithAny(factors)` shows a selection screen.
- `challengeWithAny(factors)` shows a selection screen.
- A single Action invocation can call **both** `challengeWithAny` and `enrollWithAny`. They queue and execute in order within one login transaction — the user is challenged with an existing factor first, then enrolls a new one. This is how multiple strong factors stack: Auth0 rejects `enrollWithAny` alone for already-enrolled users with "Something went wrong"; the chained challenge satisfies its precondition.
- `event.user.enrolledFactors` includes every factor type (social identities, password, MFA factors, etc.) — code must filter to MFA types before deciding `hasMfa`.

### Post-Login Action

```js
exports.onExecutePostLogin = async (event, api) => {
  const mfaTypes = new Set(['otp', 'webauthn-roaming', 'webauthn-platform', 'recovery-code']);
  const enrolledFactors = (event.user.enrolledFactors || []).filter((f) => mfaTypes.has(f.type));
  const hasMfa = enrolledFactors.length > 0;
  const mfaEnrolling = event.user.app_metadata?.mfa_enrolling === true;

  const factors = [{ type: 'otp' }, { type: 'webauthn-roaming' }, { type: 'webauthn-platform' }];

  if (mfaEnrolling) {
    api.user.setAppMetadata('mfa_enrolling', false);
    if (hasMfa) api.authentication.challengeWithAny(factors);
    api.authentication.enrollWithAny(factors);
    return;
  }

  if (hasMfa) api.authentication.challengeWithAny(factors);
};
```

The canonical source is `packages/backend/src/jobs/stack-setup/mfa-action.ts` — that file is type-checked, then serialized via `Function.prototype.toString()` and deployed to Auth0 by `setup-integrations.ts`.

The chained `challengeWithAny` + `enrollWithAny` is the mechanism that lets users add a second strong factor on top of an existing one. Calling `enrollWithAny` alone on an already-enrolled user surfaces "Something went wrong" on `/authorize`; the prior challenge is the precondition Auth0 requires.

### Enrollment Flow

There is one entry point from the Settings page:

1. User clicks "Enable" (first enrollment) or "Add authenticator or key" (additional strong factor)
2. Frontend calls `POST /api/mfa/enroll`. Backend sets `app_metadata.mfa_enrolling: true`. The handler does **not** reject when a strong factor already exists — adding a second strong factor is a supported path
3. Frontend redirects to `/login`, which initiates Universal Login
4. The Post-Login Action sees `mfa_enrolling === true`. It clears the flag, and:
   - If `hasMfa === false` (first enrollment): calls `enrollWithAny([otp, webauthn-roaming, webauthn-platform])` directly
   - If `hasMfa === true` (additional strong factor): calls `challengeWithAny(factors)` **then** `enrollWithAny(...)`. Auth0 runs both within one login transaction — the user proves possession of the existing factor before enrolling the new one
5. User enrolls; Auth0 Universal Login handles the entire enrollment UX
6. On the next login the flag is already cleared and the Action just challenges with the strong-factor list

If the user abandons enrollment, the `mfa_enrolling` flag has already been cleared (the Action clears it before calling `enrollWithAny`, in the same transaction), so the next login is a normal challenge — not a forced re-enrollment. They re-trigger enrollment by clicking "Add authenticator or key" again.

### Disable Flow

Both flows show a `ConfirmDialog` modal before destructive action.

**Remove individual enrollment:**

1. Settings page shows each enrolled factor with a "Remove" button
2. User confirms in the modal
3. Frontend calls `DELETE /api/mfa/enrollments/{enrollmentId}`
4. Backend re-fetches enrollments to verify the ID belongs to this user, then routes by `source` (each enrollment carries its endpoint of origin — see "MFA Status Source of Truth"):
   - `source: 'guardian'` → `DELETE /api/v2/guardian/enrollments/{id}`
   - `source: 'auth-methods'` → `DELETE /api/v2/users/{id}/authentication-methods/{id}`
5. If the last enrollment was removed, clear `mfa_enrolling`

**Remove all:**

1. User clicks "Remove all MFA methods" on Settings page and confirms in the modal
2. Frontend calls `POST /api/mfa/disable`
3. Backend iterates all enrollments and deletes each via its source endpoint, then patches `app_metadata` with `mfa_enrolling: false`

### Social Login Users

Social login users (Google, GitHub) can enroll in Auth0 MFA. Auth0 is the session authority regardless of the upstream identity provider — after the social provider returns, Auth0 challenges with MFA before completing the login. The Settings page shows the same MFA UI for all users.

### Auth0 Dashboard Configuration Required

1. **Enable factors** (Security > Multi-factor Auth): OTP, WebAuthn with FIDO Security Keys, WebAuthn with FIDO Device Biometrics
   - "FIDO Device Biometrics" is what surfaces platform passkeys (Touch ID, Face ID, Windows Hello, Android biometrics) on the enrollment screen. Without it, only OTP and hardware security keys appear.
   - **Do NOT enable the Email factor.** Enabling it tenant-wide causes Auth0 to auto-enroll every user with `email_verified: true` into email MFA, surfacing in `event.user.enrolledFactors`. The action filters unknown factor types but the simplest defense is leaving the factor off.
2. **Set MFA policy to "Never"** — the Post-Login Action controls all MFA behavior
3. **Enable "Customize MFA Factors using Actions"** under additional settings — without this, `event.user.enrolledFactors` is `undefined` in the Action
4. **Configure the Auth0 email provider** with an external SMTP provider (SendGrid) for production — required for email verification and password reset (independent of MFA). Auth0's built-in test provider has strict rate limits and is unsuitable for production flows
5. **Post-Login Action** — automated via `setup-integrations` deploy Lambda (staging/production)

### Management API Scopes

| Scope                           | Used by                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `read:users`                    | `getMfaEnrollments()` — lists Guardian enrollments                                          |
| `update:users`                  | `updateAuth0User()` — sets/clears `mfa_enrolling` flag                                      |
| `update:users_app_metadata`     | `flagMfaEnrollment()` — sets `mfa_enrolling` flag                                           |
| `read:authentication_methods`   | `getMfaEnrollments()` — lists TOTP and WebAuthn authentication methods                      |
| `delete:authentication_methods` | `deleteAuthenticationMethod()` — removes TOTP/WebAuthn factors from auth-methods            |
| `delete:guardian_enrollments`   | `deleteGuardianEnrollment()` / `deleteAllAuthenticators()` — removes legacy OTP enrollments |
| `create:actions`                | Deploy-time setup — creates the MFA Post-Login Action                                       |
| `read:actions`                  | Deploy-time setup — checks if the Action already exists                                     |
| `update:actions`                | Deploy-time setup — updates the Action code if changed                                      |
| `read:triggers`                 | Deploy-time setup — reads the Login flow bindings                                           |
| `update:triggers`               | Deploy-time setup — binds the Action to the Login flow                                      |

### Backend Changes

- **`auth0-management.ts`** — `getMfaEnrollments(sub)` queries `/authentication-methods` (primary) and Guardian `/enrollments` (legacy fallback) in parallel; pulls TOTP and WebAuthn from auth-methods; falls back to Guardian `authenticator` only when no `totp` is present in auth-methods. Each entry carries an internal `source: 'guardian' | 'auth-methods'` for delete routing. `flagMfaEnrollment(sub)` sets `mfa_enrolling`; `deleteGuardianEnrollment(id)` removes a Guardian-sourced entry; `deleteAuthenticationMethod(sub, id)` removes an auth-methods-sourced entry; `deleteAllAuthenticators(sub)` deletes every factor by source and clears `mfa_enrolling` in one PATCH
- **`enroll-mfa.ts`** — `POST /api/mfa/enroll` — sets `mfa_enrolling: true`. Does **not** reject when a strong factor already exists — adding a second strong factor is supported (the Action chains challenge+enroll within one login)
- **`disable-mfa.ts`** — `POST /api/mfa/disable` — calls `deleteAllAuthenticators` which removes Guardian and auth-methods enrollments by source and clears `mfa_enrolling`
- **`delete-mfa-enrollment.ts`** — `DELETE /api/mfa/enrollments/{enrollmentId}` — verifies ownership, routes by `enrollment.source`, clears `mfa_enrolling` if it was the last enrollment
- **`get-me.ts`** — returns `mfaEnrollments` when `?include=mfa` is passed
- **`MeResponse`** (shared types) — `MfaEnrollment` interface (`id`, `type`, `name?`, `createdAt`) and `mfaEnrollments: MfaEnrollment[]` (always present, populated only when `?include=mfa` is requested). The internal `source` field on `GuardianEnrollment` is server-side only and not exposed to the client
- **`sst.config.ts`** — three MFA routes registered: `/mfa/enroll`, `/mfa/disable`, `/mfa/enrollments/{enrollmentId}`
- **`setup-integrations.ts`** — deploy-time Lambda creates the Post-Login Action, polls for `built` status, deploys it, and ensures it is bound to the post-login trigger while preserving any existing bindings (staging/production only — dev stages share an Auth0 tenant and would race on the global Action name). Email provider setup is fatal — without it, email verification and password reset both break.

### Frontend Changes

- **`api.ts`** — `enrollMfa(): Promise<void>` posts to `/mfa/enroll` then calls `redirectToLogin()`; `disableMfa()` removes all; `deleteMfaEnrollment(id)` removes a single enrollment
- **`MfaSettings.tsx`** (extracted component) — renders the MFA section under the Security `SectionCard`. When no factor is enrolled, shows an "Enable" CTA. When factors are enrolled, lists each one (`EnrollmentRow`) with a Remove button and shows "Add authenticator or key" plus "Remove all MFA methods". Confirmations use the shared `ConfirmDialog` modal: per-method removal and remove-all
- **`SettingRow.tsx`** (extracted shared component) — used by `SettingsPage` (for Password) and `MfaSettings` (for the MFA header row)
- **`SettingsPage.tsx`** — fetches `getMe({ include: 'mfa' })` and renders `<MfaSettings>` inside the Security section

## Future Enhancements (Out of Scope)

- **Step-up auth** — require fresh MFA for sensitive actions (disable MFA, delete account)
- **Org-level MFA enforcement** — org setting `requireMfa: boolean` that forces all members to enroll
- **View recovery codes** — custom UI to regenerate/display recovery codes post-enrollment
- **Remember device** — Auth0 can skip MFA on trusted devices for 30 days

## Risks

### Auth0 Management API Rate Limits

`getMfaEnrollments(sub)` issues two Management API calls per Settings page load (`/enrollments` and `/authentication-methods` in parallel). Auth0's Management API rate limit is 50 req/s on free/essentials plans. At current scale this is not a concern.

### Auth0 Guardian vs Authentication Methods Split

The two endpoints assign different ids for the same factor (`otp|...` vs `totp|...`), do not share schemas, and have asymmetric mirroring. The merge in `getMfaEnrollments` tags every entry with `source` so the delete handlers can route correctly; the legacy Guardian fallback handles users who pre-date the unified API. If Auth0 ever consolidates onto `/authentication-methods` only, the Guardian fallback can be deleted; if they unify in the other direction, the source tag would need rewriting.

### Auth0 Requires `challengeWithAny` Before `enrollWithAny` for Already-Enrolled Users

Calling `enrollWithAny` alone for a user with any existing factor returns "Something went wrong" on `/authorize`. The Action chains `challengeWithAny(existing)` followed by `enrollWithAny(...)` within one Action invocation — Auth0 queues both and runs them in order. If a future Auth0 change splits these into separate triggers (post-challenge action), this chain would have to be rewritten as cross-action state.

### Email Provider Setup is Fatal at Deploy Time

`setupAuth0EmailProvider` in the deploy Lambda is intentionally not wrapped in error handling — a failure fails the CloudFormation custom resource and blocks the deploy. Without a working email provider, email verification and password reset are both broken; a deploy failure is preferable to silently broken email flows. (The MFA email factor is disabled tenant-wide so the email provider is no longer load-bearing for MFA itself.)

### Action Name is Global per Tenant

`MFA Enrollment Trigger` is a global name within a single Auth0 tenant. Today only the staging stage mutates it in FilOneDev, and production uses a separate tenant. If a future change widens the `setup-integrations` gate to deploy from multiple stages into the same tenant, those stages will race on the Action `code`.

### Auto-Enrollment if Email Factor Re-Enabled

If an operator turns the Auth0 email factor back on at the tenant level, every verified-email user immediately starts showing `{type:'email'}` in `event.user.enrolledFactors`. The Action filters `email` out of the MFA-types set, so it is ignored — but enrolling a user via Universal Login could surface the email option. The simplest mitigation is "don't re-enable it"; the Auth0 dashboard configuration step above is explicit about this.

### No Step-Up Auth and No Rate Limiting on MFA Endpoints

Any authenticated session can disable MFA without re-verifying. The endpoints rely on the same auth + CSRF protection as other API routes; there is no per-user throttling. Mitigated by CSRF (an attacker needs the token) and 1-hour access-token expiry. Step-up auth is listed in Future Enhancements.

## Consequences

- MFA is opt-in per user. All connection types (database and social) can enroll.
- The strong-factor enrollment UX is delegated to Auth0 Universal Login.
- Multiple strong factors are supported and stack — a user can have OTP + WebAuthn-platform + WebAuthn-roaming concurrently. Adding an additional factor uses the chained `challengeWithAny` + `enrollWithAny` pattern in a single Action invocation; the existing factor is challenged before the new one is enrolled.
- The source of truth for MFA status is `/authentication-methods` (modern, unified) with Guardian `/enrollments` as a legacy OTP fallback. `getMfaEnrollments` merges them into a single shape and tags each entry with `source` so deletion routes to the correct endpoint.
- `app_metadata.mfa_enrolling` is a one-time enrollment trigger only — never a source of truth. The Action clears it as part of the same login that consumes it.
- Abandoned strong-factor enrollment attempts no longer leave `mfa_enrolling: true` — the Action clears it before calling `enrollWithAny`. Users re-trigger enrollment by clicking "Add authenticator or key" again.
- All three MFA factor types (OTP, WebAuthn-roaming, WebAuthn-platform) are enrollable and challengeable; recovery codes are auto-issued by Auth0 during strong-factor enrollment but are not surfaced in our UI.
- Users can view, add, and individually remove MFA methods from the Settings page; all destructive actions are gated by a `ConfirmDialog` modal.
- The Post-Login Action is deployed automatically via the `setup-integrations` Lambda on staging and production. Dev stacks share an Auth0 tenant, so the Action is not deployed from dev — testing on dev runs against whatever was last deployed by staging.
