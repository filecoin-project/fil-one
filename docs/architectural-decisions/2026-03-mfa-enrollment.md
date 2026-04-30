# ADR: Multi-Factor Authentication

**Status:** Proposed
**Created:** 2026-04-29
**Last updated:** 2026-04-30

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

Email cannot be enrolled through Auth0 Actions (`enrollWithAny` does not accept `email`), but the Management API's `POST /api/v2/users/{id}/authentication-methods` endpoint will create a confirmed email factor _only when no other factors exist_. We use that to offer email as a zero-redirect first-factor on-ramp; users who want a strong factor go through Universal Login enrollment. Email and a strong factor cannot coexist: enrolling a strong factor must replace the email factor first. Multiple _strong_ factors (e.g. OTP + WebAuthn) are supported and stack — see "Adding additional strong factors" below.

Auth0 auto-enrolls every user whose email is verified into the email MFA factor when the email factor is enabled tenant-wide — `event.user.enrolledFactors` reports `{type:'email'}` even though no Management API record exists for it. To distinguish explicit opt-in from auto-enrollment we set `app_metadata.email_mfa_active` whenever the user enrolls via Path 1, and the Post-Login Action treats email as a real factor only when that flag is true. Without this filter every verified-email user is silently subjected to email MFA.

### Enrollment Approach

**Custom enrollment UI** — Build our own TOTP secret display, QR code generation, and WebAuthn registration. Rejected because it duplicates what Auth0 Universal Login already provides and introduces security surface area.

**`acr_values` parameter** — Force a fresh login with `acr_values` requesting MFA. Rejected because Auth0 does not reliably pass `acr_values` to Post-Login Actions in all configurations.

**`app_metadata.mfa_enrolling` flag** — Backend sets a flag, the Post-Login Action reads it and triggers enrollment. The flag is a one-time signal, not a source of truth. Chosen because it reliably triggers enrollment through Auth0's Action system.

### MFA Status Source of Truth

Auth0 stores MFA factors in two endpoints. The earlier assumption that Guardian was authoritative for OTP/WebAuthn turned out to be wrong: Guardian's `/enrollments` predates WebAuthn entirely (it never returns `webauthn-roaming`/`webauthn-platform`) and modern Auth0 only mirrors a subset of factors into it.

- **Authentication methods** (modern, unified) — `GET /api/v2/users/{id}/authentication-methods`. Returns every factor: TOTP (as `type: 'totp'`), `webauthn-roaming`, `webauthn-platform`, `email`, plus `password` and social identities. Newly-added factors land here only.
- **Guardian enrollments** (legacy) — `GET /api/v2/users/{id}/enrollments`. Returns OTP enrollments for users that predate the unified API. Does not contain WebAuthn or email at all in current Auth0.

`getMfaEnrollments(sub, { includeEmail })` queries both endpoints in parallel. It pulls TOTP, WebAuthn, and (optionally) email from `/authentication-methods` as the primary source, and falls back to Guardian for `authenticator` only when `/authentication-methods` has no `totp` entry — that fallback covers legacy users who never got an auth-methods record.

Each merged entry carries an internal `source: 'guardian' | 'auth-methods'` field. The two endpoints assign different ids for the same factor (Guardian: `otp|...`, auth-methods: `totp|...`), so source is the only reliable way to choose the right delete endpoint:

- `source: 'guardian'`     → `DELETE /api/v2/guardian/enrollments/{id}`
- `source: 'auth-methods'` → `DELETE /api/v2/users/{id}/authentication-methods/{id}`

The merged read is only performed when `?include=mfa` is passed to `GET /api/me` (currently only the Settings page).

Auth0 also silently mirrors any auth-methods email factor into Guardian. The mirror is not removed by deleting the auth-method, so removing email also requires sweeping `/enrollments` for orphan email rows — otherwise the user is still challenged with email on the next login despite the Settings page showing nothing. `deleteEmailGuardianEnrollments(sub)` performs that sweep and is invoked by both the per-enrollment and remove-all delete paths.

## Decision

Enable **OTP, WebAuthn (roaming + platform), and Email** as MFA factors in Auth0. Set the MFA policy to **"Never"**. SMS is excluded. MFA is opt-in per user and available for all connection types (database and social).

The MFA policy is "Never" because enrollment and challenge are controlled entirely by a Post-Login Action plus a server-side email-enrollment endpoint. The Action uses `app_metadata.mfa_enrolling` as a one-time enrollment trigger and checks `enrolledFactors` to challenge enrolled users on every login.

