import { Router } from 'express';
import { fetchISCNPrefixes } from '../../middleware/likernft';
import { getPurchaseInfoList, getLIKEPriceInfo } from '../../util/api/likernft/fiat';

const router = Router();

router.get(
  '/payment/price',
  fetchISCNPrefixes,
  async (req, res, next) => {
    try {
      const { iscnPrefixes, classIds } = res.locals;
      const purchaseInfoList = await getPurchaseInfoList(iscnPrefixes, classIds);
      const { totalLIKEPrice, totalFiatPriceString } = await getLIKEPriceInfo(purchaseInfoList);
      const payload = {
        LIKEPrice: totalLIKEPrice,
        fiatPrice: Number(totalFiatPriceString),
        fiatPriceString: totalFiatPriceString,
        purchaseInfoList,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
