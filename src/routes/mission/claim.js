import { Router } from 'express';
import { BigNumber } from 'bignumber.js';
import { jwtAuth } from '../../middleware/jwt';
import {
  ETH_NETWORK_NAME,
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import {
  db,
  userCollection as dbRef,
  missionCollection as missionDbRef,
  payoutCollection as payoutDbRef,
} from '../../util/firebase';
import publisher from '../../util/gcloudPub';

const uuidv4 = require('uuid/v4');

const ONE_LIKE = new BigNumber(10).pow(18);

const router = Router();

router.post('/referral/claim', jwtAuth('write'), async (req, res) => {
  try {
    const { type, user: userId } = req.body;
    if (req.user.user !== userId) {
      return res.status(401).send('LOGIN_NEEDED');
    }
    const bonusRef = payoutDbRef
      .where('toId', '==', userId)
      .where('type', '==', type)
      .where('waitForClaim', '==', true)
      .where('effectiveTs', '<=', Date.now());
    const userDoc = await dbRef.doc(userId).get();
    if (!userDoc.exists) throw new Error('user not exist');
    const ethNetwork = ETH_NETWORK_NAME;
    const {
      displayName,
      email,
      wallet,
      isBlackListed,
      referrer,
      timestamp: registerTime,
      bonusCooldown,
    } = userDoc.data();
    if (isBlackListed) {
      publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'eventBakError',
        ethNetwork,
        user: userId,
        wallet,
        displayName,
        email,
        referrer,
        registerTime,
        description: 'claimBonusByType',
      });
      throw new Error('ERROR_USER_BAK');
    }
    if (bonusCooldown && bonusCooldown > Date.now()) {
      throw new Error('ERROR_BONUS_COOLDOWN');
    }
    const sum = await db.runTransaction(async (t) => {
      const snap = await t.get(bonusRef);
      const promises = [];
      let s = new BigNumber(0);
      snap.forEach((d) => {
        s = s.plus(new BigNumber(d.data().value));
        promises.push(t.update(d.ref, { waitForClaim: false, setClaimTs: Date.now() }));
      });
      await Promise.all(promises);
      return s;
    });
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventGiveBonusByType',
      ethNetwork,
      user: userId,
      wallet,
      displayName,
      email,
      bonusType: type,
      referrer,
      registerTime,
    });
    const snapshot = await missionDbRef.where('isProxy', '==', true).where('targetPayoutType', '==', type).limit(1)
      .get();
    if (snapshot.docs.length > 0) {
      await publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'eventMissionClaim',
        ethNetwork,
        user: userId,
        wallet,
        displayName,
        email,
        missionId: snapshot.docs[0].id,
        bonusType: type,
        referrer,
        registerTime,
      });
    }
    return res.json({ amount: sum.div(ONE_LIKE).toFixed() });
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});


router.post('/claim', jwtAuth('write'), async (req, res) => {
  try {
    const { missionId, user: userId } = req.body;
    if (req.user.user !== userId) {
      return res.status(401).send('LOGIN_NEEDED');
    }
    const missionRef = dbRef.doc(userId).collection('mission').doc(missionId);
    const [missionDoc, userDoc] = await Promise.all([
      missionRef.get(),
      dbRef.doc(userId).get(),
    ]);
    if (!userDoc.exists) throw new Error('user not exist');
    const shouldSendBonus = missionDoc.data().done && !missionDoc.data().bonusId;
    const ethNetwork = ETH_NETWORK_NAME;

    if (shouldSendBonus) {
      const bonusId = uuidv4();
      const {
        displayName,
        email,
        wallet,
        isBlackListed,
        referrer,
        timestamp: registerTime,
      } = userDoc.data();
      if (isBlackListed) {
        publisher.publish(PUBSUB_TOPIC_MISC, null, {
          logType: 'eventBakError',
          ethNetwork,
          user: userId,
          wallet,
          displayName,
          email,
          referrer,
          registerTime,
          description: 'claimMissionBonusById',
        });
        throw new Error('ERROR_USER_BAK');
      }
      const payoutDoc = payoutDbRef.doc(bonusId);
      await db.runTransaction(async (t) => {
        const payload = {
          txHash: null,
          type: `mission-${missionId}`,
          toId: userId,
          to: wallet,
          mission: true,
        };
        const d = await t.get(missionRef);
        if (d.data().bonusId) throw new Error(`${missionId}: ${d.data().bonusId} already sent to payout`);
        return Promise.all([
          t.create(payoutDoc, payload),
          t.update(missionRef, { bonusId }),
        ]);
      });
      await publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'eventGiveMissionBonus',
        ethNetwork,
        user: userId,
        wallet,
        displayName,
        email,
        missionId,
        referrer,
        registerTime,
      });
      return res.json({ bonusId });
    }
    return res.status(400).send('cannot be claimed');
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

export default router;