The Action is created, deployed, and bound to the post-login trigger automatically by the `setup-integrations` deploy Lambda (staging/production only).

### Auth0 MFA Architecture

Auth0 stores factors in two endpoints with different ids per factor and a partial mirroring relationship between them:

- **Authentication methods** (modern, unified) — Lists every factor: TOTP (`type: 'totp'`), WebAuthn (`webauthn-roaming`, `webauthn-platform`), `email`, plus `password` and social identities. Created via `POST /api/v2/users/{id}/authentication-methods` for email; populated by Auth0 itself when factors enroll via Universal Login. Listed via `GET /api/v2/users/{id}/authentication-methods`. Deleted via `DELETE /api/v2/users/{id}/authentication-methods/{id}`.
- **Guardian enrollments** (legacy) — Predates WebAuthn; returns OTP and a few other Guardian-managed types but never `webauthn-roaming`/`webauthn-platform`. Listed via `GET /api/v2/users/{id}/enrollments`. Deleted via `DELETE /api/v2/guardian/enrollments/{id}`. Used as a fallback for legacy OTP users only.

Cross-endpoint behaviors that bit us:

- Auth0 auto-enrolls every user with a verified email into email MFA when the email factor is enabled tenant-wide. `event.user.enrolledFactors` reports `{type: 'email'}` for those users even though no record exists in either listing endpoint. We use `app_metadata.email_mfa_active` as the explicit-opt-in signal so the Action can distinguish.
- Auth0 mirrors authentication-methods email factors into Guardian. The auth-methods DELETE does NOT cascade to the Guardian mirror — until that mirror is swept, the Action keeps challenging with email even after the user clicks Remove.
- TOTP enrolled via Universal Login lands only in `/authentication-methods` (as `type: 'totp'`); it is not mirrored to Guardian for new users. Code that reads only Guardian misses it entirely.

Action capabilities:

