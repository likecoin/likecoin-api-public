import { Router } from 'express';
import BigNumber from 'bignumber.js';

import { jwtOptionalAuth } from '../../middleware/jwt';
import { userCollection } from '../../util/firebase';
import { isValidLikeAddress, getQueryClient } from '../../util/cosmos';
import { parseCivicLikerV3Status } from '../../util/api/civic';

import {
  CIVIC_LIKER_VALIDATOR_ADDRESS,
  CIVIC_LIKER_STAKING_AMOUNT_TARGET,
} from '../../../config/config';
import { getISCNQueryClient } from '../../util/cosmos/iscn';

const router = Router();

router.get('/staking/info', async (_, res, next) => {
  try {
    const client = await getQueryClient();
    const { validator } = await client.staking.validator(CIVIC_LIKER_VALIDATOR_ADDRESS);
    if (!validator) throw new Error('CIVIC_LIKER_VALIDATOR_NOT_FOUND');
    const {
      operatorAddress,
      description: {
        moniker: name = '',
        website = '',
        details: description = '',
      } = {},
    } = validator;
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=86400');
    res.json({
      operatorAddress,
      name,
      description,
      website,
      stakingAmountTarget: CIVIC_LIKER_STAKING_AMOUNT_TARGET,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/staking', jwtOptionalAuth('read:civic_liker'), async (req, res, next) => {
  try {
    const result: Record<string, unknown> = {
      status: 'unregistered',
      stakingAmount: 0,
      stakingAmountTarget: CIVIC_LIKER_STAKING_AMOUNT_TARGET,
    };

    let { address } = req.query;
    let userDoc;
    if (address || req.user) {
      if (address && isValidLikeAddress(address)) {
        const userQuery = await userCollection.where('likeWallet', '==', address).limit(1).get();
        if (userQuery.docs.length) {
          [userDoc] = userQuery.docs;
        }
      } else if (req.user) {
        const { user: likerId } = req.user;
        userDoc = await userCollection.doc(likerId).get();
      }

      if (userDoc && userDoc.exists) {
        const userData = userDoc.data();
        if (!userData) throw new Error('USER_DATA_NOT_FOUND');
        address = userData.likeWallet;
      }
    }
    if (address) {
      const iscnClient = await getISCNQueryClient();
      const client = await iscnClient.getStargateClient();
      const delegation = await client.getDelegation(
        address as string,
        CIVIC_LIKER_VALIDATOR_ADDRESS,
      );
      if (delegation) {
        result.stakingAmount = new BigNumber(delegation.amount).shiftedBy(-9).toNumber();
      }
      if (userDoc) {
        result.status = parseCivicLikerV3Status(
          result.stakingAmount as number,
          result.stakingAmountTarget as number,
          userDoc,
        );
        if (result.status === 'active') {
          const userData = userDoc.data();
          result.activeSince = userData.civicLiker.currentPeriodStart;
        }
      }
    }
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
