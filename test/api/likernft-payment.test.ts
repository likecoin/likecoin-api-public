// eslint-disable-next-line import/no-unresolved
import test from 'ava';
import axiosist from './axiosist';
import {
  LIKER_NFT_MIN_USD_PRICE,
  LIKER_NFT_STRIPE_FEE_USD_INTERCEPT,
  LIKER_NFT_STRIPE_FEE_USD_SLOPE,
  // eslint-disable-next-line import/extensions
} from '../../config/config.js';

const FLOOR_PRICE_ISCN_ID_PREFIX = 'iscn://likecoin-chain/jDIU6eXjSttrEUvIPfvZZaMeGB6ckGOGX0EL4UYGraU';
const FLOOR_PRICE_CLASS_ID = 'likenft1swtgvmt2w5atqqrelga3p8vgg67dkrwrgr75hfgpyzh5umlnqtgszvqufa';
const FREE_ISCN_ID_PREFIX = 'iscn://likecoin-chain/R0R6zSt2Ql665q5FUlAkFMI6gktQGj2O7IziK4eh7GI';
const FREE_CLASS_ID = 'likenft1t2a7n9px9y5mhayjpk4s7m40zwjr3wvyg4ucg32w77jxmsw7889qg6ky8d';
const NORMAL_PRICE_ISCN_ID_PREFIX = 'iscn://likecoin-chain/JEyWs9SO3OoiB9kTys6FhPr-TgH69K4SJ35mut5adyw';
const NORMAL_PRICE_CLASS_ID = 'likenft1l0nqpjwtm88kn7mq4hfaw6qh6598llqn4unpyhlfc6mksjx2duaqgklw9k';

const LIKE_PRICE = 0.001;
const PRICE_BUFFER = 0.1;

test('likernft: get payment info', async (t) => {
  const res = await axiosist.get(`/api/likernft/payment/price?class_id=${FLOOR_PRICE_CLASS_ID}&class_id=${FREE_CLASS_ID}&class_id=${NORMAL_PRICE_CLASS_ID}`)
    .catch((err) => (err as any).response);
  t.is(res.status, 200);
  const totalPrice = LIKER_NFT_MIN_USD_PRICE + 16; // 16.5
  t.is(res.data.LIKEPricePrediscount, Math.ceil((totalPrice / LIKE_PRICE) * (1 + PRICE_BUFFER)));
  t.is(res.data.LIKEPrice, Math.ceil(
    (
      (
        (LIKER_NFT_MIN_USD_PRICE - LIKER_NFT_STRIPE_FEE_USD_INTERCEPT)
        + (16 - LIKER_NFT_STRIPE_FEE_USD_INTERCEPT)
      )
      * (1 - LIKER_NFT_STRIPE_FEE_USD_SLOPE)
      * (1 + PRICE_BUFFER)
    ) / LIKE_PRICE,
  ));
  t.is(res.data.fiatPrice, totalPrice);
  t.is(res.data.fiatPriceString, '16.50');
  t.is(res.data.purchaseInfoList[0].iscnPrefix, FLOOR_PRICE_ISCN_ID_PREFIX);
  t.is(res.data.purchaseInfoList[0].classId, FLOOR_PRICE_CLASS_ID);
  t.is(res.data.purchaseInfoList[0].price, LIKER_NFT_MIN_USD_PRICE);
  t.is(res.data.purchaseInfoList[1].iscnPrefix, FREE_ISCN_ID_PREFIX);
  t.is(res.data.purchaseInfoList[1].classId, FREE_CLASS_ID);
  t.is(res.data.purchaseInfoList[1].price, 0);
  t.is(res.data.purchaseInfoList[2].iscnPrefix, NORMAL_PRICE_ISCN_ID_PREFIX);
  t.is(res.data.purchaseInfoList[2].classId, NORMAL_PRICE_CLASS_ID);
  t.is(res.data.purchaseInfoList[2].price, 16);
});