- `enrollWithAny(factors)` shows a selection screen — accepts Guardian factor types only; **email is not supported**.
- `challengeWithAny(factors)` shows a selection screen — accepts all factor types including `email`.
- A single Action invocation can call **both** `challengeWithAny` and `enrollWithAny`. They queue and execute in order within one login transaction — the user is challenged with an existing factor first, then enrolls a new one. This is how multiple strong factors stack: Auth0 rejects `enrollWithAny` alone for already-enrolled users with "Something went wrong"; the chained challenge satisfies its precondition.
- `event.user.enrolledFactors` includes every factor type (social identities, password, MFA factors, auto-enrolled email, etc.) — code must filter to MFA types AND filter out auto-enrolled email before deciding `hasMfa`.

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
  // Auth0 auto-includes {type:'email'} for every verified-email user when the
  // email factor is on tenant-wide. Treat email as a real factor only when the
  // user opted in via Path 1 (which sets app_metadata.email_mfa_active).
  const emailMfaActive = event.user.app_metadata?.email_mfa_active === true;
  const enrolledFactors = (event.user.enrolledFactors || []).filter((f) => {
    if (!allMfaTypes.has(f.type)) return false;
    if (f.type === 'email' && !emailMfaActive) return false;
    return true;
  });
  const hasMfa = enrolledFactors.length > 0;
  const mfaEnrolling = event.user.app_metadata?.mfa_enrolling === true;

  const strongFactorTypes = new Set(['otp', 'webauthn-roaming', 'webauthn-platform']);
  const hasStrongFactor = enrolledFactors.some((f) => strongFactorTypes.has(f.type));
  const challengeTypes = [
    { type: 'otp' },
    { type: 'webauthn-roaming' },
    { type: 'webauthn-platform' },
  ];
  if (!hasStrongFactor && emailMfaActive) challengeTypes.push({ type: 'email' });

  if (mfaEnrolling) {
    // Clear the one-shot trigger so subsequent logins do not re-enroll.
    api.user.setAppMetadata('mfa_enrolling', false);
    if (hasMfa) {
      // Auth0 rejects enrollWithAny on already-enrolled users without a prior
      // challenge in the same action. The two calls queue and execute in
      // order within one login transaction.
      api.authentication.challengeWithAny(challengeTypes);
    }
    api.authentication.enrollWithAny([
      { type: 'otp' },
      { type: 'webauthn-roaming' },
      { type: 'webauthn-platform' },
    ]);
    return;
  }

  if (hasMfa) {
    api.authentication.challengeWithAny(challengeTypes);
  }
};
```

The canonical source is `packages/backend/src/jobs/stack-setup/mfa-action.ts` — that file is type-checked, then serialized via `Function.prototype.toString()` and deployed to Auth0 by `setup-integrations.ts`. Email enrollment never goes through this Action; it is created server-side via the Management API (see Path 1 below).

The chained `challengeWithAny` + `enrollWithAny` is the mechanism that lets users add a second strong factor on top of an existing one. Calling `enrollWithAny` alone on an already-enrolled user surfaces "Something went wrong" on `/authorize`; the prior challenge is the precondition Auth0 requires.

### Enrollment Flow

There are two entry points from the Settings page, gated by Auth0's "email-only-when-no-other-factors" Management API constraint.

**Path 1 — Email (low friction, no redirect):**

1. User clicks "Enable with email" on the Settings page
2. Frontend calls `POST /api/mfa/enroll-email`
3. Backend re-checks no factors are enrolled (including email) and calls `POST /api/v2/users/{id}/authentication-methods` to create a confirmed email factor, then sets `app_metadata.email_mfa_active: true` so the Action treats the email factor as user-intended (without the flag, the Action filters it out as the auto-enrolled noise)
4. Settings page invalidates the MFA cache and shows the email enrollment as enabled
5. On the next login, the Post-Login Action sees the email factor in `event.user.enrolledFactors` and challenges with a 6-digit email code (because `email_mfa_active === true` and no strong factor is enrolled)

**Path 2 — Authenticator app or security key (Universal Login):**

1. User clicks "Enable with authenticator app or security key" (first enrollment) or "Add authenticator or key" (additional enrollment, including email-only and existing-strong-factor cases)
2. **If only email is currently enrolled**, the UI opens a `ConfirmDialog` warning that the email factor will be replaced. On confirm:
3. Frontend calls `POST /api/mfa/enroll`. Backend deletes any existing email authentication-method (clearing `email_mfa_active` at the same time so a future logout doesn't leave the Action flagging the auto-enrolled email as real), then sets `app_metadata.mfa_enrolling: true`. The handler does **not** reject when a strong factor already exists — adding a second strong factor is a supported path
4. Frontend redirects to `/login`, which initiates Universal Login
5. The Post-Login Action sees `mfa_enrolling === true`. It clears the flag, and:
   - If `hasMfa === false` (first enrollment): calls `enrollWithAny([otp, webauthn-roaming, webauthn-platform])` directly
   - If `hasMfa === true` (additional strong factor): calls `challengeWithAny(existing factor)` **then** `enrollWithAny(...)`. Auth0 runs both within one login transaction — the user proves possession of the existing factor before enrolling the new one
6. User enrolls; Auth0 Universal Login handles the entire enrollment UX
7. On the next login the flag is already cleared and the Action just challenges with whatever factors the user now has

If the user abandons enrollment, the `mfa_enrolling` flag has already been cleared (the Action clears it before calling `enrollWithAny`, in the same transaction), so the next login is a normal challenge — not a forced re-enrollment. They re-trigger enrollment by clicking "Add authenticator or key" again.

**Self-heal on read.** Auth0 may attach an email authentication-method to a user automatically because their email is verified. When `GET /api/me?include=mfa` runs and finds _both_ a strong factor and an email factor, the handler deletes the email auth-method, clears `app_metadata.email_mfa_active`, and excludes the email entry from the response. Clearing the flag is essential — leaving it `true` would let the Action treat the still-auto-enrolled email factor as a real one if the user later removes the strong factor.

### Disable Flow

Both flows show a `ConfirmDialog` modal before destructive action.

**Remove individual enrollment:**

1. Settings page shows each enrolled factor with a "Remove" button
2. User confirms in the modal
3. Frontend calls `DELETE /api/mfa/enrollments/{enrollmentId}`
4. Backend re-fetches enrollments to verify the ID belongs to this user, then routes by `source` (each enrollment carries its endpoint of origin — see "MFA Status Source of Truth"):
   - `source: 'guardian'`     → `DELETE /api/v2/guardian/enrollments/{id}`
   - `source: 'auth-methods'` → `DELETE /api/v2/users/{id}/authentication-methods/{id}`
5. If the removed factor was email, additionally sweep `/enrollments` for orphan Guardian email rows (Auth0's mirror does not cascade) and clear `app_metadata.email_mfa_active`
6. If the last enrollment was removed, clear `mfa_enrolling`

**Remove all:**

1. User clicks "Remove all MFA methods" on Settings page and confirms in the modal
2. Frontend calls `POST /api/mfa/disable`
3. Backend iterates all enrollments and deletes each via its source endpoint, sweeps Guardian email orphans if any email factor was removed, then patches `app_metadata` with `mfa_enrolling: false` and `email_mfa_active: false` in a single update

### Social Login Users

Social login users (Google, GitHub) can enroll in Auth0 MFA. Auth0 is the session authority regardless of the upstream identity provider — after the social provider returns, Auth0 challenges with MFA before completing the login. The Settings page shows the same MFA UI for all users.

### Auth0 Dashboard Configuration Required

1. **Enable factors** (Security > Multi-factor Auth): OTP, WebAuthn with FIDO Security Keys, WebAuthn with FIDO Device Biometrics, Email
   - "FIDO Device Biometrics" is what surfaces platform passkeys (Touch ID, Face ID, Windows Hello, Android biometrics) on the enrollment screen. Without it, only OTP and hardware security keys appear.
   - Enabling Email at the tenant level causes Auth0 to auto-enroll every user with `email_verified: true` into email MFA, surfacing in `event.user.enrolledFactors`. The Post-Login Action filters this out via `app_metadata.email_mfa_active` — keep that filter intact, or every verified-email user is silently put on email MFA.
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

- **`auth0-management.ts`** — `getMfaEnrollments(sub, { includeEmail })` queries `/authentication-methods` (primary) and Guardian `/enrollments` (legacy fallback) in parallel; pulls TOTP, WebAuthn, and (optionally) email from auth-methods; falls back to Guardian `authenticator` only when no `totp` is present in auth-methods. Each entry carries an internal `source: 'guardian' | 'auth-methods'` for delete routing. `flagMfaEnrollment(sub)` sets `mfa_enrolling`; `setEmailMfaActive(sub, active)` sets/clears the explicit-opt-in flag; `enrollEmailMfa(sub, email)` creates the email factor; `deleteGuardianEnrollment(id)` removes a Guardian-sourced entry; `deleteAuthenticationMethod(sub, id)` removes an auth-methods-sourced entry; `deleteEmailGuardianEnrollments(sub)` sweeps the Guardian email mirror left behind by an auth-methods email DELETE; `deleteAllAuthenticators(sub)` deletes every factor by source, sweeps Guardian email orphans, and clears `mfa_enrolling` + `email_mfa_active` in one PATCH
- **`enroll-mfa.ts`** — `POST /api/mfa/enroll` — deletes any existing email authentication-method, clears `email_mfa_active` if any email factor was removed, sets `mfa_enrolling: true`. Does **not** reject when a strong factor already exists — adding a second strong factor is supported (the Action chains challenge+enroll within one login)
- **`enroll-email-mfa.ts`** — `POST /api/mfa/enroll-email` — rejects if any factor (including email) is enrolled; calls `enrollEmailMfa()` and `setEmailMfaActive(sub, true)` synchronously; no redirect required
- **`disable-mfa.ts`** — `POST /api/mfa/disable` — calls `deleteAllAuthenticators` which removes Guardian and auth-methods enrollments by source, sweeps Guardian email orphans, and clears both `mfa_enrolling` and `email_mfa_active`
- **`delete-mfa-enrollment.ts`** — `DELETE /api/mfa/enrollments/{enrollmentId}` — verifies ownership, routes by `enrollment.source`, sweeps Guardian email orphans and clears `email_mfa_active` for email-type deletes, clears `mfa_enrolling` if it was the last enrollment
- **`get-me.ts`** — returns `mfaEnrollments` when `?include=mfa` is passed; self-heals orphaned email auth-methods when a strong factor is also enrolled, clearing `email_mfa_active` at the same time
- **`MeResponse`** (shared types) — `MfaEnrollment` interface (`id`, `type`, `name?`, `createdAt`) and `mfaEnrollments: MfaEnrollment[]` (always present, populated only when `?include=mfa` is requested). The internal `source` field on `GuardianEnrollment` is server-side only and not exposed to the client
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

`getMfaEnrollments(sub)` issues two Management API calls per Settings page load (`/enrollments` and `/authentication-methods` in parallel). The orphan self-heal in `get-me.ts` adds a third call only when a strong factor and an email factor coexist — typically once, then never again. Auth0's Management API rate limit is 50 req/s on free/essentials plans. At current scale this is not a concern.

### Auth0 Guardian vs Authentication Methods Split

The two endpoints assign different ids for the same factor (`otp|...` vs `totp|...`, `email|...` Guardian vs `email|...` auth-methods), do not share schemas, and have asymmetric mirroring. The merge in `getMfaEnrollments` tags every entry with `source` so the delete handlers can route correctly; the email-mirror sweep handles the auth-methods-to-Guardian fan-out for email; the legacy Guardian fallback handles users who pre-date the unified API. If Auth0 ever consolidates onto `/authentication-methods` only, the Guardian fallback can be deleted; if they unify in the other direction, the source tag and the sweep would need rewriting.

### Auth0 Auto-Enrolls Verified-Email Users into Email MFA

When the email factor is enabled at the tenant level, every user with `email_verified: true` shows up with `{type: 'email'}` in `event.user.enrolledFactors` — Auth0 manufactures the entry from the verified email rather than from any Management API record. Without filtering, the Post-Login Action treats every such user as MFA-enrolled and challenges them with email on every login. We mitigate via the `app_metadata.email_mfa_active` opt-in flag: the Action only counts email as a real factor when the user explicitly enrolled via Path 1. If a future change removes the filter or stops setting/clearing the flag at the boundaries, the bug returns silently.

### Auth0 Requires `challengeWithAny` Before `enrollWithAny` for Already-Enrolled Users

Calling `enrollWithAny` alone for a user with any existing factor returns "Something went wrong" on `/authorize`. The Action chains `challengeWithAny(existing)` followed by `enrollWithAny(...)` within one Action invocation — Auth0 queues both and runs them in order. If a future Auth0 change splits these into separate triggers (post-challenge action), this chain would have to be rewritten as cross-action state.

### Email Provider Setup is Fatal at Deploy Time

`setupAuth0EmailProvider` in the deploy Lambda is intentionally not wrapped in error handling — a failure fails the CloudFormation custom resource and blocks the deploy. Without a working email provider, email MFA, email verification, and password reset are all broken; a deploy failure is preferable to silently broken email flows.

### Action Name is Global per Tenant

`MFA Enrollment Trigger` is a global name within a single Auth0 tenant. Today only the staging stage mutates it in FilOneDev, and production uses a separate tenant. If a future change widens the `setup-integrations` gate to deploy from multiple stages into the same tenant, those stages will race on the Action `code`.

### No Step-Up Auth and No Rate Limiting on MFA Endpoints

Any authenticated session can disable MFA without re-verifying. The endpoints rely on the same auth + CSRF protection as other API routes; there is no per-user throttling. Mitigated by CSRF (an attacker needs the token) and 1-hour access-token expiry. Step-up auth is listed in Future Enhancements.

## Consequences

- MFA is opt-in per user. All connection types (database and social) can enroll.
- The strong-factor enrollment UX is delegated to Auth0 Universal Login; the email enrollment UX is server-side via the Management API and surfaces no redirect to the user.
- Multiple strong factors are supported and stack — a user can have OTP + WebAuthn-platform + WebAuthn-roaming concurrently. Adding an additional factor uses the chained `challengeWithAny` + `enrollWithAny` pattern in a single Action invocation; the existing factor is challenged before the new one is enrolled.
- The source of truth for MFA status is `/authentication-methods` (modern, unified) with Guardian `/enrollments` as a legacy OTP fallback. `getMfaEnrollments` merges them into a single shape and tags each entry with `source` so deletion routes to the correct endpoint.
- Email and a strong factor cannot coexist: enrolling a strong factor first deletes any existing email factor and clears `email_mfa_active`, and `get-me` self-heals if Auth0 attaches one back. Login challenges exclude email when a strong factor is enrolled.
- `app_metadata.mfa_enrolling` is a one-time enrollment trigger only — never a source of truth. The Action clears it as part of the same login that consumes it.
- `app_metadata.email_mfa_active` is the explicit-opt-in signal that distinguishes user-intended email MFA from Auth0's tenant-wide auto-enrollment of verified-email users. It is set when Path 1 enrolls and cleared at every email-factor removal boundary.
- Abandoned strong-factor enrollment attempts no longer leave `mfa_enrolling: true` — the Action clears it before calling `enrollWithAny`. Users re-trigger enrollment by clicking "Add authenticator or key" again.
- All four MFA factor types (OTP, WebAuthn-roaming, WebAuthn-platform, email) are enrollable and challengeable; recovery codes are auto-issued by Auth0 during strong-factor enrollment but are not surfaced in our UI.
- Users can view, add, and individually remove MFA methods from the Settings page; all destructive actions are gated by a `ConfirmDialog` modal.
- The Post-Login Action is deployed automatically via the `setup-integrations` Lambda on staging and production. Dev stacks share an Auth0 tenant, so the Action is not deployed from dev — testing on dev runs against whatever was last deployed by staging.
