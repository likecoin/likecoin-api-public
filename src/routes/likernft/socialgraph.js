import { Router } from 'express';

import { getCollector, getCreator } from '../../util/api/likernft/socialgraph';

const router = Router();

router.get('/collector', async (req, res, next) => {
  try {
    const { creator } = req.query;
    if (!creator) {
      res.status(400).json({ error: 'MISSING_CREATOR' });
      return;
    }
    const result = await getCollector(creator);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/creator', async (req, res, next) => {
  try {
    const { collector } = req.query;
    if (!collector) {
      res.status(400).json({ error: 'MISSING_COLLECTOR' });
      return;
    }
    const result = await getCreator(collector);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
