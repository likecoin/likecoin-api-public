import { Router } from 'express';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';
import {
  checkAddressValid,
  checkCosmosAddressValid,
  filterUserDataMin,
} from '../../util/ValidationHelper';
import {
  getUserWithCivicLikerProperties,
  formatUserCivicLikerProperies,
} from '../../util/api/users/getPublicInfo';

const router = Router();

router.get('/id/:id/min', async (req, res, next) => {
  try {
    const username = req.params.id;
    const { type } = req.query;
    let types = [];
    if (type) {
      types = type.split(',');
    }
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      res.set('Cache-Control', 'public, max-age=30');
      res.json(filterUserDataMin(payload, types));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

router.get('/addr/:addr/min', async (req, res, next) => {
  try {
    const { addr } = req.params;
    const { type } = req.query;
    let types = [];
    if (type) {
      types = type.split(',');
    }
    let field;
    if (checkAddressValid(addr)) {
      field = 'wallet';
    } else if (checkCosmosAddressValid(addr, 'like')) {
      field = 'likeWallet';
    } else if (checkCosmosAddressValid(addr, 'cosmos')) {
      field = 'cosmosWallet';
    } else {
      throw new ValidationError('Invalid address');
    }
    const query = await dbRef.where(field, '==', addr).limit(1).get();
    if (query.docs.length > 0) {
      res.set('Cache-Control', 'public, max-age=30');
      const userDoc = query.docs[0];
      const payload = formatUserCivicLikerProperies(userDoc.id, userDoc.data());
      res.json(filterUserDataMin(payload, types));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
