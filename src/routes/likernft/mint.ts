import { Router } from 'express';

import { filterLikeNFTISCNData, sendValidatedJSON } from '../../util/ValidationHelper';
import { getISCNDocByClassId } from '../../util/api/likernft';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';
import { validateQuery } from '../../middleware/validate';
import { LikernftClassQuerySchema, LikeNFTISCNDataResponseSchema } from '../../util/api/likernft/schemas';

const router = Router();

router.get(
  '/mint',
  validateQuery(LikernftClassQuerySchema),
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId } = res.locals;
      const doc = await getISCNDocByClassId(classId);
      const iscnNFTData = doc.data();
      if (!iscnNFTData) {
        res.sendStatus(404);
        return;
      }
      const iscnPrefix = decodeURIComponent(doc.id);
      const data = doc.data();
      sendValidatedJSON(
        res,
        LikeNFTISCNDataResponseSchema,
        filterLikeNFTISCNData({ ...data, iscnId: iscnPrefix }),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
