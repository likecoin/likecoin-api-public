import { Router } from 'express';

import { getCollector, getCreator } from '../../util/api/likernft/socialgraph';

const router = Router();

router.get('/collector', async (req, res) => {
  const { creator } = req.query;
  if (!creator) {
    res.status(401).send({ error: 'creator is required' });
    return;
  }
  const result = await getCollector(creator);
  res.send(result);
});

router.get('/creator', async (req, res) => {
  const { collector } = req.query;
  if (!collector) {
    res.status(401).send({ error: 'creator is required' });
    return;
  }
  const result = await getCreator(collector);
  res.send(result);
});

export default router;
