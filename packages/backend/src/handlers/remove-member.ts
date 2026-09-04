import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ApiErrorCode, OrgRole, canManageTargetRole } from '@filone/shared';
import type { ErrorResponse, OrgRole as Role } from '@filone/shared';
import { AuditSubjects, auditEvent, auditPut, commitAudited, userActor } from '../lib/audit.js';
import { prepareFloorOrg } from '../lib/account-creation.js';
import type { FloorOrgPreparation } from '../lib/account-creation.js';
import {
  normalizeInviteEmail,
  pendingInvitationsForRemoval,
  planRevocations,
  retireInvitationItems,
  revokeDeferred,
} from '../lib/invitations.js';
import {
  cancelledLabels,
  membershipDeleteItems,
  ownerCountItem,
} from '../lib/membership-changes.js';
import { listMemberships, readOwnerCount, resolveMembership } from '../lib/org-membership.js';
import { readUserProfile, readUserSub } from '../lib/user-profile.js';
import { ResponseBuilder } from '../lib/response-builder.js';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { getUserInfo, getVerifiedEmail } from '../lib/user-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireOrgMembershipMiddleware, requirePermission } from '../middleware/authorize.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';

/**
 * DELETE /api/org/members/{userId} — take a member out of the organization,
 * or leave it yourself.
 *
 * Two different gates behind one route, decided in the handler because the
 * requirement depends on whether the path's `userId` names the caller:
 *
 * - **Removing someone else** costs `members.manage`, capped at the same
 *   ceiling as every other verb — an Admin reaches Admin and below, and
 *   removing an Owner is `owners.manage`, exactly like demoting one.
 *   Otherwise deletion would reach what demotion forbids.
 * - **Leaving** costs nothing beyond being a member: every role, including
 *   Member and ReadOnly (who hold no `members.manage`), may remove
 *   themselves. This is the self-service carve-out the route's own history
 *   flagged as a needed product decision rather than a quiet exception — a
 *   `members.leave` permission would only ever be granted to its own holder,
 *   so a carve-out states that directly instead of adding an entry to the
 *   matrix nothing else reads.
 *
 * Either way, the last Owner still cannot leave or be removed: that guard
 * lives in the `ownerCount` decrement's own condition below, unconditional on
 * who the caller is.
 *
 * One transaction: both membership rows, the `ownerCount` decrement when the
 * member was an Owner, the invitations the removal retires, and the event.
 *
 * Two families of invitation go, and the second is the one that makes removal
 * mean anything. The ones they ISSUED go because no role of theirs remains to
 * justify them. The ones ADDRESSED TO them go because the token in such a link
 * still works: a removed member who kept an old invitation redeems it and walks
 * straight back in at the role that link carries — a stale Owner invitation
 * turns demote-then-remove into a re-entry as Owner. Nothing else on the accept
 * path refuses it, since their address still matches and the inviter still holds
 * the authority they invited with.
 *
 * Finding those needs the member's address, which the membership row does not
 * carry — it is in the `USER#{userId}/PROFILE` row, written by the two paths
 * that learn a verified one, and that read is best-effort like every other
 * profile read here. A removal whose profile read fails or whose row predates
 * those writers still removes the member, sweeps what they issued, and logs that
 * the addressed-to sweep could not run.
 *
 * Keys are untouched in M1. A departing member's access keys keep working until
 * somebody revokes them, which the console names in the confirmation dialog; the
 * revoke-by-default flow with per-key review is FIL-1021.
 *
 * A removal that would leave the target account with zero memberships instead
 * gives it a floor org in the same transaction ({@link prepareFloorOrg}):
 * every account needs somewhere to log in to, and lazily creating one only
 * when it would otherwise have none is cheaper than every invited account
 * carrying a personal org it may never use. Skipped for an account whose
 * profile carries no `sub` — nothing to repoint the identity row of — which
 * is logged loudly rather than blocking the removal itself.
 */
