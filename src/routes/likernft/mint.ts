import { Router } from 'express';

import { filterLikeNFTISCNData } from '../../util/ValidationHelper';
import { getISCNDocByClassId } from '../../util/api/likernft';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';

const router = Router();

router.get(
  '/mint',
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
      res.json(filterLikeNFTISCNData({ iscnId: iscnPrefix, ...doc.data() }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
