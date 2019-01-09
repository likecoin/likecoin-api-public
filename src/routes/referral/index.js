import { Router } from 'express';
import {
  userCollection as dbRef,
  missionCollection as missionsRef,
  payoutCollection as bonusRef,
} from '../../util/firebase';
import {
  filterMissionData,
  filterPayoutData,
} from '../../util/ValidationHelper';
import { jwtAuth } from '../../util/jwt';

function getIfReferralMissionDone(m, { u }) {
  const { id } = m;
  const user = u.data();
  switch (id) {
    case 'verifyEmail': {
      if (user.isEmailVerified) return true;
      break;
    }
    default: return false;
  }
  return false;
}

const router = Router();

router.get('/list/:id', jwtAuth('read'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.user !== id) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const query = await dbRef.doc(id).collection('referrals').get();
    const missionCol = await missionsRef.where('isReferral', '==', true).orderBy('priority').get();

    const referees = query.docs.map((r) => {
      const missions = [];
      const missionDone = [];
      for (let index = 0; index < missionCol.docs.length; index += 1) {
        const m = missionCol.docs[index];
        const requires = m.data().require;
        const fulfilled = requires.every(mId => missionDone.includes(mId));

        /* Dont send upcoming to referee */
        const upcoming = m.data().startTs && Date.now() < m.data().startTs;
        if (fulfilled && !upcoming) {
          const done = getIfReferralMissionDone(m, { u: r });
          if (done) missionDone.push(m.id);
          const notExpired = !m.data().endTs || Date.now() < m.data().endTs;
          if (done || notExpired) {
            missions.push({
              id: m.id,
              ...m.data(),
              done,
            });
          }
        }
      }
      const bonusCooldown = r.data().bonusCooldown || 0;
      return {
        id: r.id,
        bonusCooldown: bonusCooldown > Date.now() ? bonusCooldown : undefined,
        seen: !!r.data().seen,
        missions: missions.map(d => ({ ...filterMissionData(d) })),
      };
    });
    res.json(referees);
  } catch (err) {
    next(err);
  }
});

router.get('/list/bonus/:id', jwtAuth('read'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.user !== id) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const [referrerDoc, refereeDoc] = await Promise.all([
      bonusRef
        .where('toId', '==', id)
        .where('referrer', '==', id)
        .where('waitForClaim', '==', true)
        .get(),
      bonusRef
        .where('toId', '==', id)
        .where('referee', '==', id)
        .where('waitForClaim', '==', true)
        .get(),
    ]);
    let results = [];
    results = results.concat(referrerDoc.docs
      .map(d => ({ id: d.id, ...filterPayoutData(d.data()) })));
    results = results.concat(refereeDoc.docs
      .map(d => ({ id: d.id, ...filterPayoutData(d.data()) })));
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.post('/seen/:id', jwtAuth('write'), async (req, res, next) => {
  try {
    const user = req.params.id;
    if (req.user.user !== user) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const {
      referralId,
    } = req.body;
    const userReferralRef = dbRef.doc(user).collection('referrals').doc(referralId);
    await userReferralRef.update({ seen: true });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
