import { Router } from 'express';

import { jwtAuth } from '../../middleware/jwt';
import { validateBody, validateParams } from '../../middleware/validate';
import {
  PlusSharedMemberClaimBodySchema,
  PlusSharedMemberInviteIdParamsSchema,
  PlusSharedMemberNewBodySchema,
  PlusSharedMemberNewResponseSchema,
  PlusSharedMembersResponseSchema,
} from '../../util/api/plus/schemas';
import {
  claimSharedMemberInvite,
  createSharedMemberInvite,
  getSharedMembers,
  revokeSharedMemberInvite,
} from '../../util/api/plus/sharedMember';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import publisher from '../../util/gcloudPub';
import { sendValidatedJSON } from '../../util/ValidationHelper';

// Shared membership: a Civic-tier benefit letting a giver hand out revocable
// Plus seats. A member's access follows the giver's Civic sub lifecycle.
const router = Router();

router.post('/members', jwtAuth('write:plus'), validateBody(PlusSharedMemberNewBodySchema), async (req, res, next) => {
  const { email, name, message } = req.body;
  try {
    const { inviteId, remainingSeats } = await createSharedMemberInvite(
      { email, name, message },
      req,
    );
    sendValidatedJSON(res, PlusSharedMemberNewResponseSchema, {
      inviteId,
      remainingSeats,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusSharedMemberInvited',
      inviteId,
      remainingSeats,
      wallet: req.user?.wallet,
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
      memberEmail: email,
      memberName: name,
    });
  } catch (error) {
    next(error);
  }
});

// Shared-membership seat usage and the giver's active (pending/claimed) invites.
router.get('/members', jwtAuth('read:plus'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const status = await getSharedMembers(wallet);
    sendValidatedJSON(res, PlusSharedMembersResponseSchema, status);
  } catch (error) {
    next(error);
  }
});

// Claim a shared-membership seat invite as the authenticated member.
router.post('/members/claim', jwtAuth('write:plus'), validateBody(PlusSharedMemberClaimBodySchema), async (req, res, next) => {
  const { giverLikerId, inviteId, token } = req.body;
  try {
    const { memberLikerId } = await claimSharedMemberInvite({
      giverLikerId,
      inviteId,
      token,
      wallet: req.user?.wallet,
    });
    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusSharedMemberClaimed',
      inviteId,
      giverLikerId,
      memberLikerId,
      wallet: req.user?.wallet,
    });
  } catch (error) {
    next(error);
  }
});

// Revoke a giver-owned invite, freeing its seat (and the member's access when
// they still hold this giver's shared grant).
router.delete('/members/:inviteId', jwtAuth('write:plus'), validateParams(PlusSharedMemberInviteIdParamsSchema), async (req, res, next) => {
  const { inviteId } = req.params as Record<string, string>;
  try {
    const { memberLikerId } = await revokeSharedMemberInvite({
      inviteId,
      wallet: req.user?.wallet,
    });
    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusSharedMemberRevoked',
      inviteId,
      memberLikerId,
      wallet: req.user?.wallet,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
