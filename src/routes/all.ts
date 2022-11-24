import * as fs from 'fs';
import * as path from 'path';
import { Router } from 'express';

const router = Router();

fs.readdirSync(__dirname).forEach((name) => {
  if (!fs.lstatSync(path.join(__dirname, name)).isDirectory()) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  router.use(`/${name}`, require(`./${name}`).default); // eslint-disable-line import/no-dynamic-require,global-require
});

export default router;
