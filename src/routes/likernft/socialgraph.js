import { Router } from 'express';

import { getCollector } from '../../util/api/likernft/socialgraph';

const router = Router();

router.get('/collector', async (_, res) => {
  const result = await getCollector(
    'like1qv66yzpgg9f8w46zj7gkuk9wd2nrpqmca3huxf',
  );
  res.send(result);
});

export default router;
