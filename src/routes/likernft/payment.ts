import { Router } from 'express';
import { fetchISCNPrefixes } from '../../middleware/likernft';
import { getPurchaseInfoList, calculatePayment } from '../../util/api/likernft/fiat';

const router = Router();

router.get(
  '/payment/price',
  fetchISCNPrefixes,
  async (req, res, next) => {
    try {
      const { iscnPrefixes, classIds } = res.locals;
      const purchaseInfoList = await getPurchaseInfoList(iscnPrefixes, classIds);
      const {
        totalLIKEPricePrediscount,
        totalLIKEPrice,
        totalFiatPriceString,
      } = await calculatePayment(purchaseInfoList);
      const payload = {
        LIKEPricePrediscount: totalLIKEPricePrediscount,
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
