import { Router } from 'express';
import { getNftBookInfo } from '../../../util/api/likernft/book';
import { calculatePayment } from '../../../util/api/likernft/fiat';
import { ValidationError } from '../../../util/ValidationError';

const router = Router();

router.get(
  '/price',
  async (req, res, next) => {
    try {
      const { class_id: classId, price_index: priceIndexString } = req.query;
      const bookInfo = await getNftBookInfo(classId);

      const priceIndex = Number(priceIndexString);
      const { prices } = bookInfo;
      if (prices.length <= priceIndex) {
        throw new ValidationError('PRICE_NOT_FOUND', 404);
      }

      const { priceInDecimal } = prices[priceIndex];
      const price = priceInDecimal / 100;

      const {
        totalLIKEPricePrediscount,
        totalLIKEPrice,
        totalFiatPriceString,
      } = await calculatePayment([price]);
      const payload = {
        LIKEPricePrediscount: totalLIKEPricePrediscount,
        LIKEPrice: totalLIKEPrice,
        fiatPrice: Number(totalFiatPriceString),
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
