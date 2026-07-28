import { Router } from 'express';
import RateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { TEST_MODE } from '../../../constant';
import { jwtAuth } from '../../../middleware/jwt';
import { validateBody } from '../../../middleware/validate';
import { BookMetadataSuggestBodySchema } from '../../../util/api/likernft/book/schemas';
import { suggestBookMetadata } from '../../../util/api/likernft/book/suggest';

const router = Router();

// Per-user limit: suggestions call a paid LLM API, so cap farming attempts.
const suggestLimiter = RateLimit({
  windowMs: 60 * 1000,
  max: TEST_MODE ? Number.MAX_SAFE_INTEGER : 10,
  keyGenerator: (req) => req.user?.wallet || req.user?.user || ipKeyGenerator(req.ip || ''),
});

router.post(
  '/suggest',
  jwtAuth('write:nftbook'),
  suggestLimiter,
  validateBody(BookMetadataSuggestBodySchema),
  async (req, res, next) => {
    try {
      const result = await suggestBookMetadata(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
