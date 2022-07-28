import { Router } from 'express';
import url from 'url';
import { ValidationError } from '../../util/ValidationError';

import getRanking from '../../util/api/likernft/ranking';

const router = Router();

router.get('/ranking', async (req, res, next) => {
  try {
    const order = req.query.order || 'price';
    if (order !== 'price' && order !== 'soldCount') throw new ValidationError('INVALID_ORDER_KEY');
    const queryString = url.parse(req.url).query;
    const data = await getRanking(queryString, order);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
