import { Router } from 'express';
import axios from 'axios';
import sharp from 'sharp';
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
  getUserAvatar,
} from '../../util/api/users/getPublicInfo';
import { ONE_DAY_IN_S } from '../../constant';

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
      if (payload.isDeleted) {
        res.sendStatus(404);
        return;
      }
      res.set('Cache-Control', 'public, max-age=30');
      res.json(filterUserDataMin(payload, types));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});


router.get('/id/:id/avatar', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { size = '400' } = req.query;
    const sizeNum = parseInt(size, 10);
    if (Number.isNaN(sizeNum) || sizeNum <= 0 || sizeNum > 400) {
      throw new ValidationError('Invalid size');
    }

    const avatar = await getUserAvatar(id);
    if (avatar) {
      const { data: stream } = await axios.get(avatar, {
        responseType: 'stream',
      });
      const resizer = sharp()
        .resize(sizeNum, sizeNum)
        .jpeg();
      stream.pipe(resizer).pipe(res);

      const cacheTime = 3600;
      res.set('Cache-Control', `public, max-age=${cacheTime}, s-maxage=${cacheTime}, stale-if-error=${ONE_DAY_IN_S}`);
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
      if (payload.isDeleted) {
        res.sendStatus(404);
        return;
      }
      res.json(filterUserDataMin(payload, types));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
