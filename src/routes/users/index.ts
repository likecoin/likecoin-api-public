import * as fs from 'fs';
import { Router } from 'express';

const router = Router();

fs.readdirSync(__dirname).forEach((file) => {
  const name = file.split('.')[0];
  if (!name || name === 'index') return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  router.use(require(`./${name}`).default); // eslint-disable-line import/no-dynamic-require,global-require
});

export default router;
