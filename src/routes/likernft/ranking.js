import { Router } from 'express';

import getRanking from '../../util/api/likernft/ranking';

const router = Router();

router.get('/ranking', async (req, res, next) => {
  try {
    const data = await getRanking();
    console.log(data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