export async function baseHandler(
  event: AuthenticatedEvent,
): Promise<APIGatewayProxyStructuredResultV2> {
  const targetUserId = event.pathParameters?.userId;
  const { orgId, userId, membership } = getUserInfo(event);
  const actorEmail = getVerifiedEmail(event);

  // Leaving costs nothing beyond being a member — the chain's
  // `requireOrgMembershipMiddleware()` already confirmed that. Removing
  // someone else is `members.manage`, checked ahead of the path param itself
  // so a caller who could never do this either way is refused the same
  // permission error a malformed request from them always got, not a 400
  // that leaks whether the path happened to be well-formed.
  if (targetUserId !== userId) {
    const denied = requirePermission(event, 'members.manage');
    if (denied) return denied;
  }

  if (!targetUserId) return badRequestResponse();

  const target = await resolveMembership(orgId, targetUserId);
  if (!target) return notAMemberResponse();

  if (targetUserId !== userId) {
    if (!canManageTargetRole(membership!.role, target.role)) {
      return beyondCeilingResponse(target.role);
    }
  }

  const wasOwner = target.role === OrgRole.Owner;
  const targetProfile = await readUserProfile(targetUserId);
  const doomed = await pendingInvitationsForRemoval(orgId, {
    userId: targetUserId,
    emailNorm: removedMemberAddress(targetUserId, targetProfile?.email),
  });
  const { now, later } = planRevocations(doomed, wasOwner ? 3 : 2);
  const floorOrg = await prepareFloorOrgIfLastMembership({
    targetUserId,
    orgId,
    name: targetProfile?.name,
    email: targetProfile?.email,
  });

  try {
    await commitAudited({
      items: [
        ...membershipDeleteItems({ orgId, userId: targetUserId, fromRole: target.role }),
        ...(wasOwner ? [ownerCountItem(orgId, 'decrement')] : []),
        ...now.flatMap((invitation) => retireInvitationItems(invitation, 'revoked')),
        ...(floorOrg ? [...floorOrg.items, auditPut(floorOrg.event)] : []),
      ],
      event: auditEvent({
        type: 'member.removed',
        actor: userActor({ userId, email: actorEmail }),
        orgId,
        subject: AuditSubjects.user(targetUserId),
        details: {
          role: target.role,
          ...(doomed.length > 0 ? { revokedInvitations: doomed.length } : {}),
        },
      }),
    });
  } catch (err) {
    return await removalFailureResponse(err, {
      orgId,
      targetUserId,
      wasOwner,
      revocations: now.length,
      floorOrg: floorOrg !== undefined,
    });
  }

  await revokeDeferred(later);

  return { statusCode: 204, body: '' };
}

/**
 * The removed member's address, lowercased, or undefined when we do not hold
 * one.
 *
 * Held because the two paths that learn a verified address write it: account
 * creation and invitation acceptance (`lib/user-profile.ts`). So undefined is
 * now the rare answer — a row written before either did, or a read that failed
 * — rather than the only one, and it is worth a log line each time. It narrows
 * the sweep to the invitations the member issued: the invitation their old link
 * belongs to stays live until it expires, and an operator reading this line is
 * the only person who can revoke it by hand.
 */
function removedMemberAddress(userId: string, email: string | undefined): string | undefined {
  if (!email) {
    console.error(
      '[remove-member] No address for the removed member — invitations to them stay live',
      { userId },
    );
    return undefined;
  }
  return normalizeInviteEmail(email);
}

/**
 * A floor org for the removal to create alongside itself, or undefined when
 * the target keeps somewhere else to log in — or when it doesn't, but nothing
 * here can name the row that needs repointing.
 *
 * `listMemberships` is read fresh rather than reused from anywhere else: it is
 * the strongly-consistent count of every org this account belongs to right
 * now, and the removal about to happen is not among them yet, so a count of
 * one means this org is the only one — the removal would take it to zero.
 */
async function prepareFloorOrgIfLastMembership({
  targetUserId,
  orgId,
  name,
  email,
}: {
  targetUserId: string;
  orgId: string;
  name?: string;
  email?: string;
}): Promise<FloorOrgPreparation | undefined> {
  const memberships = await listMemberships(targetUserId);
  if (memberships.length > 1) return undefined;

  const sub = await readUserSub(targetUserId, { consistentRead: true });
  if (!sub) {
    console.error(
      '[remove-member] Removed member has no sub on their profile — leaving them without an org',
      { targetUserId, orgId },
    );
    return undefined;
  }

  return prepareFloorOrg({ userId: targetUserId, sub, leavingOrgId: orgId, name, email });
}

