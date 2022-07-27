import { Router } from 'express';

import { getCollector } from '../../util/api/likernft/socialgraph';

const router = Router();

router.get('/collector', async (_, res) => {
  const result = await getCollector(
    'like156gedr03g3ggwktzhygfusax4df46k8dh6w0me',
  );
  res.send(result);
});

export default router;
