import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { OrgRole, TransferOwnershipSchema, canManageTargetRole } from '@filone/shared';
import type { AccessKeySummary, ErrorResponse, TransferOwnershipResponse } from '@filone/shared';
import { AuditSubjects, userActor } from '../lib/audit.js';
import { commitAfterRevokingKeys } from '../lib/commit-after-revoking-keys.js';
import { reviewKeysForRoleChange } from '../lib/member-keys.js';
import {
  pendingInvitationsFrom,
  planRevocations,
  retireInvitationItems,
  revokeDeferred,
} from '../lib/invitations.js';
import {
  cancelledLabels,
  labelled,
  ownerCountItem,
  roleChangeItems,
} from '../lib/membership-changes.js';
import type { LabelledItems } from '../lib/membership-changes.js';
import { resolveMembership } from '../lib/org-membership.js';
import {
  OrgDeletingError,
  getOrgProfile,
  isGuardRejection,
  orgNotDeletingCheck,
} from '../lib/org-profile.js';
import { parseJsonBody } from '../lib/parse-json-body.js';
import {
  ResponseBuilder,
  notAMemberResponse,
  unattributableFailure,
  vendorRefusedResponse,
} from '../lib/response-builder.js';
import type { ErrorWithRevokedKeys } from '../lib/response-builder.js';
import type { AuthenticatedEvent } from '../lib/user-context.js';
import { getUserInfo, getVerifiedEmail } from '../lib/user-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { errorHandlerMiddleware } from '../middleware/error-handler.js';
import { requireMfaIfEnrolled } from '../middleware/require-mfa.js';

const SOURCE = 'transfer-ownership';

/**
 * POST /api/org/transfer — hand the Owner seat to another member.
 *
 * Owner-only (`org.transfer`), and the one org action behind a step-up: it is
 * the only verb that takes the caller's own authority away, so a session
 * somebody walked away from must not be enough to move the seat.
 * `requireMfaIfEnrolled` rather than `requireMfa`, because a user with nothing
 * enrolled would otherwise be denied outright rather than prompted — the gate
 * asks for a recent authentication, which everyone can produce.
 *
 * The transaction opens with the org-deletion fence, which is what stops the
 * inverse items' deliberately unconditional updates from recreating memberships
 * a teardown has already walked past (`lib/membership-changes.ts`).
 *
 * The promotion and the demotion are one transaction, and the owner count moves
 * by nothing: the org has exactly one Owner before and after. The net-zero update
 * still writes, because touching the META row is what puts it in the
 * transaction — a promotion landing concurrently then conflicts instead of
 * interleaving with a swap that assumed the count.
 *
 * The outgoing Owner's pending Owner-invitations ride the same transaction, the
 * way a demotion's do: they are invitations the role they now hold could not
 * have issued.
 *
 * Their access keys go the same way: an Admin holds no `privileged.grant`, so a
 * key carrying object retention or a legal hold is authority their new role
 * could not mint. Revoked before the seat moves
 * (`lib/commit-after-revoking-keys.ts`); the response names what went, since the
 * holder is the caller.
 *
 * Nothing about billing changes. The subscription is keyed to the org and the
 * Stripe customer is untouched; ownership is a role attribute, not a payer.
 */