async function removalFailureResponse(
  err: unknown,
  {
    orgId,
    targetUserId,
    wasOwner,
    revocations,
    floorOrg,
  }: {
    orgId: string;
    targetUserId: string;
    wasOwner: boolean;
    revocations: number;
    floorOrg: boolean;
  },
): Promise<APIGatewayProxyStructuredResultV2> {
  // `prepareFloorOrg` returns seven items; every one of its conditions failing
  // means the same thing to the caller (try the removal again), so they share
  // one label rather than naming each row.
  const failed = cancelledLabels(err, [
    'membership',
    'inverse',
    ...(wasOwner ? ['ownerCount'] : []),
    ...Array.from({ length: revocations * 2 }, () => 'invitation'),
    ...(floorOrg ? Array.from({ length: 7 }, () => 'floorOrg') : []),
  ]);
  if (failed.length === 0) throw err;
  if (failed.includes('floorOrg')) return floorOrgRaceResponse();

  // The decrement's own condition, which is the whole last-Owner invariant:
  // the org's only Owner cannot be removed, including by themselves. Unless
  // there is no counter to read, in which case the guard did not fire — it was
  // never armed, and telling the caller they are the last Owner would be a
  // diagnosis of an org we cannot diagnose.
  if (failed.includes('ownerCount')) {
    return (await readOwnerCount(orgId)) === undefined
      ? ownerCountUnavailableResponse(orgId)
      : lastOwnerResponse();
  }
  if (failed.includes('invitation')) return invitationRaceResponse();
  // The membership delete carries both the row's existence and its role, so a
  // cancellation here is one of two things and the row says which: gone, which
  // is the outcome the caller wanted, or still there under a role somebody
  // changed while this was in flight — and that one must not read as removed,
  // because the transaction's owner-count delta was decided from the old role.
  return (await resolveMembership(orgId, targetUserId))
    ? roleChangedResponse()
    : notAMemberResponse();
}

function badRequestResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(400)
    .body<ErrorResponse>({ message: 'Missing userId in path' })
    .build();
}

function notAMemberResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(404)
    .body<ErrorResponse>({ message: 'That person is not a member of this organization.' })
    .build();
}

function beyondCeilingResponse(role: Role): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(403)
    .body<ErrorResponse>({
      message: `Your role in this organization cannot remove a ${role}.`,
      code: ApiErrorCode.FORBIDDEN_ROLE,
    })
    .build();
}

function lastOwnerResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(409)
    .body<ErrorResponse>({
      message:
        'This organization would be left without an owner. Transfer ownership or promote another member first.',
      code: ApiErrorCode.LAST_OWNER,
    })
    .build();
}

/**
 * The org has membership rows and no counter, so the last-Owner invariant is
 * unenforceable for it until somebody repairs the META row — which the drift
 * checker does within a day. Loud, and the same answer the accept path gives for
 * the same missing row, because "contact support" is true and "you are the last
 * Owner" would not be.
 */
function ownerCountUnavailableResponse(orgId: string): APIGatewayProxyStructuredResultV2 {
  console.error('[remove-member] ownerCount missing — removal of an Owner refused', { orgId });
  return new ResponseBuilder()
    .status(409)
    .body<ErrorResponse>({
      message: 'The organization’s owner count could not be updated. Please contact support.',
    })
    .build();
}

function roleChangedResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(409)
    .body<ErrorResponse>({
      message: 'That member’s role changed while the removal was in flight — try again.',
    })
    .build();
}

function invitationRaceResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(409)
    .body<ErrorResponse>({
      message: 'An invitation from that member changed while this was in flight — try again.',
    })
    .build();
}

/**
 * The floor org this removal prepared could not be created — most likely the
 * repoint's condition lost a race with something else that changed the
 * target's home org in the same window. Retrying re-reads the membership
 * count and prepares a fresh org, rather than resending stale items.
 */
function floorOrgRaceResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(409)
    .body<ErrorResponse>({
      message: 'That member’s account changed while this was in flight — try again.',
    })
    .build();
}

export const handler = middy(baseHandler)
  .use(httpHeaderNormalizer())
  .use(authMiddleware())
  // Membership only at the gate — the handler decides whether this request
  // also needs `members.manage`, since a self-targeted one does not.
  .use(requireOrgMembershipMiddleware())
  .use(csrfMiddleware())
  .use(errorHandlerMiddleware());