export async function baseHandler(
  event: AuthenticatedEvent,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { orgId, userId, membership } = getUserInfo(event);
  const actorEmail = getVerifiedEmail(event);

  const parsed = parseJsonBody(event.body, TransferOwnershipSchema);
  if ('error' in parsed) return parsed.error;
  const targetUserId = parsed.data.userId;

  if (targetUserId === userId) return alreadyOwnerResponse();

  const target = await resolveMembership(orgId, targetUserId);
  if (!target) return notAMemberResponse();
  if (target.role === OrgRole.Owner) return alreadyOwnerResponse();

  // `authorize('org.transfer')` is Owner-only, so this is the caller's role.
  const callerRole = membership!.role;

  // Independent, so one wave: the invitations to sweep and the profile the
  // revocations resolve their tenants from.
  const [pending, orgProfile] = await Promise.all([
    pendingInvitationsFrom(orgId, userId),
    getOrgProfile(orgId),
  ]);

  // The same sweep a demotion runs, for the same reason: the outgoing Owner
  // becomes an Admin, and an Admin cannot issue an Owner invitation, so they
  // cannot keep one outstanding either. The accept path's ConditionCheck already
  // refuses those links, which makes this hygiene rather than a guard — no dead
  // links in inboxes, no slots held under the cap, no pending rows on the page
  // that nobody can explain.
  const doomed = pending.filter(
    (invitation) => !canManageTargetRole(OrgRole.Admin, invitation.role),
  );
  const seat = transferItems({
    orgId,
    callerUserId: userId,
    targetUserId,
    targetRole: target.role,
    callerRole,
  });
  const { now, later } = planRevocations(doomed, seat.items.length);
  const change = {
    items: [...seat.items, ...now.flatMap((i) => retireInvitationItems(i, 'revoked'))],
    labels: [...seat.labels, ...now.flatMap(() => ['invitation', 'invitation'])],
  };

  // The outgoing Owner's keys only: the incoming Owner is a widening, and a
  // widening strands nothing.
  const review = await reviewKeysForRoleChange(orgId, userId, OrgRole.Admin);

  const committed = await commitAfterRevokingKeys({
    items: change.items,
    keys: review.keysToRevoke,
    fence: review.fence,
    orgId,
    orgProfile,
    actor: userActor({ userId, email: actorEmail }),
    trigger: 'role_narrowing',
    type: 'ownership.transferred',
    subject: AuditSubjects.org(orgId),
    details: {
      fromUserId: userId,
      toUserId: targetUserId,
      ...(doomed.length > 0 ? { revokedInvitations: doomed.length } : {}),
    },
    source: SOURCE,
    onCancelled: (err, revokedKeys) =>
      transferFailureResponse(err, orgId, change.labels, revokedKeys),
    onRefused: (refused, revoked) => vendorRefusedResponse(revoked, refused, 'ownership'),
    // The key holder is the caller, and the response below tells them.
  });
  if ('response' in committed) return committed.response;
  if ('keyMinted' in committed) return keyMintedResponse(committed.keyMinted);

  await revokeDeferred(later);

  return new ResponseBuilder()
    .status(200)
    .body<TransferOwnershipResponse>({
      userId: targetUserId,
      previousOwnerUserId: userId,
      // Named only when there are any, so an ordinary transfer reads as before.
      ...(committed.revoked.length > 0 ? { revokedKeys: committed.revoked } : {}),
    })
    .build();
}

/** The fence, both role changes and the counter — what the sweep's revocations sit behind. */
function transferItems({
  orgId,
  callerUserId,
  targetUserId,
  targetRole,
  callerRole,
}: {
  orgId: string;
  callerUserId: string;
  targetUserId: string;
  targetRole: OrgRole;
  callerRole: OrgRole;
}): LabelledItems {
  const [promotion, promotionInverse] = roleChangeItems({
    orgId,
    userId: targetUserId,
    fromRole: targetRole,
    toRole: OrgRole.Owner,
  });
  // The outgoing Owner stays, as an Admin: transferring the seat is not leaving
  // the org, and an org that loses its only administrator because somebody
  // handed over ownership is a support ticket.
  const [demotion, demotionInverse] = roleChangeItems({
    orgId,
    userId: callerUserId,
    fromRole: callerRole,
    toRole: OrgRole.Admin,
  });

  return labelled([
    ['org', orgNotDeletingCheck(orgId)],
    ['promotion', promotion],
    ['promotionInverse', promotionInverse],
    ['demotion', demotion],
    ['demotionInverse', demotionInverse],
    // Net zero, but touching META is what puts it in the transaction: a
    // concurrent promotion then conflicts instead of interleaving.
    ['ownerCount', ownerCountItem(orgId, 'unchanged')],
  ]);
}

/** The answer when the transaction cancels; every answer carries `revokedKeys`. */
function transferFailureResponse(
  err: unknown,
  orgId: string,
  labels: readonly string[],
  revokedKeys: AccessKeySummary[],
): APIGatewayProxyStructuredResultV2 {
  // The fence, at its own index: the org is being torn down and no retry helps.
  if (isGuardRejection(err)) throw new OrgDeletingError(orgId);

  const failed = cancelledLabels(err, labels);
  if (failed.length === 0)
    return unattributableFailure(err, { source: SOURCE, orgId, revokedKeys });

  console.warn('[transfer-ownership] Transfer cancelled', { failed });
  return new ResponseBuilder()
    .status(409)
    .body<ErrorWithRevokedKeys>({
      message: 'The organization’s roles changed while the transfer was in flight — try again.',
      revokedKeys,
    })
    .build();
}

/** A key was minted for the outgoing Owner after the listing this revoked from. */
function keyMintedResponse(revokedKeys: AccessKeySummary[]): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(409)
    .body<ErrorWithRevokedKeys>({
      message: 'An access key was created for you while the transfer was in flight — try again.',
      revokedKeys,
    })
    .build();
}

function alreadyOwnerResponse(): APIGatewayProxyStructuredResultV2 {
  return new ResponseBuilder()
    .status(409)
    .body<ErrorResponse>({ message: 'That member already owns this organization.' })
    .build();
}

export const handler = middy(baseHandler)
  .use(httpHeaderNormalizer())
  .use(authMiddleware())
  .use(authorize('org.transfer'))
  .use(requireMfaIfEnrolled())
  .use(csrfMiddleware())
  .use(errorHandlerMiddleware());
